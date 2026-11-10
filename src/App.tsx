import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Capture from './components/Capture';
import ExportMenu from './components/ExportMenu';
import Investigate from './components/Investigate';
import ItemForm from './components/ItemForm';
import ItemRow from './components/ItemRow';
import Login from './components/Login';
import Refine from './components/Refine';
import ShortcutsHelp from './components/ShortcutsHelp';
import ToolsDialog from './components/ToolsDialog';
import { findDatasheet, wantsLookup } from './lib/datasheets';
import { plural } from './lib/format';
import { needsInvestigation } from './lib/investigate';
import { applyProposals, createItem, deleteItem, listItems, updateItem } from './lib/items';
import { searchItems } from './lib/search';
import { actionFor, isTypingTarget, moveSelection } from './lib/shortcuts';
import { configured, supabase } from './lib/supabase';
import { listTools } from './lib/tools';
import type { Item, ItemInput, Proposal, Tool } from './lib/types';
import { nextUndo, type Undo } from './lib/undo';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured)
    return (
      <main className="card">
        <h1>Not configured</h1>
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).
        </p>
      </main>
    );
  if (!ready) return null;
  return session ? <Inventory /> : <Login />;
}

const PROMPT_KEY = 'partstracker.toolsPromptHidden';

// Browser storage can be unavailable (private windows, blocked site data); the prompt just shows again then.
function readPromptHidden(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

function hidePrompt() {
  try {
    localStorage.setItem(PROMPT_KEY, '1');
  } catch {
    // nothing to do
  }
}

function Inventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [note, setNote] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [refineText, setRefineText] = useState('');
  const [investigatingId, setInvestigatingId] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[] | null>(null); // null until loaded
  const [toolsOpen, setToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [toolsPromptHidden, setToolsPromptHidden] = useState(readPromptHidden);
  const [formVersion, setFormVersion] = useState(0); // bumped when a refinement lands, so the open form shows the new values
  const [cameraPhoto, setCameraPhoto] = useState<File | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setItems(await listItems());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);
  const reloadTools = useCallback(async () => {
    try {
      setTools(await listTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTools([]);
    }
  }, []);
  useEffect(() => {
    reloadTools();
  }, [reloadTools]);

  useEffect(() => {
    reload();
  }, [reload]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);
  const visible = useMemo(() => {
    let r = searchItems(items, query);
    if (category) r = r.filter((i) => i.category === category);
    if (lowOnly) r = r.filter((i) => i.min_quantity > 0 && i.quantity <= i.min_quantity);
    return r;
  }, [items, query, category, lowOnly]);

  // Optimistic quantity write; roll back by reloading if it fails.
  async function writeQty(id: string, qty: number) {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, quantity: qty } : i)));
    try {
      await updateItem(id, { quantity: qty });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    }
  }

  // Row changes (buttons, typed count, swipe) offer a short-lived Undo.
  function changeQty(item: Item, qty: number) {
    setUndo((prev) => nextUndo(prev, item, qty));
    void writeQty(item.id, qty);
  }

  function undoLast() {
    if (!undo) return;
    void writeQty(undo.id, undo.from);
    setUndo(null);
  }

  // The Undo offer lapses after a few seconds (and restarts with every new change).
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  // Keyboard control of the list. The handler is rebuilt every render and called through a ref, so it always sees the
  // current state while the listener itself is only attached once.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    const target = document.activeElement;
    const inSearch = target === searchRef.current;
    const modalOpen = Boolean(editingId || capturing || refiningId || investigatingId || toolsOpen || helpOpen);
    const action = actionFor(e, { typing: isTypingTarget(target), modalOpen, inSearch });
    if (!action) return;
    const at = visible.findIndex((i) => i.id === selectedId);
    const selected = at >= 0 ? visible[at] : undefined;
    const go = (dir: 1 | -1) => {
      const next = visible[moveSelection(at, visible.length, dir)];
      if (next) setSelectedId(next.id);
    };
    e.preventDefault(); // also stops the key from being typed into a box that opens as a result
    switch (action) {
      case 'search':
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case 'capture':
        setCapturing(true);
        break;
      case 'add':
        setEditingId('new');
        break;
      case 'next':
        go(1);
        break;
      case 'prev':
        go(-1);
        break;
      case 'open': {
        const part = selected ?? (inSearch ? visible[0] : undefined);
        if (part) setEditingId(part.id);
        break;
      }
      case 'inc':
        if (selected) changeQty(selected, selected.quantity + 1);
        break;
      case 'dec':
        if (selected && selected.quantity > 0) changeQty(selected, selected.quantity - 1);
        break;
      case 'help':
        setHelpOpen(true);
        break;
      case 'clear':
        if (inSearch) {
          setQuery('');
          searchRef.current?.blur();
        } else setSelectedId(null);
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Keep the highlighted row on screen as it moves.
  useEffect(() => {
    if (selectedId) document.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const editing = editingId && editingId !== 'new' ? (items.find((i) => i.id === editingId) ?? null) : null;

  async function save(input: ItemInput) {
    if (editing) await updateItem(editing.id, input);
    else await createItem(input);
    await reload();
  }

  async function apply(p: Proposal[]) {
    const { created } = await applyProposals(p, items);
    await reload(); // parts the model was unsure about now carry an "investigate" flag and show in the notice below
    void attachDatasheets(created.filter(wantsLookup)); // runs in the background
  }

  // Looks up datasheets one at a time (each is a web search) and reports progress.
  async function attachDatasheets(list: Item[]) {
    if (!list.length) return;
    let found = 0;
    try {
      for (const [n, item] of list.entries()) {
        setNote(`Finding datasheets… ${n + 1}/${list.length}`);
        if ((await findDatasheet(item.id)).status === 'found') found++;
      }
      setNote(found ? `Attached ${plural(found, 'datasheet')}.` : 'No datasheets found.');
    } catch (e) {
      setNote('');
      setError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  }

  const refining = refiningId ? (items.find((i) => i.id === refiningId) ?? null) : null;
  const investigating = investigatingId ? (items.find((i) => i.id === investigatingId) ?? null) : null;
  const toInvestigate = items.filter(needsInvestigation);
  const showToolsPrompt = tools !== null && tools.length === 0 && !toolsPromptHidden && !toolsOpen;
  const missing = items.filter(wantsLookup);
  const total = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <main>
      <header className="top">
        <div className="brand">
          <h1>🔧 PartsTracker</h1>
          <p className="counts">
            {plural(items.length, 'part')} · {plural(total, 'unit')}
          </p>
        </div>
        <div className="desktop-actions">
          <button type="button" className="primary" onClick={() => setCapturing(true)}>
            ✨ Capture <kbd>C</kbd>
          </button>
          <button type="button" onClick={() => setEditingId('new')}>
            ＋ Add <kbd>N</kbd>
          </button>
        </div>
        <ExportMenu
          items={visible}
          label={visible.length === items.length ? `All ${plural(items.length, 'item')}` : `${plural(visible.length, 'filtered item')}`}
        />
        <button
          type="button"
          className="icon desktop-only"
          onClick={() => setHelpOpen(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          ⌨
        </button>
        <button type="button" className="icon" onClick={() => setToolsOpen(true)} aria-label="My tools" title="My tools">
          🧰
        </button>
        <button type="button" className="icon" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="filters">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search parts…"
          aria-label="Search parts"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav className="chips" aria-label="Filters">
          <button
            type="button"
            className={!category && !lowOnly ? 'on' : ''}
            onClick={() => {
              setCategory('');
              setLowOnly(false);
            }}
          >
            All
          </button>
          <button type="button" className={lowOnly ? 'on' : ''} onClick={() => setLowOnly(!lowOnly)}>
            Low stock
          </button>
          {categories.map((c) => (
            <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(category === c ? '' : c)}>
              {c}
            </button>
          ))}
        </nav>
      </div>

      {error && <p className="msg">{error}</p>}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {showToolsPrompt && (
        <div className="notice">
          <span>🧰 Tell me what test equipment you have, so test plans fit your tools.</span>
          <button type="button" onClick={() => setToolsOpen(true)}>
            Set up
          </button>
          <button
            type="button"
            className="icon"
            aria-label="Not now"
            onClick={() => {
              hidePrompt();
              setToolsPromptHidden(true);
            }}
          >
            ✕
          </button>
        </div>
      )}
      {toInvestigate.length > 0 && (
        <div className="notice">
          <span>🔎 {plural(toInvestigate.length, 'part')} to investigate</span>
          <button type="button" onClick={() => setInvestigatingId(toInvestigate[0].id)}>
            Open
          </button>
        </div>
      )}
      {missing.length > 0 && !note.startsWith('Finding') && (
        <div className="notice">
          <span>📄 {plural(missing.length, 'part')} without a datasheet</span>
          <button type="button" onClick={() => attachDatasheets(missing.slice(0, 10))}>
            Find
          </button>
        </div>
      )}

      {loading ? (
        <p className="hint">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="hint">{items.length ? 'No matches.' : 'No parts yet — tap ✨ Capture to add your first.'}</p>
      ) : (
        <>
          <div className="list-head" aria-hidden="true">
            <div className="cols">
              <span>Part</span>
              <span>Part number</span>
              <span>Value · package</span>
              <span>Location</span>
            </div>
            <span>Quantity</span>
          </div>
          <ul className="list">
            {visible.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                selected={i.id === selectedId}
                onSelect={() => setSelectedId(i.id)}
                onQty={changeQty}
                onEdit={(it) => setEditingId(it.id)}
              />
            ))}
          </ul>
        </>
      )}

      {undo && (
        <div className="toast" role="status">
          <span>
            {undo.name}: {undo.from} → {undo.to}
          </span>
          <button type="button" onClick={undoLast}>
            Undo
          </button>
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // lets the same photo be picked again
          if (file) {
            setCameraPhoto(file);
            setCapturing(true);
          }
        }}
      />
      <div className="dock">
        <button type="button" className="big icon-wide" aria-label="Take a photo" onClick={() => cameraRef.current?.click()}>
          📷
        </button>
        <button type="button" className="primary big" onClick={() => setCapturing(true)}>
          ✨ Capture
        </button>
        <button type="button" className="big" onClick={() => setEditingId('new')}>
          ＋ Add
        </button>
      </div>

      {editingId && (editingId === 'new' || editing) && (
        <ItemForm
          key={`${editingId}:${formVersion}`}
          item={editing ?? undefined}
          onSave={save}
          onChanged={reload}
          onRefine={editing ? () => setRefiningId(editing.id) : undefined}
          onInvestigate={editing ? () => setInvestigatingId(editing.id) : undefined}
          onDelete={
            editing
              ? async () => {
                  await deleteItem(editing.id);
                  await reload();
                }
              : undefined
          }
          onClose={() => setEditingId(null)}
        />
      )}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {toolsOpen && tools && <ToolsDialog tools={tools} onChanged={reloadTools} onClose={() => setToolsOpen(false)} />}
      {investigating && (
        <Investigate
          item={investigating}
          hasTools={(tools?.length ?? 0) > 0}
          onOpenTools={() => setToolsOpen(true)}
          onChanged={reload}
          onRecord={(results) => {
            // Test results go through the same review as any other update to the part.
            setRefineText(results);
            setRefiningId(investigating.id);
            setInvestigatingId(null);
            void reload(); // pick up the steps ticked so far, so reopening shows them
          }}
          onClose={() => {
            setInvestigatingId(null);
            void reload();
          }}
        />
      )}
      {refining && (
        <Refine
          item={refining}
          initialText={refineText}
          onClose={() => {
            setRefiningId(null);
            setRefineText('');
          }}
          onApplied={async (patch) => {
            await reload();
            setFormVersion((v) => v + 1);
            // A part number that was just added makes a datasheet lookup worthwhile.
            const next = { ...refining, ...patch } as Item;
            if (patch.part_number && wantsLookup(next)) void attachDatasheets([next]);
          }}
        />
      )}
      {capturing && (
        <Capture
          items={items}
          initialPhoto={cameraPhoto}
          onApply={apply}
          onClose={() => {
            setCapturing(false);
            setCameraPhoto(null);
          }}
        />
      )}
    </main>
  );
}
