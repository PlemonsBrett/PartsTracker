import { describe, expect, it } from 'vitest';
import { buildPrompt, NO_TOOL, SUPPLY_SAFETY, sanitizePlan } from './logic.ts';

const owned = [
  { name: 'FNIRSI DMT-99', kind: 'multimeter' },
  { name: 'Kungber SPS3010', kind: 'power_supply' },
];
const step = (o: Record<string, unknown> = {}) => ({
  title: 'Check continuity',
  tool: 'FNIRSI DMT-99',
  instructions: 'Set the meter to continuity and touch pin 1 to pin 2.',
  expect: 'A beep means they are connected.',
  ...o,
});

describe('sanitizePlan', () => {
  it('keeps a good plan and trims it to size', () => {
    const p = sanitizePlan({ goal: 'g', steps: [step({ instructions: 'x'.repeat(2000) })], record: 'r', safety: ['a'] }, owned)!;
    expect(p.steps[0].instructions).toHaveLength(700);
    expect(p.safety).toEqual(['a']);
  });
  it('matches tool names to the ones the owner has, ignoring case', () => {
    const p = sanitizePlan({ steps: [step({ tool: 'fnirsi dmt-99' })] }, owned)!;
    expect(p.steps[0].tool).toBe('FNIRSI DMT-99');
  });
  it('marks a tool the owner does not have, so it never looks doable', () => {
    const p = sanitizePlan({ steps: [step({ tool: 'Logic analyzer' })] }, owned)!;
    expect(p.steps[0].tool).toBe("Logic analyzer (you don't have this)");
  });
  it('treats a missing or "no tool" answer as needing no tool', () => {
    expect(sanitizePlan({ steps: [step({ tool: '' })] }, owned)!.steps[0].tool).toBe(NO_TOOL);
    expect(sanitizePlan({ steps: [step({ tool: 'No tool needed' })] }, owned)!.steps[0].tool).toBe(NO_TOOL);
  });
  it('drops steps without a title or instructions, and caps the count', () => {
    const many = Array.from({ length: 20 }, (_, i) => step({ title: `s${i}` }));
    const p = sanitizePlan({ steps: [{ title: 'x' }, step({ instructions: '' }), ...many] }, owned)!;
    expect(p.steps).toHaveLength(10);
    expect(p.steps[0].title).toBe('s0');
  });
  it('returns null when there is nothing usable', () => {
    for (const junk of [null, undefined, 'x', {}, { steps: 'no' }, { steps: [] }, { steps: [{}] }])
      expect(sanitizePlan(junk, owned)).toBeNull();
  });
  it('limits and cleans the lists', () => {
    const p = sanitizePlan(
      { steps: [step()], safety: ['a', '', 5, ...Array.from({ length: 10 }, (_, i) => `s${i}`)], missing_tools: ['LCR meter', 7] },
      owned,
    )!;
    expect(p.safety).toHaveLength(6);
    expect(p.missing_tools).toEqual(['LCR meter']);
  });
  it('keeps a caution only when there is one', () => {
    const p = sanitizePlan({ steps: [step({ caution: 'Limit current to 50 mA.' }), step({ title: 'b' })] }, owned)!;
    expect(p.steps[0].caution).toBe('Limit current to 50 mA.');
    expect(p.steps[1].caution).toBeNull();
  });
});

describe('power supply safety', () => {
  const powered = step({ title: 'Power up', tool: 'Kungber SPS3010', instructions: 'Set 3.3 V and connect.' });
  it('adds a current-limit warning when a step uses the supply and the plan has none', () => {
    const p = sanitizePlan({ steps: [step(), powered], safety: ['Do not touch the part while powered.'] }, owned)!;
    expect(p.safety[0]).toBe(SUPPLY_SAFETY);
    expect(p.safety).toHaveLength(2);
  });
  it('adds it to a plan that listed no safety at all', () => {
    expect(sanitizePlan({ steps: [powered] }, owned)!.safety).toEqual([SUPPLY_SAFETY]);
  });
  it('does not repeat it when the model already covered the current limit', () => {
    const p = sanitizePlan({ steps: [powered], safety: ['Set the current limit to 20 mA first.'] }, owned)!;
    expect(p.safety).toEqual(['Set the current limit to 20 mA first.']);
  });
  it('adds nothing when no step uses the supply', () => {
    expect(sanitizePlan({ steps: [step()] }, owned)!.safety).toEqual([]);
  });
  it('a supply the owner does not have is not treated as a powered step', () => {
    const p = sanitizePlan({ steps: [step({ tool: 'Lab supply XYZ' })] }, [{ name: 'FNIRSI DMT-99', kind: 'multimeter' }])!;
    expect(p.safety).toEqual([]);
  });
});

describe('buildPrompt', () => {
  const item = { name: 'Mystery module', notes: 'Bought at a fair', manufacturer: null };
  const tools = [{ kind: 'power_supply', name: 'Kungber SPS3010', notes: 'Output 0 to 30 V and 0 to 10 A.' }];
  it('lists the saved details, the unknowns and the tools by exact name', () => {
    const p = buildPrompt(item, tools, ['pin order', 'voltage rating'], '');
    expect(p).toContain('"name": "Mystery module"');
    expect(p).not.toContain('manufacturer');
    expect(p).toContain('"pin order", "voltage rating"');
    expect(p).toContain('- Kungber SPS3010 (power supply): Output 0 to 30 V and 0 to 10 A.');
  });
  it('copes with no tools and no stated unknowns', () => {
    const p = buildPrompt(item, [], [], 'it was hot');
    expect(p).toContain('(none listed)');
    expect(p).toContain('not specified');
    expect(p).toContain('it was hot');
  });
});
