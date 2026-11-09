import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Capture from './components/Capture';
import ExportMenu from './components/ExportMenu';
import ItemForm from './components/ItemForm';
import ItemRow from './components/ItemRow';
import Login from './components/Login';
import { findDatasheet, wantsLookup } from './lib/datasheets';
import { applyProposals, createItem, deleteItem, listItems, updateItem } from './lib/items';
import { searchItems } from './lib/search';
import { configured, supabase } from './lib/supabase';
import type { Item, ItemInput, Proposal } from './lib/types';

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

  // Optimistic quantity change; roll back by reloading if the write fails.
  async function setQty(item: Item, qty: number) {
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, quantity: qty } : i)));
    try {
      await updateItem(item.id, { quantity: qty });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    }
  }

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
      setNote(found ? `Attached ${found} datasheet${found > 1 ? 's' : ''}.` : 'No datasheets found.');
    } catch (e) {
      setNote('');
      setError(e instanceof Error ? e.message : String(e));
    }
    await reload();
  }

  const missing = items.filter(wantsLookup);
  const total = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <main>
      <header>
        <h1>🔧 PartsTracker</h1>
        <small>
          {items.length} parts · {total} units
        </small>
        <span className="grow" />
        <ExportMenu
          items={visible}
          label={visible.length === items.length ? `All ${items.length} items` : `${visible.length} filtered items`}
        />
        <button type="button" onClick={() => supabase.auth.signOut()} title="Sign out">
          ⏻
        </button>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name, value, package, part #, location…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="primary" onClick={() => setCapturing(true)}>
          ✨ Capture
        </button>
        <button type="button" onClick={() => setEditingId('new')}>
          ＋ Add
        </button>
      </div>

      <div className="chips">
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
        {missing.length > 0 && (
          <button
            type="button"
            onClick={() => attachDatasheets(missing.slice(0, 10))}
            disabled={Boolean(note) && note.startsWith('Finding')}
          >
            📄 Find datasheets ({missing.length})
          </button>
        )}
        {categories.map((c) => (
          <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(category === c ? '' : c)}>
            {c}
          </button>
        ))}
      </div>

      {error && <p className="msg">{error}</p>}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {loading ? (
        <p className="hint">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="hint">{items.length ? 'No matches.' : 'No parts yet — tap ✨ Capture to add your first.'}</p>
      ) : (
        <ul className="list">
          {visible.map((i) => (
            <ItemRow key={i.id} item={i} onQty={setQty} onEdit={(i) => setEditingId(i.id)} />
          ))}
        </ul>
      )}

      {editingId && (editingId === 'new' || editing) && (
        <ItemForm
          item={editing ?? undefined}
          onSave={save}
          onChanged={reload}
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
      {capturing && <Capture items={items} onApply={apply} onClose={() => setCapturing(false)} />}
    </main>
  );
}
