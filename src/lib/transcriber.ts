// Main-thread side of the on-device speech model. The worker (and the model download) only start on first use.
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
const listeners = new Set<(percent: number) => void>();
let onReady: (() => void) | null = null;
let onLoadError: ((e: Error) => void) | null = null;

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; value?: number; id?: number; text?: string; message?: string };
    if (m.type === 'progress') for (const l of listeners) l(m.value ?? 0);
    else if (m.type === 'ready') onReady?.();
    else if (m.type === 'result' && m.id !== undefined) {
      waiting.get(m.id)?.resolve(m.text ?? '');
      waiting.delete(m.id);
    } else if (m.type === 'error') {
      const err = new Error(m.message ?? 'Speech model failed');
      if (m.id !== undefined) {
        waiting.get(m.id)?.reject(err);
        waiting.delete(m.id);
      } else onLoadError?.(err);
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Speech model failed to start');
    onLoadError?.(err);
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
    worker = null;
    ready = null;
  };
  return worker;
}

const READY_KEY = 'partstracker.speechModelReady';

/** True once the model has been downloaded on this browser, so the first-use warning can go away. */
export function modelWasDownloaded(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

/** Starts the model download (once) and reports progress as 0-100. Safe to call repeatedly. */
export function loadModel(onProgress?: (percent: number) => void): Promise<void> {
  if (onProgress) listeners.add(onProgress);
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      onReady = () => {
        try {
          localStorage.setItem(READY_KEY, '1');
        } catch {
          // storage unavailable: the warning just shows again next time
        }
        resolve();
      };
      onLoadError = (e) => {
        ready = null;
        reject(e);
      };
      start().postMessage({ type: 'load' });
    });
  }
  return ready.finally(() => {
    if (onProgress) listeners.delete(onProgress);
  });
}

/** Transcribes 16 kHz mono audio. Waits for the model if it is still loading. */
export async function transcribe(audio: Float32Array): Promise<string> {
  await loadModel();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    start().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}
