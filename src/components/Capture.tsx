import { useEffect, useRef, useState } from 'react';
import { useDictation } from '../lib/dictation';
import { imageToBase64, parseInventory, unknownsOf } from '../lib/items';
import { readDictateOnOpen, writeDictateOnOpen } from '../lib/prefs';
import { hasFinePointer } from '../lib/shortcuts';
import type { Item, Proposal } from '../lib/types';
import DictationStatus from './DictationStatus';
import Modal from './Modal';

type Row = Proposal & { key: string };

interface Props {
  items: Item[];
  onApply: (p: Proposal[]) => Promise<void>;
  onClose: () => void;
  /** A photo taken before the dialog opened (camera button): analysed straight away. */
  initialPhoto?: File | null;
}

const OP_LABEL = { add: 'Add', remove: 'Remove', set: 'Set to' } as const;

export default function Capture({ items, onApply, onClose, initialPhoto }: Props) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [proposals, setProposals] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [dictateOnOpen, setDictateOnOpen] = useState(readDictateOnOpen);
  const nameOf = (id: string | null) => items.find((i) => i.id === id);

  const dict = useDictation((t) => setText((prev) => (prev ? `${prev} ` : '') + t));

  function pickPhoto(f?: File) {
    if (!f) return;
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  }

  async function analyze(file: File | null = photo) {
    setBusy(true);
    setErr('');
    try {
      dict.stop();
      const img = file ? await imageToBase64(file) : undefined;
      const out = await parseInventory({ text: text || undefined, image: img?.data, mediaType: img?.mediaType });
      if (!out.length) setErr('Nothing recognised — try adding a few details.');
      setProposals(out.map((p) => ({ ...p, key: crypto.randomUUID() })));
      setPicked(out.map(() => true));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  // On a computer, start with the cursor in the box, and with dictation running if that is the owner's habit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the dialog opens
  useEffect(() => {
    if (initialPhoto) return;
    if (hasFinePointer()) textRef.current?.focus();
    if (dictateOnOpen && dict.supported) dict.start();
  }, []);

  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount, guarded by a ref
  useEffect(() => {
    if (!initialPhoto || autoStarted.current) return;
    autoStarted.current = true;
    pickPhoto(initialPhoto);
    void analyze(initialPhoto);
  }, []);

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

  const chosen = picked.filter(Boolean).length;
  // With on-device dictation the words arrive after Stop, so analysing now would leave the last sentence out.
  const waitingForSpeech = dict.engine === 'local' && (dict.listening || dict.transcribing);
  const canAnalyze = !busy && !waitingForSpeech && (Boolean(text.trim()) || Boolean(photo));

  // Ctrl/Cmd+Enter does whatever the main button does.
  const primary = useRef<() => void>(() => undefined);
  primary.current = () => (proposals ? (!busy && chosen > 0 ? void apply() : undefined) : canAnalyze ? void analyze() : undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        primary.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal
      title="Quick capture"
      onClose={onClose}
      footer={
        !proposals ? (
          <>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={!canAnalyze} onClick={() => analyze()}>
              {busy ? 'Analyzing…' : 'Analyze'} <kbd>Ctrl ↵</kbd>
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setProposals(null)}>
              Back
            </button>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy || chosen === 0} onClick={apply}>
              {busy ? 'Saving…' : `Apply ${chosen}`} <kbd>Ctrl ↵</kbd>
            </button>
          </>
        )
      }
    >
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
              📷 {photo ? 'Retake' : 'Photo'}
            </button>
            {dict.supported ? (
              <button
                type="button"
                className={`dictate${dict.listening ? ' rec' : ''}`}
                disabled={dict.transcribing}
                onClick={dict.listening ? dict.stop : dict.start}
              >
                {dict.listening ? '⏹ Stop' : dict.transcribing ? 'Working…' : '🎤 Dictate'}
              </button>
            ) : (
              <small>Voice input isn't available in this browser</small>
            )}
          </div>
          <DictationStatus dict={dict} />
          {dict.supported && (
            <label className="check">
              <input
                type="checkbox"
                checked={dictateOnOpen}
                onChange={(e) => {
                  setDictateOnOpen(e.target.checked);
                  writeDictateOnOpen(e.target.checked);
                }}
              />
              Start dictating when this opens
            </label>
          )}
          {preview && <img className="preview" src={preview} alt="Selected part" />}
          <textarea
            ref={textRef}
            rows={4}
            placeholder="Describe what you're adding or using…"
            value={text + (dict.interim ? ` ${dict.interim}` : '')}
            onChange={(e) => setText(e.target.value)}
          />
          {err && <p className="msg">{err}</p>}
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
                      {unknownsOf(p).length > 0 && (
                        <small className="warn-text">🔎 Not sure: {unknownsOf(p).join(', ')}. You'll be offered a test plan.</small>
                      )}
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
        </>
      )}
    </Modal>
  );
}
