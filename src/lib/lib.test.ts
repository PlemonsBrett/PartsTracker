import { describe, expect, it } from 'vitest';
import { toCSV, toMarkdown } from './export';
import { plural } from './format';
import { nextQuantity } from './items';
import { searchItems } from './search';
import { swipeAction } from './swipe';
import type { Item } from './types';
import { nextUndo } from './undo';

const mk = (o: Partial<Item>): Item => ({
  id: crypto.randomUUID(),
  name: 'x',
  category: null,
  quantity: 1,
  min_quantity: 0,
  location: null,
  part_number: null,
  manufacturer: null,
  value: null,
  package: null,
  description: null,
  datasheet_url: null,
  notes: null,
  updated_at: '',
  fact_sheet: null,
  datasheet_path: null,
  datasheet_status: null,
  datasheet_checked_at: null,
  ...o,
});
const items = [
  mk({ name: 'Resistor', category: 'Resistor', value: '10kΩ', package: '0805', location: 'A3' }),
  mk({ name: 'ATmega328P', category: 'IC', package: 'DIP-28' }),
];

describe('search', () => {
  it('matches values ignoring ohm symbol and case', () => expect(searchItems(items, '10K 0805')).toHaveLength(1));
  it('requires every term', () => expect(searchItems(items, 'atmega 0805')).toHaveLength(0));
  it('empty query returns all', () => expect(searchItems(items, '  ')).toHaveLength(2));
});

describe('nextQuantity', () => {
  it('adds, removes (floored at 0) and sets', () => {
    expect(nextQuantity(5, { op: 'add', quantity: 3 })).toBe(8);
    expect(nextQuantity(2, { op: 'remove', quantity: 5 })).toBe(0);
    expect(nextQuantity(2, { op: 'set', quantity: 40 })).toBe(40);
  });
});

describe('export', () => {
  it('escapes CSV', () => expect(toCSV([mk({ name: 'a,"b"' })]).split('\n')[1]).toMatch(/^"a,""b""",/));
  it('renders a markdown table', () => expect(toMarkdown(items)).toContain('| Resistor | 1 | Resistor | 10kΩ | 0805 |'));
});

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'part')).toBe('1 part');
    expect(plural(1, 'unit')).toBe('1 unit');
    expect(plural(0, 'part')).toBe('0 parts');
    expect(plural(2, 'unit')).toBe('2 units');
  });
  it('supports irregular plurals', () => expect(plural(2, 'box', 'boxes')).toBe('2 boxes'));
});

describe('nextUndo', () => {
  const item = { id: 'a', name: '10k resistor', quantity: 10 };
  it('remembers the value before the change', () => {
    expect(nextUndo(null, item, 11)).toEqual({ id: 'a', name: '10k resistor', from: 10, to: 11 });
  });
  it('collapses rapid changes to the same item so Undo goes back to the start', () => {
    const first = nextUndo(null, item, 11);
    const second = nextUndo(first, { ...item, quantity: 11 }, 12);
    expect(second).toMatchObject({ from: 10, to: 12 });
  });
  it('starts fresh when a different item changes', () => {
    const first = nextUndo(null, item, 11);
    expect(nextUndo(first, { id: 'b', name: 'LED', quantity: 5 }, 4)).toMatchObject({ id: 'b', from: 5, to: 4 });
  });
  it('offers nothing when the change nets out to zero', () => {
    const first = nextUndo(null, item, 11);
    expect(nextUndo(first, { ...item, quantity: 11 }, 10)).toBeNull();
  });
});

describe('swipeAction', () => {
  it('right is +1 and left is -1 once far enough', () => {
    expect(swipeAction(90, 5)).toBe('inc');
    expect(swipeAction(-90, -5)).toBe('dec');
  });
  it('ignores short drags', () => expect(swipeAction(40, 0)).toBeNull());
  it('ignores mostly vertical movement (scrolling)', () => {
    expect(swipeAction(80, 70)).toBeNull();
    expect(swipeAction(-80, 120)).toBeNull();
  });
});
