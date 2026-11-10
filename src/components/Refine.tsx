import { useRef, useState } from 'react';
import { useDictation } from '../lib/dictation';
import { imageToBase64 } from '../lib/items';
import { type Accepted, acceptedCount, applyRefinement, FIELD_LABEL, type RefineField, type Refinement, refineItem } from '../lib/refine';
import type { Item } from '../lib/types';
import Modal from './Modal';
import Pinout from './Pinout';

const MAX_PHOTOS = 4;

interface Photo {
  id: string;
  file: File;
  url: string;
}

interface Props {
  item: Item;
  /** Pre-fills the comment box, e.g. when arriving from an investigation. */
  initialText?: string;
  onApplied: (patch: Record<string, unknown>) => void | Promise<void>;
  onClose: () => void;
}

export default function Refine({ item, initialText = '', onApplied, onClose }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<Refinement | null>(null);
  const [accepted, setAccepted] = useState<Accepted>({ fields: new Set(), notes: false, pinout: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const dict = useDictation((t) => setText((prev) => (prev ? `${prev} ` : '') + t));

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    addPhotos(e.target.files);
    e.target.value = ''; // lets the same photo be picked again
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...files]
      .slice(0, MAX_PHOTOS - photos.length)
      .map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
  }

  async function analyze() {
    setBusy(true);
    setErr('');
    try {
      dict.stop();
      const images = await Promise.all(photos.map((p) => imageToBase64(p.file)));
      const r = await refineItem({ itemId: item.id, text: text.trim(), images });
      setResult(r);
      // Everything proposed starts accepted; the review screen is where things get unticked.
      setAccepted({ fields: new Set(r.changes.map((c) => c.field)), notes: Boolean(r.notes_add), pinout: Boolean(r.pinout) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function apply() {
    if (!result) return;
    setBusy(true);
    setErr('');
    try {
      const patch = await applyRefinement(item, result, accepted);
      await onApplied(patch);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const toggleField = (f: RefineField, on: boolean) =>
    setAccepted((a) => {
      const fields = new Set(a.fields);
      if (on) fields.add(f);
      else fields.delete(f);
      return { ...a, fields };
    });

  const count = result ? acceptedCount(result, accepted) : 0;
  const nothing = result && result.changes.length === 0 && !result.notes_add && !result.pinout;

  return (
    <Modal
      title="Update from photos & notes"
      onClose={onClose}
      footer={
        !result ? (
          <>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy || (photos.length === 0 && !text.trim())} onClick={analyze}>
              {busy ? 'Analyzing…' : 'Analyze'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setResult(null)}>
              Back
            </button>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy || count === 0} onClick={apply}>
              {busy ? 'Saving…' : `Apply ${count}`}
            </button>
          </>
        )
      }
    >
      {!result ? (
        <>
          <p className="hint">
            Tell Claude what you've learned about <strong>{item.name}</strong>: more photos (the other side, markings, pins) and anything
            you measured or noticed. It proposes updates and you choose what to keep.
          </p>
          <div className="capture-tools">
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
            <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onPick} />
            <button type="button" disabled={photos.length >= MAX_PHOTOS} onClick={() => camera.current?.click()}>
              📷 Camera
            </button>
            <button type="button" disabled={photos.length >= MAX_PHOTOS} onClick={() => gallery.current?.click()}>
              🖼 Photos
            </button>
            {dict.supported && (
              <button type="button" className={dict.listening ? 'rec' : ''} onClick={dict.listening ? dict.stop : dict.start}>
                {dict.listening ? '⏹ Stop' : '🎤'}
              </button>
            )}
          </div>
          {photos.length > 0 && (
            <ul className="photos" aria-label="Photos to analyze">
              {photos.map((p) => (
                <li key={p.id}>
                  <img src={p.url} alt="Selected" />
                  <button
                    type="button"
                    className="icon"
                    aria-label="Remove photo"
                    onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <small className="hint">Up to {MAX_PHOTOS} photos.</small>
          <textarea
            rows={5}
            placeholder={'e.g. "Board is marked CNT5. 5.1k between pins 1 and 2. Pin 1 is next to the resistor."'}
            value={text + (dict.interim ? ` ${dict.interim}` : '')}
            onChange={(e) => setText(e.target.value)}
          />
          {err && <p className="msg">{err}</p>}
        </>
      ) : (
        <>
          {result.summary && <p>{result.summary}</p>}
          {result.uncertain.length > 0 && (
            <ul className="uncertain" aria-label="Not sure about">
              {result.uncertain.map((u) => (
                <li key={u}>⚠ {u}</li>
              ))}
            </ul>
          )}
          {nothing ? (
            <p className="hint">Nothing to change: what's saved already matches.</p>
          ) : (
            <ul className="diffs">
              {result.changes.map((c) => (
                <li key={c.field}>
                  <label>
                    <input
                      type="checkbox"
                      checked={accepted.fields.has(c.field)}
                      onChange={(e) => toggleField(c.field, e.target.checked)}
                    />
                    <span>
                      <strong>{FIELD_LABEL[c.field]}</strong>
                      {c.from && <span className="old">{c.from}</span>}
                      <span className="new">{c.to}</span>
                    </span>
                  </label>
                </li>
              ))}
              {result.notes_add && (
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={accepted.notes}
                      onChange={(e) => setAccepted((a) => ({ ...a, notes: e.target.checked }))}
                    />
                    <span>
                      <strong>Add to notes</strong>
                      <span className="new">{result.notes_add}</span>
                    </span>
                  </label>
                </li>
              )}
              {result.pinout && (
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={accepted.pinout}
                      onChange={(e) => setAccepted((a) => ({ ...a, pinout: e.target.checked }))}
                    />
                    <span>
                      <strong>Pinout{item.pinout ? ' (replaces the saved one)' : ''}</strong>
                      <span className="hint">Read from the photos and comments. Check it against the part.</span>
                    </span>
                  </label>
                  <Pinout pins={result.pinout.pins} layout={result.pinout.layout} title={item.part_number} collapsible={false} />
                </li>
              )}
            </ul>
          )}
          {err && <p className="msg">{err}</p>}
        </>
      )}
    </Modal>
  );
}
