export interface Undo {
  id: string;
  name: string;
  from: number;
  to: number;
}

/**
 * The state to offer for "Undo" after changing an item's quantity.
 * Rapid taps on the same item collapse into one entry, so Undo returns to the value before the burst.
 * Returns null when the change nets out to nothing.
 */
export function nextUndo(prev: Undo | null, item: { id: string; name: string; quantity: number }, to: number): Undo | null {
  const from = prev && prev.id === item.id ? prev.from : item.quantity;
  return from === to ? null : { id: item.id, name: item.name, from, to };
}
