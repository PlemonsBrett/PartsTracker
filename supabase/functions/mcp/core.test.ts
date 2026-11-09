import { beforeEach, describe, expect, it } from 'vitest';
import { handleMessage, type Item, type Store, TOOLS } from './core.ts';

let rows: Item[];
const mk = (o: Partial<Item>): Item => ({
  id: crypto.randomUUID(),
  name: 'x',
  quantity: 0,
  min_quantity: 0,
  category: null,
  value: null,
  package: null,
  part_number: null,
  manufacturer: null,
  location: null,
  description: null,
  datasheet_url: null,
  notes: null,
  updated_at: '',
  ...o,
});
const store: Store = {
  list: async () => rows,
  get: async (id) => rows.find((r) => r.id === id) ?? null,
  insert: async (f) => {
    const r = mk(f);
    rows.push(r);
    return r;
  },
  update: async (id, p) => {
    const r = rows.find((x) => x.id === id)!;
    Object.assign(r, p);
    return r;
  },
  remove: async (id) => {
    rows = rows.filter((r) => r.id !== id);
  },
  signedDatasheetUrl: async (path) => `https://signed.example/${path}?token=t`,
};
const call = async (name: string, args: object = {}) => {
  const res = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, store)) as any;
  return { err: !!res.result?.isError, text: res.result?.content?.[0]?.text as string, res };
};

beforeEach(() => {
  rows = [
    mk({ id: 'r1', name: '10k resistor', value: '10kΩ', package: '0805', quantity: 100, min_quantity: 20, category: 'Resistor' }),
    mk({ id: 'm1', name: 'ATmega328P', quantity: 3, category: 'IC' }),
  ];
});

describe('protocol', () => {
  it('initialize echoes a supported version and advertises tools', async () => {
    const r = (await handleMessage({ id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, store)) as any;
    expect(r.result.protocolVersion).toBe('2025-03-26');
    expect(r.result.capabilities.tools).toBeDefined();
  });
  it('falls back to the newest version for unknown ones', async () => {
    const r = (await handleMessage({ id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, store)) as any;
    expect(r.result.protocolVersion).toBe('2025-06-18');
  });
  it('notifications get no response', async () => expect(await handleMessage({ method: 'notifications/initialized' }, store)).toBeNull());
  it('tools/list exposes every tool without functions', async () => {
    const r = (await handleMessage({ id: 1, method: 'tools/list' }, store)) as any;
    expect(r.result.tools).toHaveLength(TOOLS.length);
    expect(r.result.tools.every((t: any) => t.inputSchema && !t.run)).toBe(true);
  });
  it('unknown method / tool are JSON-RPC errors', async () => {
    expect(((await handleMessage({ id: 1, method: 'nope' }, store)) as any).error.code).toBe(-32601);
    expect((await call('nope')).res.error.code).toBe(-32602);
  });
});

describe('tools', () => {
  it('search matches 10k against 10kΩ and applies limits', async () => {
    const { text } = await call('search_items', { query: '10k 0805' });
    expect(JSON.parse(text).items.map((i: any) => i.id)).toEqual(['r1']);
  });
  it('low stock', async () => {
    expect(JSON.parse((await call('search_items', { low_stock_only: true })).text).total_matches).toBe(0);
    rows[0].quantity = 5;
    expect(JSON.parse((await call('list_low_stock')).text).items[0].id).toBe('r1');
  });
  it('adjust_quantity adds, removes and refuses to go negative', async () => {
    expect(JSON.parse((await call('adjust_quantity', { id: 'm1', delta: 2 })).text).quantity).toBe(5);
    const bad = await call('adjust_quantity', { id: 'm1', delta: -9 });
    expect(bad.err).toBe(true);
    expect(rows.find((r) => r.id === 'm1')!.quantity).toBe(5);
  });
  it('set_quantity validates', async () => {
    expect((await call('set_quantity', { id: 'm1', quantity: -1 })).err).toBe(true);
    expect((await call('set_quantity', { id: 'm1', quantity: 12 })).err).toBe(false);
    expect(rows[1].quantity).toBe(12);
  });
  it('add_item creates and ignores unknown fields', async () => {
    const r = await call('add_item', { name: ' LM358 ', quantity: 4, package: 'DIP-8', bogus: 1 });
    expect(r.err).toBe(false);
    const row = rows.at(-1)!;
    expect(row).toMatchObject({ name: 'LM358', quantity: 4, package: 'DIP-8' });
    expect('bogus' in row).toBe(false);
  });
  it('update_item cannot change quantity', async () => {
    await call('update_item', { id: 'm1', location: 'B2', quantity: 999 });
    expect(rows[1]).toMatchObject({ location: 'B2', quantity: 3 });
  });
  it('unknown ids are in-band errors', async () => expect((await call('get_item', { id: 'zzz' })).err).toBe(true));
  it('delete needs confirm', async () => {
    expect((await call('delete_item', { id: 'm1', confirm: false })).err).toBe(true);
    expect(rows).toHaveLength(2);
    await call('delete_item', { id: 'm1', confirm: true });
    expect(rows).toHaveLength(1);
  });
  it('get_datasheet returns parsed facts, a signed PDF link, or a clear "none"', async () => {
    const facts = {
      summary: 'Dual op amp',
      specs: [{ name: 'Supply', value: '3-32 V' }],
      features: [],
      pinout: null,
      source_url: 'https://ti.com/a.pdf',
      extracted_at: '',
    };
    rows[1].fact_sheet = facts;
    const withFacts = JSON.parse((await call('get_datasheet', { id: 'm1' })).text);
    expect(withFacts.fact_sheet.specs[0].value).toBe('3-32 V');
    expect(withFacts.pdf_url).toBeNull();

    rows[1].fact_sheet = null;
    rows[1].datasheet_path = 'user/m1.pdf';
    expect(JSON.parse((await call('get_datasheet', { id: 'm1' })).text).pdf_url).toContain('user/m1.pdf');

    rows[1].datasheet_path = null;
    expect(JSON.parse((await call('get_datasheet', { id: 'm1' })).text).note).toMatch(/No datasheet/);
    expect((await call('get_datasheet', { id: 'zzz' })).err).toBe(true);
  });
  it('search results flag which parts have a fact sheet', async () => {
    rows[1].fact_sheet = { summary: 's', specs: [], features: [], pinout: null, source_url: 'https://a.com', extracted_at: '' };
    const items = JSON.parse((await call('search_items', { query: 'atmega' })).text).items;
    expect(items[0].has_fact_sheet).toBe(true);
  });
  it('export md is a table', async () =>
    expect((await call('export_inventory')).text).toContain('| 10k resistor | 100 | Resistor | 10kΩ | 0805 |'));
});
