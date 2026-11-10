import { type PointerEvent, useRef, useState } from 'react';
import { needsInvestigation } from '../lib/investigate';
import { SWIPE_MAX_TRAVEL, SWIPE_THRESHOLD, swipeAction } from '../lib/swipe';
import type { Item } from '../lib/types';

interface Props {
  item: Item;
  onQty: (item: Item, qty: number) => void;
  onEdit: (item: Item) => void;
}

export default function ItemRow({ item, onQty, onEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const low = item.quantity <= item.min_quantity && item.min_quantity > 0;
  const meta = [item.value, item.package, item.part_number, item.location && `📍 ${item.location}`].filter(Boolean).join(' · ');

  // Swipe right = +1, left = -1. Touch/pen only; the +/- buttons remain for everyone else.
  function onDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
  }
  function onMove(e: PointerEvent) {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;
    if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
      setDx(Math.max(-SWIPE_MAX_TRAVEL, Math.min(SWIPE_MAX_TRAVEL, mx)));
    }
  }
  function onUp(e: PointerEvent) {
    const s0 = start.current;
    start.current = null;
    setDx(0);
    if (!s0) return;
    const action = swipeAction(e.clientX - s0.x, e.clientY - s0.y);
    if (!action) return;
    swiped.current = true;
    if (action === 'dec' && item.quantity === 0) return;
    navigator.vibrate?.(10);
    onQty(item, item.quantity + (action === 'inc' ? 1 : -1));
  }
  function onCancel() {
    start.current = null;
    setDx(0);
  }

  // A swipe that ends on the name shouldn't also count as a tap.
  function openEditor() {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    onEdit(item);
  }

  const armed = Math.abs(dx) >= SWIPE_THRESHOLD ? (dx > 0 ? 'will-inc' : 'will-dec') : '';
  const rowClass = ['row', item.quantity === 0 && 'empty', dx !== 0 && 'dragging', armed].filter(Boolean).join(' ');

  function commit() {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 0 && n !== item.quantity) onQty(item, n);
  }

  return (
    <li
      className={rowClass}
      data-swipe={dx === 0 ? undefined : dx > 0 ? 'right' : 'left'}
      style={dx ? ({ transform: `translateX(${dx}px)`, '--gap': `${Math.abs(dx)}px` } as React.CSSProperties) : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      <button type="button" className="info" onClick={openEditor} aria-label={`Edit ${item.name}`}>
        <strong>{item.name}</strong>
        {(item.category || low || item.fact_sheet || item.datasheet_path || needsInvestigation(item)) && (
          <span className="tags">
            {item.category && <span className="tag">{item.category}</span>}
            {low && <span className="tag warn">low</span>}
            {needsInvestigation(item) && <span className="tag warn">🔎 investigate</span>}
            {(item.fact_sheet || item.datasheet_path) && <span className="tag">datasheet</span>}
          </span>
        )}
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
