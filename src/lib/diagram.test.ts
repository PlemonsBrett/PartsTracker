import { describe, expect, it } from 'vitest';
import { isDiagram, layoutDiagram, wireKind } from './diagram';
import type { Diagram } from './types';

const d: Diagram = {
  parts: [
    {
      ref: 'U1',
      label: 'ATtiny85',
      role: null,
      external: false,
      pins: [
        { name: 'PB0', role: 'io' },
        { name: 'GND', role: 'ground' },
      ],
    },
    {
      ref: 'R1',
      label: '330Ω',
      role: null,
      external: false,
      pins: [
        { name: '1', role: 'other' },
        { name: '2', role: 'other' },
      ],
    },
    {
      ref: 'D1',
      label: 'LED',
      role: null,
      external: false,
      pins: [
        { name: 'A', role: 'input' },
        { name: 'K', role: 'ground' },
      ],
    },
  ],
  nets: [
    {
      name: 'PB0',
      ends: [
        { ref: 'U1', pin: 'PB0' },
        { ref: 'R1', pin: '1' },
      ],
    },
    {
      name: 'LED',
      ends: [
        { ref: 'R1', pin: '2' },
        { ref: 'D1', pin: 'A' },
      ],
    },
    {
      name: 'GND',
      ends: [
        { ref: 'D1', pin: 'K' },
        { ref: 'U1', pin: 'GND' },
      ],
    },
  ],
  notes: [],
  generated_at: '',
};

describe('layoutDiagram', () => {
  it('places every part without overlap and draws a wire per link', () => {
    const l = layoutDiagram(d);
    expect(l.parts).toHaveLength(3);
    for (const a of l.parts)
      for (const b of l.parts) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    expect(l.wires).toHaveLength(3);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
    for (const w of l.wires) expect(w.d).toMatch(/^M [\d. -]+ C /);
  });
  it('ignores a connection to a part or pin that does not exist', () => {
    const bad: Diagram = {
      ...d,
      nets: [
        {
          name: 'x',
          ends: [
            { ref: 'U1', pin: 'PB0' },
            { ref: 'NOPE', pin: '1' },
          ],
        },
        {
          name: 'y',
          ends: [
            { ref: 'U1', pin: 'ZZ' },
            { ref: 'R1', pin: '1' },
          ],
        },
      ],
    };
    expect(layoutDiagram(bad).wires).toHaveLength(0);
  });
  it('joins an n-way net with n-1 wires', () => {
    const star: Diagram = {
      ...d,
      nets: [
        {
          name: 'GND',
          ends: [
            { ref: 'U1', pin: 'GND' },
            { ref: 'D1', pin: 'K' },
            { ref: 'R1', pin: '2' },
          ],
        },
      ],
    };
    expect(layoutDiagram(star).wires).toHaveLength(2);
  });
  it('copes with an empty diagram and a single part', () => {
    expect(layoutDiagram({ ...d, parts: [], nets: [] }).wires).toEqual([]);
    expect(layoutDiagram({ ...d, parts: [d.parts[0]], nets: [] }).parts).toHaveLength(1);
  });
});

describe('wireKind', () => {
  it('recognises ground and power nets by name', () => {
    expect(wireKind('GND')).toBe('ground');
    expect(wireKind('5V')).toBe('power');
    expect(wireKind('VCC rail')).toBe('power');
    expect(wireKind('SDA')).toBe('signal');
  });
});

describe('isDiagram', () => {
  it('accepts a good diagram and rejects junk', () => {
    expect(isDiagram(d)).toBe(true);
    expect(isDiagram(null)).toBe(false);
    expect(isDiagram({ parts: [{ ref: 1 }], nets: [] })).toBe(false);
    expect(isDiagram({ parts: [], nets: 'x' })).toBe(false);
  });
});
