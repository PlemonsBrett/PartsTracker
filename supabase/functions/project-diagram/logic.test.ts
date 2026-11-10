import { describe, expect, it } from 'vitest';
import { assignRefs, buildPrompt, type PartInfo, sanitizeDiagram } from './logic.ts';

const part = (o: Partial<PartInfo>): PartInfo => ({
  ref: 'U1',
  name: 'ATtiny85',
  category: 'Microcontroller',
  value: null,
  package: 'DIP-8',
  part_number: null,
  quantity: 1,
  role: null,
  inInventory: true,
  pins: ['RESET', 'PB3', 'PB4', 'GND', 'PB0', 'PB1', 'PB2', 'VCC'],
  ...o,
});
const known = [
  part({}),
  part({ ref: 'R1', name: '330Ω resistor', category: 'Resistor', pins: null }),
  part({ ref: 'D1', name: 'Red LED', category: 'LED', pins: null }),
];

describe('assignRefs', () => {
  it('numbers parts by kind', () => {
    const r = assignRefs([
      { name: '10k resistor', category: 'Resistor' },
      { name: '1k resistor', category: 'Resistor' },
      { name: '100nF capacitor', category: 'Capacitor' },
      { name: 'ATtiny85', category: 'Microcontroller' },
      { name: 'Red LED', category: 'LED' },
    ]);
    expect(r.map((x) => x.ref)).toEqual(['R1', 'R2', 'C1', 'U1', 'D1']);
  });
});

describe('sanitizeDiagram', () => {
  const good = {
    parts: [
      {
        ref: 'U1',
        role: 'Drives the LED',
        pins: [
          { name: 'PB0', role: 'output' },
          { name: 'GND', role: 'ground' },
        ],
      },
      { ref: 'R1', role: 'Limits LED current', pins: [{ name: '1' }, { name: '2' }] },
      {
        ref: 'D1',
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
    notes: ['LED polarity matters.'],
  };
  it('keeps a good diagram', () => {
    const d = sanitizeDiagram(good, known, 't')!;
    expect(d.nets).toHaveLength(3);
    expect(d.parts.find((p) => p.ref === 'U1')?.role).toBe('Drives the LED');
    expect(d.generated_at).toBe('t');
  });
  it('drops pins that are not on a part with a known pinout, and nets left with one end', () => {
    const d = sanitizeDiagram(
      {
        ...good,
        nets: [
          {
            name: 'x',
            ends: [
              { ref: 'U1', pin: 'PB9' },
              { ref: 'R1', pin: '1' },
            ],
          },
          ...good.nets,
        ],
      },
      known,
    )!;
    expect(d.nets.map((n) => n.name)).toEqual(['PB0', 'LED', 'GND']);
    expect(d.parts.find((p) => p.ref === 'U1')?.pins.map((p) => p.name)).not.toContain('PB9');
  });
  it('turns a pin number into the pin name when the pinout is known', () => {
    const d = sanitizeDiagram(
      {
        parts: [],
        nets: [
          {
            name: 'GND',
            ends: [
              { ref: 'U1', pin: '4' },
              { ref: 'D1', pin: 'K' },
            ],
          },
        ],
      },
      known,
    )!;
    expect(d.nets[0].ends[0]).toEqual({ ref: 'U1', pin: 'GND' });
  });
  it('ignores parts and connections that name an unknown ref', () => {
    const d = sanitizeDiagram(
      {
        ...good,
        parts: [...good.parts, { ref: 'Z9', pins: [{ name: 'x' }] }],
        nets: [
          ...good.nets,
          {
            name: 'bad',
            ends: [
              { ref: 'Z9', pin: 'x' },
              { ref: 'R1', pin: '1' },
            ],
          },
        ],
      },
      known,
    )!;
    expect(d.parts.some((p) => p.ref === 'Z9')).toBe(false);
    expect(d.nets).toHaveLength(3);
  });
  it('adds outside things as external, capped at four, and never lets them reuse a real ref', () => {
    const ext = Array.from({ length: 6 }, (_, i) => ({ ref: `X${i}`, label: `Thing ${i}`, pins: [{ name: '+' }] }));
    const d = sanitizeDiagram({ ...good, external: [{ ref: 'U1', label: 'Fake', pins: [] }, ...ext] }, known)!;
    expect(d.parts.filter((p) => p.external)).toHaveLength(4);
    expect(d.parts.find((p) => p.ref === 'U1')?.external).toBe(false);
  });
  it('wires to an external part', () => {
    const d = sanitizeDiagram(
      {
        ...good,
        external: [{ ref: 'B1', label: '3V coin cell', pins: [{ name: '+', role: 'power' }] }],
        nets: [
          ...good.nets,
          {
            name: 'VCC',
            ends: [
              { ref: 'B1', pin: '+' },
              { ref: 'U1', pin: 'VCC' },
            ],
          },
        ],
      },
      known,
    )!;
    expect(d.nets.at(-1)?.ends).toEqual([
      { ref: 'B1', pin: '+' },
      { ref: 'U1', pin: 'VCC' },
    ]);
  });
  it('clips long text and falls back to a safe role', () => {
    const d = sanitizeDiagram(
      { ...good, notes: ['n'.repeat(900)], parts: [{ ref: 'R1', role: 'r'.repeat(900), pins: [{ name: 'p'.repeat(50), role: 'weird' }] }] },
      known,
    )!;
    expect(d.notes[0]).toHaveLength(300);
    expect(d.parts.find((p) => p.ref === 'R1')?.role).toHaveLength(300);
    expect(d.parts.find((p) => p.ref === 'R1')?.pins[0]).toEqual({ name: 'p'.repeat(16), role: 'other' });
  });
  it('returns null when nothing usable is connected, and for junk', () => {
    expect(sanitizeDiagram({ parts: good.parts, nets: [] }, known)).toBeNull();
    expect(sanitizeDiagram(null, known)).toBeNull();
    expect(sanitizeDiagram('x', known)).toBeNull();
  });
  it('does not duplicate an end that is listed twice', () => {
    const d = sanitizeDiagram(
      {
        nets: [
          {
            name: 'n',
            ends: [
              { ref: 'R1', pin: '1' },
              { ref: 'R1', pin: '1' },
              { ref: 'D1', pin: 'A' },
            ],
          },
        ],
      },
      known,
    )!;
    expect(d.nets[0].ends).toHaveLength(2);
  });
});

describe('buildPrompt', () => {
  it('lists each part by ref, flags ones not in the inventory, and includes known pins', () => {
    const p = buildPrompt(
      { name: 'Blinker', description: 'Blink an LED', notes: 'Use PB0' },
      [...known, part({ ref: 'B1', name: 'CR2032 holder', inInventory: false, pins: null })],
      'keep it simple',
    );
    expect(p).toContain('U1: ATtiny85');
    expect(p).toContain('4=GND');
    expect(p).toContain('B1: CR2032 holder');
    expect(p).toContain('[not in the inventory yet]');
    expect(p).toContain('Use PB0');
    expect(p).toContain('keep it simple');
  });
});
