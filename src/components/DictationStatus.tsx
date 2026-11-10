import type { Dictation } from '../lib/dictation';

/** One line under the dictate button: what is happening, or what to expect the first time. */
export default function DictationStatus({ dict }: { dict: Dictation }) {
  if (!dict.supported) return null;
  const loading = dict.progress !== null && dict.progress < 100;
  let text = '';
  if (dict.error) text = dict.error;
  else if (dict.transcribing) text = loading ? `Getting the speech model ready… ${dict.progress}%` : 'Turning your speech into text…';
  else if (dict.listening && dict.engine === 'local')
    text = loading ? `Listening… (speech model downloading, ${dict.progress}%; keep talking)` : 'Listening… press Stop when you are done.';
  else if (dict.engine === 'local' && dict.firstUse)
    text = 'Dictation runs on this device. The first time, it downloads a speech model (about 76 MB) that your browser then keeps.';
  if (!text) return null;
  return (
    <small className={dict.error ? 'msg' : 'hint'} role="status">
      {text}
    </small>
  );
}
