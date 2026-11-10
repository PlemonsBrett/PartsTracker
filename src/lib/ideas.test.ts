import { describe, expect, it } from 'vitest';
import { ideaNotes, rankIdeas, scoreIdea } from './ideas';
import type { Idea, IdeaPart } from './types';

const part = (o: Partial<IdeaPart> = {}): IdeaPart => ({ item_id: 'a', name: 'x', quantity: 1, optional: false, role: '', ...o });
const idea = (parts: IdeaPart[], o: Partial<Idea> = {}): Idea => ({
  title: 'T',
  summary: 'S',
  difficulty: 'beginner',
  hours: 1,
  parts,
  printed: [],
  tools_needed: [],
  steps: [],
  ...o,
});
const stock = [
  { id: 'a', quantity: 10 },
  { id: 'b', quantity: 1 },
];

describe('scoreIdea', () => {
  it('counts a part as in stock only when the stock covers the quantity', () => {
    const s = scoreIdea(
      idea([part({ item_id: 'a', quantity: 2 }), part({ item_id: 'b', quantity: 3 }), part({ item_id: null, name: 'buy me' })]),
      stock,
    );
    expect(s.parts.map((p) => p.status)).toEqual(['have', 'short', 'buy']);
    expect([s.haveCount, s.shortCount, s.buyCount, s.required]).toEqual([1, 1, 1, 3]);
    expect(s.percent).toBe(33);
  });
  it('is 100% when everything is in stock', () => {
    expect(scoreIdea(idea([part(), part({ item_id: 'b' })]), stock).percent).toBe(100);
  });
  it('does not count optional parts, in either direction', () => {
    const s = scoreIdea(idea([part(), part({ item_id: null, name: 'extra', optional: true })]), stock);
    expect(s.percent).toBe(100);
    expect(s.required).toBe(1);
    expect(s.parts[1].status).toBe('buy');
  });
  it('does not count printed parts as parts to buy', () => {
    const s = scoreIdea(idea([part()], { printed: [{ name: 'Case', printer: 'P', material: 'PLA', notes: '' }] }), stock);
    expect(s.percent).toBe(100);
    expect(s.printCount).toBe(1);
  });
  it('follows the live inventory: a deleted or emptied item becomes a part to buy', () => {
    expect(scoreIdea(idea([part({ item_id: 'gone' })]), stock).parts[0].status).toBe('buy');
    expect(scoreIdea(idea([part()]), [{ id: 'a', quantity: 0 }]).percent).toBe(0);
  });
  it('rounds to a whole percent, and an idea with no required parts scores 0', () => {
    expect(scoreIdea(idea([part(), part({ item_id: 'b' }), part({ item_id: null })]), stock).percent).toBe(67);
    expect(scoreIdea(idea([]), stock).percent).toBe(0);
  });
});

describe('rankIdeas', () => {
  const row = (id: string, title: string, parts: IdeaPart[]) => ({ id, idea: idea(parts, { title }) });
  it('puts the highest share in stock first, then the least to buy (at equal share), then the bigger project', () => {
    const rows = [
      row('low', 'Low', [part({ item_id: null }), part({ item_id: null }), part()]),
      row('full', 'Full', [part()]),
      row('half-big', 'Half big', [part(), part({ item_id: null }), part({ item_id: 'b' }), part({ item_id: null })]),
      row('half', 'Half', [part(), part({ item_id: null })]),
    ];
    expect(rankIdeas(rows, stock).map((r) => r.id)).toEqual(['full', 'half', 'half-big', 'low']);
  });
  it('re-ranks when the inventory changes', () => {
    const rows = [row('x', 'X', [part({ item_id: 'b', quantity: 5 })]), row('y', 'Y', [part({ item_id: 'a' })])];
    expect(rankIdeas(rows, stock)[0].id).toBe('y');
    expect(
      rankIdeas(rows, [
        { id: 'a', quantity: 0 },
        { id: 'b', quantity: 9 },
      ])[0].id,
    ).toBe('x');
  });
});

describe('ideaNotes', () => {
  it('writes the summary, printing, tools and steps', () => {
    const n = ideaNotes(
      idea([part()], {
        summary: 'A lamp.',
        printed: [{ name: 'Shade', printer: 'Halot', material: 'resin', notes: 'tough resin' }],
        tools_needed: ['soldering iron'],
        steps: ['Wire it', 'Test it'],
      }),
    );
    expect(n).toContain('A lamp.');
    expect(n).toContain('- Shade on the Halot (resin): tough resin');
    expect(n).toContain('Tools: soldering iron.');
    expect(n).toContain('2. Test it');
  });
  it('is just the summary for a bare idea', () => {
    expect(ideaNotes(idea([part()], { summary: 'Only this.' }))).toBe('Only this.');
  });
});
