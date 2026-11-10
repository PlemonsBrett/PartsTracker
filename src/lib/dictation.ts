import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanTranscript, MAX_SECONDS, MIN_SECONDS, secondsOf, toWhisperAudio } from './audio';
import { loadModel, modelWasDownloaded, transcribe } from './transcriber';

// Engine 1 - the browser's own speech recognition (Chrome, Edge, Safari): live words, nothing to download.
type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
const SpeechCtor = (): (new () => Rec) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

// Engine 2 - record the microphone and transcribe with a small model running in this browser (Firefox and others).
const canRecordLocally = () =>
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== 'undefined' &&
  typeof AudioContext !== 'undefined' &&
  typeof Worker !== 'undefined';

export type Engine = 'browser' | 'local';
export type DictationStatus = 'idle' | 'listening' | 'transcribing';

export function detectEngine(): Engine | null {
  if (typeof window === 'undefined') return null;
  if (SpeechCtor()) return 'browser';
  return canRecordLocally() ? 'local' : null;
}

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  timer: ReturnType<typeof setTimeout>;
  model: Promise<void>;
}

/**
 * Speech to text for the capture boxes. Finished phrases go to `onFinal`. With the on-device engine there are no live
 * words: you record, press Stop, and the text appears after a short pause.
 */
export function useDictation(onFinal: (text: string) => void) {
  const engine = useRef<Engine | null>(detectEngine()).current;
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [interim, setInterim] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const rec = useRef<Rec | null>(null);
  const session = useRef<Session | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const startBrowser = useCallback(() => {
    const C = SpeechCtor();
    if (!C) return;
    const r = new C();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onend = r.onerror = () => {
      setStatus('idle');
      setInterim('');
    };
    rec.current = r;
    r.start();
    setStatus('listening');
  }, []);

  const finishLocal = useCallback(async (s: Session, mimeType: string) => {
    setStatus('transcribing');
    try {
      await s.model;
      const audio = await toWhisperAudio(new Blob(s.chunks, { type: mimeType }));
      if (secondsOf(audio) >= MIN_SECONDS) {
        const text = cleanTranscript(await transcribe(audio));
        if (text) cb.current(text);
      }
    } catch (e) {
      setError(e instanceof Error ? `Dictation failed: ${e.message}` : 'Dictation failed.');
    } finally {
      setStatus('idle');
      setProgress(null);
    }
  }, []);

  const stopLocal = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearTimeout(s.timer);
    if (s.recorder.state !== 'inactive') s.recorder.stop();
    for (const t of s.stream.getTracks()) t.stop();
  }, []);

  const startLocal = useCallback(async () => {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('The microphone is blocked or missing. Allow microphone access for this site and try again.');
      return;
    }
    const recorder = new MediaRecorder(stream);
    // The model downloads while you talk, so the first use doesn't make you wait before speaking.
    const model = loadModel((p) => setProgress(p));
    model.catch((e: Error) => setError(`Couldn't load the speech model: ${e.message}`));
    const s: Session = { stream, recorder, chunks: [], model, timer: setTimeout(() => stopLocal(), MAX_SECONDS * 1000) };
    recorder.ondataavailable = (e) => e.data.size > 0 && s.chunks.push(e.data);
    recorder.onstop = () => void finishLocal(s, recorder.mimeType);
    session.current = s;
    recorder.start();
    setStatus('listening');
  }, [finishLocal, stopLocal]);

  const start = useCallback(() => {
    if (engine === 'browser') startBrowser();
    else if (engine === 'local') void startLocal();
  }, [engine, startBrowser, startLocal]);

  const stop = useCallback(() => {
    if (engine === 'browser') rec.current?.stop();
    else stopLocal();
  }, [engine, stopLocal]);

  useEffect(
    () => () => {
      rec.current?.stop();
      const s = session.current;
      if (s) {
        session.current = null;
        clearTimeout(s.timer);
        s.recorder.onstop = null;
        for (const t of s.stream.getTracks()) t.stop();
      }
    },
    [],
  );

  return {
    supported: engine !== null,
    engine,
    status,
    listening: status === 'listening',
    transcribing: status === 'transcribing',
    interim,
    /** Model download progress (0-100) while the on-device engine is loading; null otherwise. */
    progress,
    /** Whether the model still has to be downloaded on this browser (first use). */
    firstUse: engine === 'local' && !modelWasDownloaded(),
    error,
    start,
    stop,
  };
}

export type Dictation = ReturnType<typeof useDictation>;
