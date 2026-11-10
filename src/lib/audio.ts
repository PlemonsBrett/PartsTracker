/** Whisper wants mono audio at 16 kHz. */
export const WHISPER_RATE = 16000;
/** Anything shorter than this is a stray tap, not speech. */
export const MIN_SECONDS = 0.4;
/** Recording stops by itself after this long, so a forgotten microphone doesn't run forever. */
export const MAX_SECONDS = 600;

// Whisper writes "[BLANK_AUDIO]", "(silence)", "*music*" or note symbols for sound that isn't speech.
const NON_SPEECH = /\[[^\]]*\]|\((?:silence|music|noise|inaudible|blank)[^)]*\)|\*[^*]*\*|♪+/gi;

/** Only real words should reach the text box. Brackets that carry content, like "(0805)", are kept. */
export function cleanTranscript(text: string | null | undefined): string {
  const t = (text ?? '').replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

export interface FileProgress {
  loaded: number;
  total: number;
}

/**
 * Turns per-file download events into one percentage for the whole model.
 * Files are tracked by name; the total only counts files seen so far, so the figure can step back slightly as
 * new files appear, but it never exceeds 100.
 */
export function makeProgress() {
  const files = new Map<string, FileProgress>();
  return (file: string, loaded: number, total: number): number => {
    files.set(file, { loaded, total });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    return t > 0 ? Math.min(100, Math.round((l / t) * 100)) : 0;
  };
}

/** The recorded blob is compressed (Opus). Decode it, then resample to what Whisper expects. */
export async function toWhisperAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * WHISPER_RATE));
    const offline = new OfflineAudioContext(1, frames, WHISPER_RATE); // one channel: stereo is mixed down
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void ctx.close();
  }
}

export const secondsOf = (samples: { length: number }) => samples.length / WHISPER_RATE;
