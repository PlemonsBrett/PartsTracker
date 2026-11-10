import { useCallback, useEffect, useRef, useState } from 'react';
import { compileResults, hasProgress, requestPlan, saveInvestigation, setStepNote, toggleDone } from '../lib/investigate';
import { mergeNote, updateItem } from '../lib/items';
import type { Investigation, Item } from '../lib/types';
import Modal from './Modal';
import StepNote from './StepNote';

interface Props {
  item: Item;
  hasTools: boolean;
  onOpenTools: () => void;
  /** Called after the plan, the part's notes or the resolved flag changed, so the part list refreshes. */
  onChanged: () => Promise<void>;
  /** Hands the user over to "Update from photos & notes", with their results already written out. */
  onRecord: (results: string) => void;
  onClose: () => void;
}

type Saved = 'idle' | 'saving' | 'saved';
const EMPTY_RESULTS = compileResults(null, [], {});

/** A test plan for a part the model wasn't sure about, written for the user's own tools, with room for notes on every step. */
export default function Investigate({ item, hasTools, onOpenTools, onChanged, onRecord, onClose }: Props) {
  const inv: Investigation = item.investigation ?? { unknowns: [] };
  const [plan, setPlan] = useState(inv.plan ?? null);
  const [done, setDone] = useState<number[]>(inv.done ?? []);
  const [notes, setNotes] = useState<Record<string, string>>(inv.notes ?? {});
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [saved, setSaved] = useState<Saved>('idle');

  // One place writes progress: ticks and notes share it, so a slow save of one can never overwrite the other.
  const latest = useRef({ plan, done, notes });
  latest.current = { plan, done, notes };
  const base = useRef(inv);
  base.current = item.investigation ?? { unknowns: [] };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Saves run strictly one after another, and each writes whatever is newest when its turn comes. Two overlapping
  // requests could otherwise finish out of order and leave older text stored.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    queue.current = queue.current.then(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      setSaved('saving');
      try {
        const { plan: p, done: d, notes: n } = latest.current;
        await saveInvestigation(item.id, { ...base.current, plan: p ?? undefined, done: d, notes: n });
        setSaved(dirty.current ? 'idle' : 'saved'); // something newer is already waiting: not saved yet
      } catch (e) {
        dirty.current = true;
        setSaved('idle');
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
    return queue.current;
  }, [item.id]);

  const schedule = useCallback(
    (ms: number) => {
      dirty.current = true;
      setSaved('idle');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), ms);
    },
    [flush],
  );

  // Anything still waiting is written when the dialog goes away.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) {
        const { plan: p, done: d, notes: n } = latest.current;
        void saveInvestigation(item.id, { ...base.current, plan: p ?? undefined, done: d, notes: n });
      }
    },
    [item.id],
  );

  const close = useCallback(async () => {
    await flush(); // finish saving before the parent reloads, or it would show the old notes
    onClose();
  }, [flush, onClose]);

  async function make() {
    if (
      plan &&
      hasProgress(done, notes) &&
      !confirm("Replace this plan? What you've written so far is added to the part's notes first, so nothing is lost.")
    )
      return;
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      await flush();
      const next = await requestPlan({ itemId: item.id, unknowns: inv.unknowns, text: context.trim() });
      if (plan && hasProgress(done, notes)) {
        const text = mergeNote(item.notes, compileResults(plan, done, notes));
        if (text) await updateItem(item.id, { notes: text });
      }
      await saveInvestigation(item.id, { ...base.current, plan: next, done: [], notes: {}, resolved: false });
      setPlan(next);
      setDone([]);
      setNotes({});
      setSaved('idle');
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const tick = (index: number) => {
    setDone((d) => toggleDone(d, index));
    schedule(300);
  };

  const editNote = (index: number, text: string) => {
    setNotes((n) => setStepNote(n, index, text));
    schedule(800);
  };

  async function saveToPartNotes() {
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      await flush();
      const results = compileResults(plan, done, notes);
      const text = mergeNote(item.notes, results);
      if (results === EMPTY_RESULTS) setInfo('Nothing to add yet: tick a step or write a note first.');
      else if (!text) setInfo("That's already in the part's notes.");
      else {
        await updateItem(item.id, { notes: text });
        setInfo("Added to the part's notes.");
        await onChanged();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function record() {
    await flush();
    onRecord(compileResults(plan, done, notes));
  }

  async function resolve() {
    setBusy(true);
    try {
      dirty.current = true;
      await flush();
      await saveInvestigation(item.id, { ...base.current, plan: plan ?? undefined, done, notes, resolved: true });
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
      onClose={() => void close()}
      footer={
        plan ? (
          <>
            <button type="button" disabled={busy} onClick={make}>
              {busy ? 'Working…' : '↻ New plan'}
            </button>
            <span className="grow" />
            <button type="button" className="primary wide" disabled={busy} onClick={record}>
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
          <p className="hint save-state" role="status">
            {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Everything is saved.' : 'Your ticks and notes are saved as you go.'}
          </p>
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
                <StepNote
                  label={`Notes for step ${i + 1}: ${s.title}`}
                  value={notes[String(i)] ?? ''}
                  onChange={(t) => editNote(i, t)}
                  onBlur={() => void flush()}
                />
              </li>
            ))}
          </ol>
          {plan.missing_tools.length > 0 && <p className="hint">Would help, but you don't have: {plan.missing_tools.join(', ')}.</p>}
          {plan.record && (
            <p>
              <b>Write down:</b> {plan.record}
            </p>
          )}
          <div className="actions wrap">
            <button type="button" disabled={busy} onClick={saveToPartNotes}>
              Save to the part's notes
            </button>
            <button type="button" disabled={busy} onClick={resolve}>
              Mark as resolved
            </button>
          </div>
          {info && (
            <p className="hint" role="status">
              {info}
            </p>
          )}
        </>
      )}
      {err && <p className="msg">{err}</p>}
    </Modal>
  );
}
