import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteIdea, listIdeas, rankIdeas, requestIdeas, saveIdeas, startProject } from '../lib/ideas';
import type { IdeaRow, Item } from '../lib/types';
import Modal from './Modal';

interface Props {
  items: Item[];
  /** A project was made from an idea: open it. */
  onStarted: (projectId: string) => void;
  onBack: () => void;
  onClose: () => void;
}

const STATUS_LABEL = { have: 'in stock', short: 'not enough', buy: 'to buy' } as const;

/** Project ideas from Claude, best match first: the share of each idea's parts that are already in stock. */
export default function Ideas({ items, onStarted, onBack, onClose }: Props) {
  const [rows, setRows] = useState<IdeaRow[] | null>(null);
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      setRows(await listIdeas());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Worked out from today's inventory, so a restock or a used part changes the order.
  const ranked = useMemo(() => rankIdeas(rows ?? [], items), [rows, items]);

  async function suggest() {
    setBusy(true);
    setErr('');
    try {
      await saveIdeas(await requestIdeas({ text: wish.trim() }));
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function start(row: IdeaRow) {
    setBusy(true);
    setErr('');
    try {
      const id = await startProject(row.idea, items);
      await deleteIdea(row.id);
      onStarted(id);
      return;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function dismiss(row: IdeaRow) {
    setErr('');
    try {
      await deleteIdea(row.id);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal
      title="Ideas from my parts"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onBack}>
            ← All projects
          </button>
          <span className="grow" />
          <button type="button" className="primary wide" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="hint">
        Claude looks at what is in stock and suggests things to build. They are ranked by how much of each is already on your shelf. Parts
        you'd print use your 3D printers (add or change them in 🧰 My tools), and count as made, not bought.
      </p>
      <form
        className="project-new"
        onSubmit={(e) => {
          e.preventDefault();
          void suggest();
        }}
      >
        <input
          type="text"
          aria-label="What would you like to make"
          placeholder="Optional: e.g. a desk gadget, something for a beginner"
          maxLength={600}
          value={wish}
          onChange={(e) => setWish(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Thinking…' : '💡 Suggest'}
        </button>
      </form>
      {busy && <p className="hint">Claude is going through your parts. This can take a minute.</p>}
      {err && <p className="msg">{err}</p>}
      {rows === null && !err && <p className="hint">Loading…</p>}
      {rows?.length === 0 && !busy && <p className="hint">No ideas yet. Press Suggest.</p>}

      <ol className="ideas">
        {ranked.map(({ id, idea, score, created_at }) => (
          <li key={id} className="idea">
            <div className="idea-head">
              <strong>{idea.title}</strong>
              <span className={`pct ${score.percent >= 75 ? 'high' : score.percent >= 40 ? 'mid' : 'low'}`}>{score.percent}%</span>
            </div>
            <div className="meter" role="img" aria-label={`${score.percent}% of the parts are in stock`}>
              <span className="meter-fill" style={{ width: `${score.percent}%` }} />
            </div>
            <p className="idea-sum">{idea.summary}</p>
            <p className="idea-meta">
              <span className="tag">{idea.difficulty}</span>
              {idea.hours !== null && <span className="tag">~{idea.hours} h</span>}
              <span>
                {score.haveCount} of {score.required} in stock
                {score.shortCount > 0 && ` · ${score.shortCount} short`}
                {score.buyCount > 0 && ` · ${score.buyCount} to buy`}
                {score.printCount > 0 && ` · ${score.printCount} to print`}
              </span>
            </p>
            <details>
              <summary>Parts, printing and steps</summary>
              <ul className="idea-parts">
                {score.parts.map(({ part, status, have }) => (
                  <li key={`${part.item_id ?? 'new'}:${part.name}`} className={part.optional ? 'optional' : ''}>
                    <span>
                      {part.quantity} × {part.name}
                      {part.optional && ' (optional)'}
                      {part.role && <small> — {part.role}</small>}
                    </span>
                    <span className={`tag pp-${status === 'have' ? 'ok' : status === 'short' ? 'short' : 'to-get'}`}>
                      {status === 'short' ? `have ${have}, need ${part.quantity}` : STATUS_LABEL[status]}
                    </span>
                  </li>
                ))}
              </ul>
              {idea.printed.length > 0 && (
                <>
                  <h4>3D printed</h4>
                  <ul className="idea-parts">
                    {idea.printed.map((p) => (
                      <li key={`${p.printer}:${p.name}`}>
                        <span>
                          {p.name}
                          <small>
                            {' '}
                            — {p.printer}
                            {p.material && `, ${p.material}`}
                            {p.notes && `. ${p.notes}`}
                          </small>
                        </span>
                        <span className="tag">print</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {idea.tools_needed.length > 0 && <p className="idea-tools">Tools: {idea.tools_needed.join(', ')}</p>}
              {idea.steps.length > 0 && (
                <ol className="idea-steps">
                  {idea.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <small className="hint">
                Suggested {new Date(created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. Check part values and
                ratings before you build.
              </small>
            </details>
            <div className="part-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => start({ id, idea, created_at })}>
                Start this project
              </button>
              <button type="button" disabled={busy} onClick={() => dismiss({ id, idea, created_at })}>
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
