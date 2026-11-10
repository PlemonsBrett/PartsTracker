import { useState } from 'react';
import { updateItem } from '../lib/items';
import { type Layout, parsePinLines, pinProblem, pinsToLines } from '../lib/pinout';
import type { Item } from '../lib/types';
import Pinout from './Pinout';

const LAYOUT_LABEL: Record<Layout, string> = {
  single: 'Single row (header, module, wires)',
  dual: 'Dual-row chip (DIP, SOIC)',
  'three-lead': '3-lead (transistor, regulator)',
};

interface Props {
  item: Item;
  onChanged: () => Promise<void>;
}

/** Type a part's pins in, one per line, and see the diagram. Saved on the part itself, apart from the datasheet. */
export default function PinsEditor({ item, onChanged }: Props) {
  const saved = item.pinout;
  const [layout, setLayout] = useState<Layout>(saved?.layout ?? 'single');
  const [text, setText] = useState(saved ? pinsToLines(saved.pins) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const pins = parsePinLines(text);
  const problem = text.trim() ? pinProblem(pins, layout) : null;
  const drawable = pins.length > 0 && !problem;
  const unchanged = Boolean(saved) && saved?.layout === layout && pinsToLines(saved.pins) === pinsToLines(pins);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setMsg('');
    try {
      await job();
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const save = () => run(() => updateItem(item.id, { pinout: { layout, pins, source: 'manual' } }).then(() => undefined));
  const remove = () =>
    run(async () => {
      await updateItem(item.id, { pinout: null });
      setText('');
    });

  return (
    <details className="more pins-editor" open={Boolean(saved)}>
      <summary>{saved ? 'Pinout' : 'Add a pinout by hand'}</summary>
      <div className="stack">
        {saved && (
          <small className="hint">
            {saved.source === 'photo' ? 'Read from your photos. Check it against the part.' : 'Entered by hand.'}
          </small>
        )}
        <label>
          Arrangement
          <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
            {(Object.keys(LAYOUT_LABEL) as Layout[]).map((l) => (
              <option key={l} value={l}>
                {LAYOUT_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pins, one per line, pin 1 first
          <textarea
            rows={Math.min(10, Math.max(4, pins.length + 1))}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'DATA\nVCC\nGND'}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <small className="hint">
          Add <code>|power</code>, <code>|ground</code>, <code>|input</code>, <code>|output</code>, <code>|io</code> or <code>|nc</code>{' '}
          after a name to colour it (for example <code>SDA|io</code>). Power and ground are recognised from names like VCC and GND.{' '}
        </small>
        {problem && <p className="msg">{problem}</p>}
        {drawable && <Pinout pins={pins} layout={layout} title={item.part_number} collapsible={false} />}
        {msg && <p className="msg">{msg}</p>}
        <div className="actions">
          <button type="button" className="primary" disabled={busy || !drawable || unchanged} onClick={save}>
            {busy ? 'Saving…' : 'Save pinout'}
          </button>
          {saved && (
            <button type="button" className="danger" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
