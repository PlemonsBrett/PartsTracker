import { describe, expect, it } from 'vitest';
import { buildPrompt, cleanRefinement, sanitizePins } from './logic.ts';

const current = {
  name: 'DHT11 sensor',
  category: 'Sensor',
  part_number: 'DHT11',
  package: '3-pin header',
  description: 'Blue sensor',
  notes: 'Bought at Micro Center',
  pinout: null,
};
const pins3 = [
  { number: 1, name: 'DATA', role: 'io' },
  { number: 2, name: 'VCC', role: 'power' },
  { number: 3, name: 'GND', role: 'ground' },
];

describe('cleanRefinement', () => {
  it('keeps only fields that actually change, with before and after', () => {
    const r = cleanRefinement(
      { fields: { name: 'DHT11 sensor', package: '3-pin breakout board', manufacturer: 'ASAIR' }, summary: 's' },
      current,
    );
    expect(r.changes).toEqual([
      { field: 'package', from: '3-pin header', to: '3-pin breakout board' },
      { field: 'manufacturer', from: null, to: 'ASAIR' },
    ]);
  });
  it('ignores unknown fields, non-strings and empty values', () => {
    const r = cleanRefinement({ fields: { quantity: '99', id: 'x', name: 42, category: '   ', user_id: 'evil' }, summary: 's' }, current);
    expect(r.changes).toEqual([]);
  });
  it('clips long values', () => {
    const r = cleanRefinement({ fields: { description: 'x'.repeat(2000) } }, current);
    expect(r.changes[0].to).toHaveLength(400);
  });
  it('drops a note that is already saved, keeps a new one', () => {
    expect(cleanRefinement({ notes_add: 'Bought at Micro Center' }, current).notes_add).toBeNull();
    expect(cleanRefinement({ notes_add: ' Serial SNJ123 ' }, current).notes_add).toBe('Serial SNJ123');
  });
  it('accepts valid pins and rejects broken ones without losing the rest', () => {
    const ok = cleanRefinement({ layout: 'single', pins: pins3, summary: 's' }, current);
    expect(ok.pinout?.pins).toHaveLength(3);
    const bad = cleanRefinement({ layout: 'dual', pins: pins3, fields: { name: 'New' }, summary: 's' }, current);
    expect(bad.pinout).toBeNull();
    expect(bad.changes).toHaveLength(1);
  });
  it('does not re-propose the pinout that is already saved', () => {
    const same = { ...current, pinout: { layout: 'single', pins: pins3, source: 'manual' } };
    expect(cleanRefinement({ layout: 'single', pins: pins3 }, same).pinout).toBeNull();
  });
  it('limits and cleans the uncertain list', () => {
    const r = cleanRefinement({ uncertain: ['a', '', 5, ...Array.from({ length: 10 }, (_, i) => `u${i}`)] }, current);
    expect(r.uncertain).toHaveLength(6);
    expect(r.uncertain[0]).toBe('a');
  });
  it('survives garbage', () => {
    for (const junk of [null, undefined, 'x', 7, [], { fields: 'nope', pins: 'nope' }]) {
      const r = cleanRefinement(junk, current);
      expect(r.changes).toEqual([]);
      expect(r.pinout).toBeNull();
    }
  });
});

describe('sanitizePins', () => {
  it('matches the rules used for datasheet pins', () => {
    expect(sanitizePins(pins3, 'single')).not.toBeNull();
    expect(sanitizePins(pins3, 'three-lead')).not.toBeNull();
    expect(sanitizePins(pins3, 'dual')).toBeNull();
    expect(sanitizePins(pins3.slice(0, 2).concat({ number: 4, name: 'X', role: 'io' }), 'single')).toBeNull(); // gap
  });
});

describe('buildPrompt', () => {
  it('includes what is saved, the comments and the photo count', () => {
    const p = buildPrompt(current, 'pin 1 is next to R1', 2);
    expect(p).toContain('"part_number": "DHT11"');
    expect(p).toContain('2 photos (attached)');
    expect(p).toContain('pin 1 is next to R1');
  });
  it('works with comments only or photos only', () => {
    expect(buildPrompt(current, 'hello', 0)).toContain('no photos');
    expect(buildPrompt(current, '', 1)).toContain('1 photo (attached)');
    expect(buildPrompt(current, '', 1)).not.toContain('"""');
  });
  it('leaves empty fields out of the saved summary', () => {
    expect(buildPrompt({ name: 'X', manufacturer: null }, '', 0)).not.toContain('manufacturer');
  });
});
