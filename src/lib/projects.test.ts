import { describe, expect, it } from 'vitest';
import { cleanName, partState, pickable, shoppingList, summarize, takePlan } from './projects';
import type { Item, ProjectPart } from './types';

const part = (o: Partial<ProjectPart> = {}): ProjectPart => ({
  id: 'p',
  project_id: 'j',
  item_id: 'a',
  name: '10k resistor',
  quantity: 2,
  role: null,
  used_at: null,
  taken: null,
  ...o,
});
const stock = [
  { id: 'a', quantity: 5 },
  { id: 'b', quantity: 1 },
  { id: 'z', quantity: 0 },
];

describe('partState', () => {
  it('is ok when there is enough', () => expect(partState(part(), stock)).toEqual({ kind: 'ok', have: 5 }));
  it('says how many are missing when short', () =>
    expect(partState(part({ item_id: 'b' }), stock)).toEqual({ kind: 'short', have: 1, missing: 1 }));
  it('treats no inventory item as a part to get', () => {
    expect(partState(part({ item_id: null }), stock)).toEqual({ kind: 'to-get' });
    expect(partState(part({ item_id: 'gone' }), stock)).toEqual({ kind: 'to-get' });
  });
  it('shows a part already taken as used, whatever the stock now is', () => {
    expect(partState(part({ used_at: 'x', taken: 2 }), stock)).toEqual({ kind: 'used', taken: 2 });
  });
});

describe('summarize', () => {
  it('splits parts to get, short parts and ready ones', () => {
    const s = summarize([part(), part({ id: 'q', item_id: 'b', quantity: 3 }), part({ id: 'r', item_id: null, name: 'Battery' })], stock);
    expect(s.toGet.map((p) => p.name)).toEqual(['Battery']);
    expect(s.short).toHaveLength(1);
    expect(s.short[0]).toMatchObject({ have: 1, missing: 2 });
    expect(s.available).toBe(2);
    expect(s.ready).toBe(false);
  });
  it('is ready when everything is in stock, and for an empty project', () => {
    expect(summarize([part()], stock).ready).toBe(true);
    expect(summarize([], stock).ready).toBe(true);
  });
  it('does not count used parts as missing', () => {
    const s = summarize([part({ item_id: 'z', used_at: 'x', taken: 2 })], stock);
    expect(s).toMatchObject({ used: 1, ready: true, available: 0 });
  });
});

describe('takePlan', () => {
  it('takes what is needed, capped at what is on hand', () => {
    const plan = takePlan([part(), part({ id: 'q', item_id: 'b', quantity: 3 }), part({ id: 'r', item_id: 'z', quantity: 1 })], stock);
    expect(plan.map((x) => [x.take, x.missing])).toEqual([
      [2, 0],
      [1, 2],
      [0, 1],
    ]);
  });
  it('skips parts already used and parts not in the inventory', () => {
    expect(takePlan([part({ used_at: 'x' }), part({ item_id: null })], stock)).toEqual([]);
  });
});

describe('shoppingList', () => {
  it('lists parts to get and the shortfall of short ones', () => {
    const s = summarize(
      [part({ item_id: null, name: 'Battery', quantity: 1 }), part({ id: 'q', item_id: 'b', quantity: 3, name: 'LED' })],
      stock,
    );
    expect(shoppingList(s)).toBe('1 × Battery\n2 × LED (have 1)');
  });
});

describe('cleanName', () => {
  it('trims, caps and rejects blanks', () => {
    expect(cleanName('  Blinker ')).toBe('Blinker');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(300))).toHaveLength(120);
  });
});

describe('pickable', () => {
  const item = (id: string, name: string, extra: Partial<Item> = {}) =>
    ({ id, name, value: null, part_number: null, category: null, package: null, ...extra }) as Item;
  const items = [item('1', 'LM386 amplifier'), item('2', '10k resistor', { value: '10kΩ' }), item('3', 'Red LED')];
  it('matches every word anywhere in the part and skips parts already in the project', () => {
    expect(pickable(items, [], 'resistor 10k').map((i) => i.id)).toEqual(['2']);
    expect(pickable(items, [part({ item_id: '2' })], 'resistor')).toEqual([]);
  });
  it('returns nothing for an empty search', () => expect(pickable(items, [], '  ')).toEqual([]));
});
