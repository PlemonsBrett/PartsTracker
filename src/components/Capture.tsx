import { useRef, useState } from 'react';
import { useDictation } from '../lib/dictation';
import { imageToBase64, parseInventory } from '../lib/items';
import type { Item, Proposal } from '../lib/types';
import Modal from './Modal';

type Row = Proposal & { key: string };

interface Props {
  items: Item[];
  onApply: (p: Proposal[]) => Promise<void>;
  onClose: () => void;
}

const OP_LABEL = { add: 'Add', remove: 'Remove', set: 'Set to' } as const;

export default function Capture({ items, onApply, onClose }: Props) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [proposals, setProposals] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const nameOf = (id: string | null) => items.find((i) => i.id === id);

  const dict = useDictation((t) => setText((prev) => (prev ? `${prev} ` : '') + t));

  function pickPhoto(f?: File) {
    if (!f) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  }

  async function analyze() {
    setBusy(true);
    setErr('');
    try {
      dict.stop();
      const img = photo ? await imageToBase64(photo) : undefined;
      const out = await parseInventory({ text: text || undefined, image: img?.data, mediaType: img?.mediaType });
      if (!out.length) setErr('Nothing recognised — try adding a few details.');
      setProposals(out.map((p) => ({ ...p, key: crypto.randomUUID() })));
      setPicked(out.map(() => true));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function apply() {
    setBusy(true);
    setErr('');
    try {
      await onApply(proposals!.filter((_, i) => picked[i]));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const edit = (i: number, patch: Partial<Proposal>) => setProposals(proposals!.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <Modal label="Quick capture" onClose={onClose}>
      <div className="stack">
        <h2>Quick capture</h2>
        {!proposals ? (
          <>
            <p className="hint">Snap a photo, type, or dictate — e.g. “bought 50 10k 0805 resistors, bin A3” or “used 4 ATmega328P”.</p>
            <div className="capture-tools">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />
              <button type="button" onClick={() => fileRef.current?.click()}>
                📷 Photo
              </button>
              {dict.supported ? (
                <button type="button" className={dict.listening ? 'rec' : ''} onClick={dict.listening ? dict.stop : dict.start}>
                  {dict.listening ? '⏹ Stop' : '🎤 Dictate'}
                </button>
              ) : (
                <small>Voice not supported in this browser</small>
              )}
            </div>
            {preview && <img className="preview" src={preview} alt="Selected part" />}
            <textarea
              rows={4}
              placeholder="Describe what you're adding or using…"
              value={text + (dict.interim ? ` ${dict.interim}` : '')}
              onChange={(e) => setText(e.target.value)}
            />
            {err && <p className="msg">{err}</p>}
            <div className="actions">
              <span className="grow" />
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy || (!text.trim() && !photo)} onClick={analyze}>
                {busy ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">Review before saving. Uncheck anything wrong or fix the numbers.</p>
            <ul className="proposals">
              {proposals.map((p, i) => {
                const match = nameOf(p.item_id);
                return (
                  <li key={p.key}>
                    <label className="pick">
                      <input
                        type="checkbox"
                        checked={picked[i]}
                        onChange={(e) => setPicked(picked.map((x, j) => (j === i ? e.target.checked : x)))}
                      />
                      <span>
                        <strong>{match ? match.name : p.name}</strong>
                        <small>
                          {match ? `existing · now ${match.quantity}` : 'new item'}
                          {[p.value, p.package, p.location]
                            .filter(Boolean)
                            .map((x) => ` · ${x}`)
                            .join('')}
                        </small>
                        {p.note && <small className="warn-text">⚠ {p.note}</small>}
                      </span>
                    </label>
                    <div className="op">
                      <select value={p.op} onChange={(e) => edit(i, { op: e.target.value as Proposal['op'] })}>
                        {Object.entries(OP_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={p.quantity}
                        onChange={(e) => edit(i, { quantity: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {err && <p className="msg">{err}</p>}
            <div className="actions">
              <button type="button" onClick={() => setProposals(null)}>
                Back
              </button>
              <span className="grow" />
              <button type="button" className="primary" disabled={busy || !picked.some(Boolean)} onClick={apply}>
                {busy ? 'Saving…' : `Apply ${picked.filter(Boolean).length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
