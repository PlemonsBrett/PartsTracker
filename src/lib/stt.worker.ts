// Runs the speech model off the main thread so the page stays responsive while it loads and transcribes.
import { env, pipeline } from '@huggingface/transformers';
import { makeProgress } from './audio';

export const MODEL = 'onnx-community/whisper-base.en';

env.allowLocalModels = false; // models come from the Hugging Face hub and are cached by the browser after the first download

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const ctx = self as unknown as Scope;

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let loading: Promise<Transcriber> | null = null;

function load(): Promise<Transcriber> {
  if (!loading) {
    const overall = makeProgress();
    loading = (
      pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file && p.total)
            ctx.postMessage({ type: 'progress', value: overall(p.file, p.loaded ?? 0, p.total) });
        },
      }) as unknown as Promise<Transcriber>
    ).then((t) => {
      ctx.postMessage({ type: 'ready' });
      return t;
    });
    loading.catch(() => {
      loading = null; // let the next attempt retry, e.g. after the network comes back
    });
  }
  return loading;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array };
  try {
    if (msg.type === 'load') {
      await load();
    } else if (msg.type === 'transcribe') {
      const asr = await load();
      const out = await asr(msg.audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      ctx.postMessage({ type: 'result', id: msg.id, text });
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
