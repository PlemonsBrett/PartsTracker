import { describe, expect, it } from 'vitest';
import { toCSV, toMarkdown } from './export';
import { plural } from './format';
import { nextQuantity } from './items';
import { searchItems } from './search';
import type { Item } from './types';

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
