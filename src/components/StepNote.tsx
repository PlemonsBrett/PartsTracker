import { useDictation } from '../lib/dictation';
import DictationStatus from './DictationStatus';

interface Props {
  value: string;
  label: string;
  onChange: (text: string) => void;
  /** Called when the box loses focus, so a save does not wait for the typing delay. */
  onBlur: () => void;
  placeholder?: string;
  minRows?: number;
}

/** A notes box for one test step, with a microphone so a reading can be spoken instead of typed. */
export default function StepNote({
  value,
  label,
  onChange,
  onBlur,
  placeholder = 'Write down what you measured or saw…',
  minRows = 2,
}: Props) {
  const dict = useDictation((t) => onChange(value ? `${value} ${t}` : t));
  const lines = value.split('\n').length;

  return (
    <div className="step-note">
      <textarea
        aria-label={label}
        rows={Math.min(14, Math.max(minRows, lines + 1))}
        value={value + (dict.interim ? ` ${dict.interim}` : '')}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {dict.supported && (
        <button
          type="button"
          className={`icon${dict.listening ? ' rec' : ''}`}
          aria-label={dict.listening ? 'Stop dictating' : 'Dictate a note'}
          title={dict.listening ? 'Stop' : 'Dictate'}
          disabled={dict.transcribing}
          onClick={dict.listening ? dict.stop : dict.start}
        >
          {dict.listening ? '⏹' : dict.transcribing ? '…' : '🎤'}
        </button>
      )}
      <DictationStatus dict={dict} />
    </div>
  );
}
