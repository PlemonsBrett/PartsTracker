import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Capture from './components/Capture';
import ExportMenu from './components/ExportMenu';
import ItemForm from './components/ItemForm';
import ItemRow from './components/ItemRow';
import Login from './components/Login';
import Refine from './components/Refine';
import { findDatasheet, wantsLookup } from './lib/datasheets';
import { plural } from './lib/format';
import { applyProposals, createItem, deleteItem, listItems, updateItem } from './lib/items';
import { searchItems } from './lib/search';
import { configured, supabase } from './lib/supabase';
import type { Item, ItemInput, Proposal } from './lib/types';
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

function Inventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [note, setNote] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [refiningId, setRefiningId] = useState<string | null>(null);
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

  const editing = editingId && editingId !== 'new' ? (items.find((i) => i.id === editingId) ?? null) : null;

  async function save(input: ItemInput) {
    if (editing) await updateItem(editing.id, input);
    else await createItem(input);
    await reload();
  }

  async function apply(p: Proposal[]) {
    const created = await applyProposals(p, items);
    await reload();
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
        <ExportMenu
          items={visible}
          label={visible.length === items.length ? `All ${plural(items.length, 'item')}` : `${plural(visible.length, 'filtered item')}`}
        />
        <button type="button" className="icon" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="filters">
        <input
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
        <ul className="list">
          {visible.map((i) => (
            <ItemRow key={i.id} item={i} onQty={changeQty} onEdit={(it) => setEditingId(it.id)} />
          ))}
        </ul>
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
      {refining && (
        <Refine
          item={refining}
          onClose={() => setRefiningId(null)}
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
