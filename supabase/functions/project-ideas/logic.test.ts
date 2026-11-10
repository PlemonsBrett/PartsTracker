import { describe, expect, it } from 'vitest';
import { buildPrompt, MAX_IDEAS, type StockItem, sanitizeIdeas } from './logic.ts';

const stock = [
  { id: 'a', name: '330Ω resistor' },
  { id: 'b', name: 'Red LED' },
];
const printers = ['Creality Halot Mage 8K', 'FlashForge Adventurer 5'];
const idea = (o: Record<string, unknown> = {}) => ({
  title: 'LED night light',
  summary: 'A dim light.',
  difficulty: 'beginner',
  hours: 1.2,
  parts: [
    { item_id: 'a', name: 'resistor', quantity: 1, role: 'limits current' },
    { item_id: 'b', name: 'led', quantity: 1, role: 'the light' },
    { item_id: null, name: 'CR2032 holder', quantity: 1, role: 'power' },
  ],
  printed: [{ name: 'Case', printer: 'flashforge adventurer 5', material: 'PLA', notes: 'two halves' }],
  tools_needed: ['soldering iron'],
  steps: ['Solder it.'],
  ...o,
});
const run = (ideas: unknown[], existing: string[] = []) => sanitizeIdeas({ ideas }, stock, printers, existing);

describe('sanitizeIdeas', () => {
  it('keeps a good idea and names inventory parts from the inventory', () => {
    const [i] = run([idea()]);
    expect(i.parts.map((p) => p.name)).toEqual(['330Ω resistor', 'Red LED', 'CR2032 holder']);
    expect(i.parts[2].item_id).toBeNull();
    expect(i.hours).toBe(1);
    expect(i.difficulty).toBe('beginner');
  });
  it('treats an id that is not in the inventory as a part to buy, keeping the name given', () => {
    const [i] = run([
      idea({
        parts: [
          { item_id: 'zzz', name: 'BC547 transistor', quantity: 2 },
          { item_id: 'a', name: 'x', quantity: 1 },
        ],
      }),
    ]);
    expect(i.parts[0]).toMatchObject({ item_id: null, name: 'BC547 transistor', quantity: 2 });
  });
  it('lists an inventory part only once', () => {
    const [i] = run([
      idea({
        parts: [
          { item_id: 'a', name: 'r', quantity: 1 },
          { item_id: 'a', name: 'r', quantity: 4 },
        ],
      }),
    ]);
    expect(i.parts).toHaveLength(1);
  });
  it('clamps quantities and falls back to 1', () => {
    const [i] = run([
      idea({
        parts: [
          { item_id: 'a', name: 'r', quantity: 99999 },
          { item_id: null, name: 'x', quantity: 'many' },
          { item_id: null, name: 'y', quantity: -3 },
        ],
      }),
    ]);
    expect(i.parts.map((p) => p.quantity)).toEqual([1000, 1, 1]);
  });
  it('drops an idea with no title, or with only optional parts', () => {
    expect(run([idea({ title: '  ' }), idea({ title: 'Opt', parts: [{ item_id: 'a', name: 'r', quantity: 1, optional: true }] })])).toEqual(
      [],
    );
  });
  it('drops printed parts that are not on a printer the owner has, and fixes the printer name casing', () => {
    const [i] = run([
      idea({
        printed: [
          { name: 'Case', printer: 'flashforge adventurer 5' },
          { name: 'Gear', printer: 'Prusa MK4' },
        ],
      }),
    ]);
    expect(i.printed).toEqual([{ name: 'Case', printer: 'FlashForge Adventurer 5', material: '', notes: '' }]);
  });
  it('drops all printed parts when the owner has no printer', () => {
    expect(sanitizeIdeas({ ideas: [idea()] }, stock, [])[0].printed).toEqual([]);
  });
  it('does not repeat a title it was told to avoid, or one it already made', () => {
    expect(run([idea()], ['led night light'])).toEqual([]);
    expect(run([idea(), idea()])).toHaveLength(1);
  });
  it('caps the number of ideas, and clips long text', () => {
    const many = Array.from({ length: 20 }, (_, n) => idea({ title: `Idea ${n}`, summary: 's'.repeat(2000) }));
    const out = run(many);
    expect(out).toHaveLength(MAX_IDEAS);
    expect(out[0].summary).toHaveLength(400);
  });
  it('falls back to a safe difficulty and no build time', () => {
    const [i] = run([idea({ difficulty: 'impossible', hours: 'soon' })]);
    expect(i.difficulty).toBe('intermediate');
    expect(i.hours).toBeNull();
  });
  it('copes with junk', () => {
    expect(sanitizeIdeas(null, stock, printers)).toEqual([]);
    expect(sanitizeIdeas({ ideas: 'x' }, stock, printers)).toEqual([]);
    expect(run([null, 5, 'x'])).toEqual([]);
  });
});

describe('buildPrompt', () => {
  const s: StockItem[] = [
    { id: 'a', name: '330Ω resistor', category: 'Resistor', value: '330Ω', package: null, part_number: null, quantity: 20 },
  ];
  it('lists stock with ids and quantities, the printers, and what to avoid', () => {
    const p = buildPrompt(
      s,
      [
        { kind: '3d_printer', name: 'FlashForge Adventurer 5', notes: 'FDM printer' },
        { kind: 'multimeter', name: 'DMT-99', notes: null },
      ],
      6,
      'a desk gadget',
      ['Night light'],
    );
    expect(p).toContain('a | 330Ω resistor | 330Ω | x20');
    expect(p).toContain('FlashForge Adventurer 5 (FDM printer)');
    expect(p).toContain('DMT-99');
    expect(p).toContain('a desk gadget');
    expect(p).toContain('Night light');
    expect(p).toContain('with 6 different');
  });
  it('tells the model not to print when there is no printer', () => {
    expect(buildPrompt(s, [], 4, '', [])).toContain('do not suggest printed parts');
  });
});
