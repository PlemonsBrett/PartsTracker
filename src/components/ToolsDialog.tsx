import { useState } from 'react';
import { addTool, cleanTool, deleteTool, KIND_LABEL, KINDS, NAME_MAX, NOTES_MAX, updateTool } from '../lib/tools';
import type { Tool, ToolKind } from '../lib/types';
import Modal from './Modal';

interface Props {
  tools: Tool[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}

interface Draft {
  id: string | null;
  kind: ToolKind;
  name: string;
  notes: string;
}

const blank: Draft = { id: null, kind: 'multimeter', name: '', notes: '' };

/** The user's test equipment. Test plans use these names and specs, so the instructions fit what's on the bench. */
export default function ToolsDialog({ tools, onChanged, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(tools.length === 0 ? blank : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setErr('');
    try {
      await job();
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const save = () =>
    run(async () => {
      const clean = draft ? cleanTool(draft) : null;
      if (!draft || !clean) throw new Error('Give the tool a name, such as its make and model.');
      if (draft.id) await updateTool(draft.id, clean);
      else await addTool(clean);
      setDraft(null);
    });

  return (
    <Modal
      title="My tools"
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <button type="button" className="primary wide" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="hint">
        Add your test equipment with its make, model and specs. When Claude writes a test plan for a part, the steps are written for these
        tools, for example which button or jack to use, and powered tests stay inside your supply's limits.
      </p>

      {tools.length > 0 && (
        <ul className="tool-list" aria-label="Your tools">
          {tools.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <span className="tag">{KIND_LABEL[t.kind]}</span>
                {t.notes && <small>{t.notes}</small>}
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDraft({ id: t.id, kind: t.kind, name: t.name, notes: t.notes ?? '' })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${t.name}?`)) void run(() => deleteTool(t.id));
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="stack tool-form">
          <h3>{draft.id ? 'Edit tool' : 'Add a tool'}</h3>
          <label>
            Type
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ToolKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Make and model
            <input
              value={draft.name}
              maxLength={NAME_MAX}
              placeholder="e.g. FNIRSI DMT-99"
              autoCapitalize="words"
              autoCorrect="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Specs and limits (optional)
            <textarea
              rows={4}
              maxLength={NOTES_MAX}
              placeholder="Ranges, ratings, fuse, channels, anything that limits what it can safely do"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              value={draft.notes}
            />
          </label>
          {err && <p className="msg">{err}</p>}
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save tool'}
            </button>
            {tools.length > 0 && (
              <button type="button" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {err && <p className="msg">{err}</p>}
          <button type="button" onClick={() => setDraft(blank)}>
            ＋ Add a tool
          </button>
        </>
      )}
    </Modal>
  );
}
