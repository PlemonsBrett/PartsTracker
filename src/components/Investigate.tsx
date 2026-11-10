import { useState } from 'react';
import { requestPlan, saveInvestigation, toggleDone } from '../lib/investigate';
import type { Investigation, Item } from '../lib/types';
import Modal from './Modal';

interface Props {
  item: Item;
  hasTools: boolean;
  onOpenTools: () => void;
  /** Called after the plan or the resolved flag changed, so the part list refreshes. */
  onChanged: () => Promise<void>;
  /** Hands the user over to "Update from photos & notes" with their test results. */
  onRecord: () => void;
  onClose: () => void;
}

/** A test plan for a part the model wasn't sure about, written for the user's own tools. */
export default function Investigate({ item, hasTools, onOpenTools, onChanged, onRecord, onClose }: Props) {
  const inv: Investigation = item.investigation ?? { unknowns: [] };
  const [plan, setPlan] = useState(inv.plan ?? null);
  const [done, setDone] = useState<number[]>(inv.done ?? []);
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function make() {
    setBusy(true);
    setErr('');
    try {
      const next = await requestPlan({ itemId: item.id, unknowns: inv.unknowns, text: context.trim() });
      await saveInvestigation(item.id, { ...inv, plan: next, done: [], resolved: false });
      setPlan(next);
      setDone([]);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  // Ticks are saved as you go, so the bench session survives a reload or a phone going to sleep.
  async function tick(index: number) {
    const next = toggleDone(done, index);
    setDone(next);
    try {
      await saveInvestigation(item.id, { ...inv, plan: plan ?? undefined, done: next });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      await saveInvestigation(item.id, { ...inv, plan: plan ?? undefined, done, resolved: true });
      await onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Investigate"
      onClose={onClose}
      footer={
        plan ? (
          <>
            <button type="button" disabled={busy} onClick={make}>
              {busy ? 'Working…' : '↻ New plan'}
            </button>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy} onClick={onRecord}>
              Record results
            </button>
          </>
        ) : (
          <>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy} onClick={make}>
              {busy ? 'Making a plan…' : 'Make a test plan'}
            </button>
          </>
        )
      }
    >
      <p>
        <strong>{item.name}</strong>
      </p>

      {inv.unknowns.length > 0 && (
        <div>
          <small className="hint">Not sure about:</small>
          <ul className="chips-static">
            {inv.unknowns.map((u) => (
              <li key={u} className="tag warn">
                {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasTools && (
        <p className="uncertain">
          I don't know your test equipment yet, so this plan will be general.{' '}
          <button type="button" className="link" onClick={onOpenTools}>
            Add your tools
          </button>
        </p>
      )}

      {!plan ? (
        <>
          <p className="hint">
            Claude will write short tests to find out what this is, using the tools you have. Unpowered checks come first, and any powered
            test comes with limits for your supply.
          </p>
          <label className="stack">
            <small className="hint">Anything else worth knowing? (optional)</small>
            <textarea
              rows={3}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder='e.g. "came in an unmarked bag with a few others", "has 4 pins and a small chip on the back"'
            />
          </label>
        </>
      ) : (
        <>
          {plan.goal && <p>{plan.goal}</p>}
          {plan.safety.length > 0 && (
            <ul className="safety" aria-label="Safety">
              {plan.safety.map((s) => (
                <li key={s}>⚠ {s}</li>
              ))}
            </ul>
          )}
          <ol className="steps" aria-label="Test steps">
            {plan.steps.map((s, i) => (
              <li key={s.title} className={done.includes(i) ? 'done' : ''}>
                <label>
                  <input type="checkbox" checked={done.includes(i)} onChange={() => tick(i)} />
                  <span>
                    <strong>{s.title}</strong>
                    <span className="tag">{s.tool}</span>
                    <span>{s.instructions}</span>
                    {s.expect && (
                      <span className="expect">
                        <b>Expect:</b> {s.expect}
                      </span>
                    )}
                    {s.caution && <span className="caution">⚠ {s.caution}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ol>
          {plan.missing_tools.length > 0 && <p className="hint">Would help, but you don't have: {plan.missing_tools.join(', ')}.</p>}
          {plan.record && (
            <p>
              <b>Write down:</b> {plan.record}
            </p>
          )}
          <button type="button" disabled={busy} onClick={resolve}>
            Mark as resolved
          </button>
        </>
      )}
      {err && <p className="msg">{err}</p>}
    </Modal>
  );
}
