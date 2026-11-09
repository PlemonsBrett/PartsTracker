import { useState } from 'react';
import type { Item } from '../lib/types';

interface Props {
  item: Item;
  onQty: (item: Item, qty: number) => void;
  onEdit: (item: Item) => void;
}

export default function ItemRow({ item, onQty, onEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const low = item.quantity <= item.min_quantity && item.min_quantity > 0;
  const meta = [item.value, item.package, item.part_number, item.location && `📍 ${item.location}`].filter(Boolean).join(' · ');

  function commit() {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 0 && n !== item.quantity) onQty(item, n);
  }

  return (
    <li className={`row${item.quantity === 0 ? ' empty' : ''}`}>
      <button type="button" className="info" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`}>
        <strong>{item.name}</strong>
        {item.category && <span className="tag">{item.category}</span>}
        {low && <span className="tag warn">low</span>}
        {meta && <small>{meta}</small>}
      </button>
      <div className="qty">
        <button
          type="button"
          onClick={() => onQty(item, Math.max(0, item.quantity - 1))}
          aria-label="Decrease"
          disabled={item.quantity === 0}
        >
          −
        </button>
        {editing ? (
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        ) : (
          <button
            type="button"
            className="num"
            onClick={() => {
              setDraft(String(item.quantity));
              setEditing(true);
            }}
            aria-label="Set quantity"
          >
            {item.quantity}
          </button>
        )}
        <button type="button" onClick={() => onQty(item, item.quantity + 1)} aria-label="Increase">
          +
        </button>
      </div>
    </li>
  );
}
