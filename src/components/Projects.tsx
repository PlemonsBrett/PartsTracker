import { useCallback, useEffect, useRef, useState } from 'react';
import { isDiagram, requestDiagram } from '../lib/diagram';
import {
  addPart,
  cleanName,
  createProject,
  deleteProject,
  listParts,
  listProjects,
  NAME_MAX,
  partState,
  pickable,
  putBackParts,
  ROLE_MAX,
  removePart,
  STATUS_LABEL,
  STATUSES,
  shoppingList,
  summarize,
  takeParts,
  takePlan,
  updatePart,
  updateProject,
} from '../lib/projects';
import type { Item, Project, ProjectPart, ProjectStatus } from '../lib/types';
import DiagramView from './DiagramView';
import Ideas from './Ideas';
import Modal from './Modal';
import StepNote from './StepNote';

interface Props {
  items: Item[];
  /** Called after the inventory changed (parts used or put back), so the main list refreshes. */
  onItemsChanged: () => Promise<void>;
  onClose: () => void;
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Projects({ items, onItemsChanged, onClose }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'ideas'>('list');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const open = projects?.find((p) => p.id === openId);
  if (open)
    return (
      <ProjectDetail
        key={open.id}
        project={open}
        items={items}
        onItemsChanged={onItemsChanged}
        onBack={() => {
          setOpenId(null);
          void reload();
        }}
        onClose={onClose}
        onDeleted={() => {
          setOpenId(null);
          void reload();
        }}
      />
    );

  if (view === 'ideas')
    return (
      <Ideas
        items={items}
        onBack={() => setView('list')}
        onClose={onClose}
        onStarted={async (id) => {
          await reload();
          setView('list');
          setOpenId(id);
        }}
      />
    );

  async function create() {
    const n = cleanName(name);
    if (!n) return;
    try {
      const p = await createProject(n);
      setName('');
      await reload();
      setOpenId(p.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal
      title="Projects"
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
        A project keeps your notes, the parts it needs (from your inventory or still to get), and a wiring diagram Claude can draw from
        them.
      </p>
      <button type="button" className="primary ideas-button" onClick={() => setView('ideas')}>
        💡 Ideas from my parts
      </button>
      <form
        className="project-new"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          type="text"
          aria-label="New project name"
          placeholder="New project, e.g. ATtiny LED blinker"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!cleanName(name)}>
          Start
        </button>
      </form>
      {err && <p className="msg">{err}</p>}
      {projects === null && !err && <p className="hint">Loading…</p>}
      {projects?.length === 0 && <p className="hint">No projects yet.</p>}
      <ul className="project-list">
        {projects?.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpenId(p.id)}>
              <strong>{p.name}</strong>
              <span className={`tag status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
              <small>{p.description || `Updated ${when(p.updated_at)}`}</small>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

interface DetailProps {
  project: Project;
  items: Item[];
  onItemsChanged: () => Promise<void>;
  onBack: () => void;
  onClose: () => void;
  onDeleted: () => void;
}

function ProjectDetail({ project, items, onItemsChanged, onBack, onClose, onDeleted }: DetailProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [notes, setNotes] = useState(project.notes ?? '');
  const [diagram, setDiagram] = useState(isDiagram(project.diagram) ? project.diagram : null);
  const [parts, setParts] = useState<ProjectPart[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(true);
  const [diagramText, setDiagramText] = useState('');
  const [drawing, setDrawing] = useState(false);

  // ---- autosave of the project's own fields, one save at a time so they cannot finish out of order ----
  const latest = useRef({ name, description, status, notes });
  latest.current = { name, description, status, notes };
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return queue.current;
    dirty.current = false;
    const v = latest.current;
    queue.current = queue.current
      .then(() =>
        updateProject(project.id, {
          name: cleanName(v.name) ?? project.name,
          description: v.description.trim() || null,
          status: v.status,
          notes: v.notes.trim() ? v.notes : null,
        }),
      )
      .then(() => setSaved(!dirty.current))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return queue.current;
  }, [project.id, project.name]);
  const touch = () => {
    dirty.current = true;
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  };
  // Closing straight after typing still saves.
  useEffect(() => () => void save(), [save]);

  const reloadParts = useCallback(async () => {
    try {
      setParts(await listParts(project.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [project.id]);
  useEffect(() => {
    void reloadParts();
  }, [reloadParts]);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await job();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const summary = summarize(parts, items);
  const plan = takePlan(parts, items);
  const matches = pickable(items, parts, query);

  const addFromInventory = (item: Item) =>
    run(async () => {
      setQuery('');
      await addPart(project.id, { item_id: item.id, name: item.name, quantity: 1 });
      await reloadParts();
    });
  const addToGet = () =>
    run(async () => {
      const n = cleanName(query);
      if (!n) return;
      setQuery('');
      await addPart(project.id, { name: n, quantity: 1 });
      await reloadParts();
    });

  const patchPart = (id: string, patch: Partial<Pick<ProjectPart, 'quantity' | 'role'>>) => {
    setParts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const commitPart = (id: string, patch: Partial<Pick<ProjectPart, 'quantity' | 'role'>>) =>
    run(async () => {
      await updatePart(id, patch);
    });

  const takeFromStock = () =>
    run(async () => {
      const lines = plan.filter((x) => x.take > 0).map((x) => `• ${x.take} × ${x.part.name}${x.missing ? ` (${x.missing} short)` : ''}`);
      if (!lines.length) throw new Error('Nothing in stock to take.');
      if (!window.confirm(`Take these from your inventory?\n\n${lines.join('\n')}\n\nYou can put them back afterwards.`)) return;
      const short = await takeParts(parts);
      await Promise.all([reloadParts(), onItemsChanged()]);
      setMsg(
        short.length
          ? `Taken from your inventory. Short: ${short.map((s) => `${s.missing} × ${s.name}`).join(', ')}.`
          : 'Taken from your inventory.',
      );
    });
  const putBack = () =>
    run(async () => {
      await putBackParts(parts);
      await Promise.all([reloadParts(), onItemsChanged()]);
      setMsg('Put back in your inventory.');
    });

  async function generate() {
    setDrawing(true);
    setErr('');
    setMsg('');
    try {
      await save();
      const out = await requestDiagram({ projectId: project.id, text: diagramText });
      await updateProject(project.id, { diagram: out.diagram });
      setDiagram(out.diagram);
      // Fill in "where it goes" for parts the owner left blank; their own words are never replaced.
      const fills = out.refs.flatMap((r) => {
        const role = out.diagram.parts.find((p) => p.ref === r.ref)?.role;
        const part = parts.find((p) => p.id === r.part_id);
        return role && part && !part.role?.trim() ? [{ id: part.id, role: role.slice(0, ROLE_MAX) }] : [];
      });
      await Promise.all(fills.map((f) => updatePart(f.id, { role: f.role })));
      await reloadParts();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setDrawing(false);
  }

  const externals = diagram?.parts.filter((p) => p.external) ?? [];

  return (
    <Modal
      title={name || 'Project'}
      onClose={() => {
        void save();
        onClose();
      }}
      footer={
        <>
          <button
            type="button"
            onClick={async () => {
              await save();
              onBack();
            }}
          >
            ← All projects
          </button>
          <span className="grow" />
          <small className="hint">{saved ? 'Saved' : 'Saving…'}</small>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            touch();
          }}
          onBlur={() => void save()}
        />
      </label>
      <div className="row2">
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ProjectStatus);
              touch();
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>What is it?</span>
          <input
            type="text"
            value={description}
            maxLength={2000}
            placeholder="One line, e.g. blink an LED from a coin cell"
            onChange={(e) => {
              setDescription(e.target.value);
              touch();
            }}
            onBlur={() => void save()}
          />
        </label>
      </div>

      <section className="project-notes">
        <h3>Notes</h3>
        <StepNote
          value={notes}
          label="Project notes"
          minRows={4}
          placeholder="Plans, measurements, things to remember… you can dictate too."
          onChange={(t) => {
            setNotes(t);
            touch();
          }}
          onBlur={() => void save()}
        />
      </section>

      <section>
        <h3>Parts</h3>
        {parts.length === 0 && <p className="hint">Add parts from your inventory, or name a part you still need to get.</p>}
        <ul className="project-parts">
          {parts.map((p) => {
            const s = partState(p, items);
            return (
              <li key={p.id} className={s.kind}>
                <div className="pp-main">
                  <strong>{p.name}</strong>
                  <span className={`tag pp-${s.kind}`}>
                    {s.kind === 'ok' && `have ${s.have}`}
                    {s.kind === 'short' && `have ${s.have}, need ${s.missing} more`}
                    {s.kind === 'to-get' && 'not in inventory'}
                    {s.kind === 'used' && `✓ ${s.taken} taken from stock`}
                  </span>
                </div>
                <div className="pp-edit">
                  <label>
                    <span className="sr">Quantity needed</span>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={p.quantity}
                      disabled={Boolean(p.used_at)}
                      onChange={(e) => patchPart(p.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      onBlur={() => void commitPart(p.id, { quantity: p.quantity })}
                    />
                  </label>
                  <input
                    type="text"
                    aria-label={`Where ${p.name} goes`}
                    placeholder="Where it goes…"
                    maxLength={ROLE_MAX}
                    value={p.role ?? ''}
                    onChange={(e) => patchPart(p.id, { role: e.target.value })}
                    onBlur={() => void commitPart(p.id, { role: p.role?.trim() || null })}
                  />
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Remove ${p.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await removePart(p.id);
                        await reloadParts();
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="add-part">
          <input
            type="search"
            aria-label="Add a part"
            placeholder="Add a part: search your inventory, or type a new one…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && (
            <ul className="matches">
              {matches.map((i) => (
                <li key={i.id}>
                  <button type="button" disabled={busy} onClick={() => addFromInventory(i)}>
                    ＋ {i.name} <small>{i.quantity} in stock</small>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" disabled={busy || !cleanName(query)} onClick={addToGet}>
                  ＋ Add “{query.trim().slice(0, 40)}” as a part I don't have
                </button>
              </li>
            </ul>
          )}
        </div>

        {parts.length > 0 && (
          <div className={`stock ${summary.ready ? 'ready' : 'missing'}`} role="status">
            {summary.used === parts.length ? (
              <p>✓ All parts have been taken from your inventory.</p>
            ) : summary.ready ? (
              <p>✓ Everything you need is in stock.</p>
            ) : (
              <>
                {summary.toGet.length > 0 && (
                  <p>
                    <strong>Not in your inventory:</strong> {summary.toGet.map((p) => `${p.quantity} × ${p.name}`).join(', ')}
                  </p>
                )}
                {summary.short.length > 0 && (
                  <p>
                    <strong>Not enough in stock:</strong>{' '}
                    {summary.short.map((x) => `${x.part.name} (have ${x.have}, need ${x.part.quantity})`).join(', ')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shoppingList(summary));
                      setMsg('Shopping list copied.');
                    } catch {
                      setErr('Could not copy. Select the text above instead.');
                    }
                  }}
                >
                  Copy shopping list
                </button>
              </>
            )}
          </div>
        )}
        <div className="part-actions">
          <button type="button" className="primary" disabled={busy || !plan.some((x) => x.take > 0)} onClick={takeFromStock}>
            Use these parts (take from inventory)
          </button>
          {summary.used > 0 && (
            <button type="button" disabled={busy} onClick={putBack}>
              Put back
            </button>
          )}
        </div>
      </section>

      <section>
        <h3>Wiring diagram</h3>
        <p className="hint">
          Claude draws how the parts connect, using their pinouts and your notes, and says where each part goes. Check it against the
          datasheets before you wire anything.
        </p>
        <input
          type="text"
          aria-label="Instructions for the diagram"
          placeholder="Optional: e.g. power it from a 3V coin cell, LED on PB0"
          value={diagramText}
          onChange={(e) => setDiagramText(e.target.value)}
        />
        <div className="part-actions">
          <button type="button" className="primary" disabled={drawing || busy || parts.length === 0} onClick={generate}>
            {drawing ? 'Drawing…' : diagram ? 'Draw it again' : 'Generate diagram'}
          </button>
        </div>
        {diagram && (
          <>
            <DiagramView diagram={diagram} />
            {externals.length > 0 && (
              <div className="stock missing">
                <p>
                  <strong>Also needed, not in your parts list:</strong>
                </p>
                <ul>
                  {externals.map((x) => (
                    <li key={x.ref}>
                      {x.label}{' '}
                      <button
                        type="button"
                        disabled={busy || parts.some((p) => p.name.toLowerCase() === x.label.toLowerCase())}
                        onClick={() =>
                          run(async () => {
                            await addPart(project.id, { name: x.label, role: x.role });
                            await reloadParts();
                          })
                        }
                      >
                        Add to parts
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {diagram.notes.length > 0 && (
              <ul className="diagram-notes">
                {diagram.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {msg && (
        <p className="hint" role="status">
          {msg}
        </p>
      )}
      {err && <p className="msg">{err}</p>}

      <section>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!window.confirm(`Delete “${project.name}”? Parts already taken from your inventory are not put back.`)) return;
              dirty.current = false;
              await deleteProject(project.id);
              onDeleted();
            })
          }
        >
          Delete project
        </button>
      </section>
    </Modal>
  );
}
