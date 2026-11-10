import { describe, expect, it } from 'vitest';
import {
  buildPinout,
  inferLayout,
  type Pin,
  parsePinLines,
  parsePinoutText,
  pinProblem,
  pinsToLines,
  resolvePinout,
  validPins,
} from './pinout';
import type { FactSheet } from './types';

const mk = (names: string[]): Pin[] => names.map((name, i) => ({ number: i + 1, name, role: 'other' }));
const facts = (o: Partial<FactSheet>): FactSheet => ({
  summary: '',
  specs: [],
  features: [],
  pinout: null,
  source_url: 'https://a.com',
  extracted_at: '',
  ...o,
});

describe('parsePinoutText', () => {
  it('reads the LM386 pinout exactly as stored', () => {
    const pins = parsePinoutText('1 GAIN, 2 -INPUT, 3 +INPUT, 4 GND, 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN')!;
    expect(pins.map((p) => p.name)).toEqual(['GAIN', '-INPUT', '+INPUT', 'GND', 'VOUT', 'VS', 'BYPASS', 'GAIN']);
    expect(pins[3].role).toBe('ground');
    expect(pins[5].role).toBe('power');
  });
  it('accepts other common separators', () => {
    expect(parsePinoutText('1: VCC; 2: OUT; 3: GND')?.map((p) => p.name)).toEqual(['VCC', 'OUT', 'GND']);
    expect(parsePinoutText('Pin 1 = VCC, Pin 2 - GND')?.map((p) => p.name)).toEqual(['VCC', 'GND']);
  });
  it('refuses anything it cannot read completely', () => {
    expect(parsePinoutText('1 VCC, 2 GND, banana')).toBeNull();
    expect(parsePinoutText('1 VCC, 3 GND')).toBeNull(); // gap
    expect(parsePinoutText('1 VCC')).toBeNull();
    expect(parsePinoutText(null)).toBeNull();
    expect(parsePinoutText('')).toBeNull();
  });
});

describe('role guessing from names (text pinouts only)', () => {
  const roleOf = (name: string) => parsePinoutText(`1 ${name}, 2 X`)![0].role;
  it('power', () => {
    for (const n of ['VCC', 'VDD', 'VS', 'AVCC', 'VBAT', '3V3', '5V', 'VIN']) expect(roleOf(n), n).toBe('power');
  });
  it('ground', () => {
    for (const n of ['GND', 'AGND', 'VSS', 'GND2']) expect(roleOf(n), n).toBe('ground');
  });
  it('outputs and inputs', () => {
    for (const n of ['OUT', 'VOUT', 'OUTPUT', 'TXD']) expect(roleOf(n), n).toBe('output');
    for (const n of ['-INPUT', '+INPUT', 'IN', 'RXD']) expect(roleOf(n), n).toBe('input');
  });
  it('anything ambiguous stays "other"', () => {
    for (const n of ['GAIN', 'BYPASS', 'VREF', 'ADJ', 'PB0']) expect(roleOf(n), n).toBe('other');
  });
  it('not connected', () => expect(roleOf('NC')).toBe('nc'));
});

describe('real saved pinouts', () => {
  it('HC-SR04: notes in parentheses are dropped from the labels', () => {
    const pins = parsePinoutText('1 Vcc (5V supply), 2 Trig (trigger pulse input), 3 Echo (echo pulse output), 4 GND (0V)')!;
    expect(pins.map((p) => p.name)).toEqual(['Vcc', 'Trig', 'Echo', 'GND']);
    expect(pins.map((p) => p.role)).toEqual(['power', 'other', 'other', 'ground']);
  });
  it('HC-SR04 is drawn as a single row from its "4-pin header" package', () => {
    const f = facts({ pinout: '1 Vcc (5V supply), 2 Trig (trigger pulse input), 3 Echo (echo pulse output), 4 GND (0V)' });
    expect(resolvePinout(f, '4-pin header (Vcc, Trig, Echo, Gnd)')?.layout).toBe('single');
  });
  it('LM386: the package only appears in the datasheet summary, and that is enough', () => {
    const f = facts({ pinout: '1 GAIN, 2 -INPUT, 3 +INPUT, 4 GND, 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN' });
    const hint = 'LM386N-1 audio power amplifier ... The N-1 version is the 8-pin DIP.';
    expect(resolvePinout(f, hint)?.layout).toBe('dual');
  });
  it('parts without a numbered pin list are left as text', () => {
    expect(parsePinoutText('Breakout pins (from Adafruit product page): SEL, LRCL, DOUT, BCLK, GND, 3V')).toBeNull();
    expect(parsePinoutText("2-pin PicoBlade: speaker + and speaker − (non-polarized). The page doesn't give a pin table.")).toBeNull();
    expect(parsePinoutText('Two lead wires (red +, black -), 20 cm; no pin numbering on page')).toBeNull();
  });
  it('long names are shortened so labels fit', () => {
    expect(parsePinoutText(`1 ${'X'.repeat(40)}, 2 B`)![0].name).toHaveLength(24);
  });
});

describe('inferLayout', () => {
  it('recognises packages from text', () => {
    expect(inferLayout(8, 'DIP-8')).toBe('dual');
    expect(inferLayout(14, 'Package: SOIC-14')).toBe('dual');
    expect(inferLayout(3, 'TO-92')).toBe('three-lead');
    expect(inferLayout(16, '16-pin header')).toBe('single');
  });
  it('returns null rather than guessing', () => {
    expect(inferLayout(8, '')).toBeNull();
    expect(inferLayout(8, 'Texas Instruments audio amplifier')).toBeNull();
    expect(inferLayout(7, 'DIP-8')).toBeNull(); // odd count cannot be dual-row
    expect(inferLayout(4, 'TO-92')).toBeNull();
  });
});

describe('resolvePinout', () => {
  const text = '1 GAIN, 2 -INPUT, 3 +INPUT, 4 GND, 5 VOUT, 6 VS, 7 BYPASS, 8 GAIN';
  it('prefers stored structured pins', () => {
    const pins = mk(['A', 'B', 'C', 'D']);
    expect(resolvePinout(facts({ pins, layout: 'dual', pinout: text }), '')?.pins).toBe(pins);
  });
  it('falls back to the text pinout when the package is known', () => {
    expect(resolvePinout(facts({ pinout: text }), 'LM386N DIP-8')?.layout).toBe('dual');
  });
  it('draws nothing when the package is unknown, instead of guessing', () => {
    expect(resolvePinout(facts({ pinout: text }), 'LM386N-1 audio amplifier')).toBeNull();
  });
  it('ignores invalid stored pins and uses the text instead', () => {
    expect(resolvePinout(facts({ pins: mk(['A', 'B', 'C']), layout: 'dual', pinout: text }), 'DIP-8')?.pins).toHaveLength(8);
  });
});

describe('validPins', () => {
  it('matches the rules the lookup function enforces', () => {
    expect(validPins(mk(['a', 'b', 'c', 'd']), 'dual')).toBe(true);
    expect(validPins(mk(['a', 'b', 'c']), 'dual')).toBe(false);
    expect(validPins(mk(['a', 'b', 'c']), 'three-lead')).toBe(true);
    expect(validPins(mk(['a']), 'single')).toBe(false);
    expect(
      validPins(
        [
          { number: 2, name: 'x', role: 'io' },
          { number: 3, name: 'y', role: 'io' },
        ],
        'single',
      ),
    ).toBe(false);
  });
});

describe('buildPinout geometry', () => {
  const by = (m: ReturnType<typeof buildPinout>, n: number) => m.pins.find((p) => p.pin.number === n)!;

  it('dual-row: pin 1 top-left, counting down the left, then up the right', () => {
    const m = buildPinout(mk(['1', '2', '3', '4', '5', '6', '7', '8']), 'dual');
    expect(by(m, 1).cx).toBeLessThan(m.body.x);
    expect(by(m, 5).cx).toBeGreaterThan(m.body.x + m.body.width);
    expect(by(m, 1).cy).toBe(by(m, 8).cy); // top row
    expect(by(m, 4).cy).toBe(by(m, 5).cy); // bottom row
    expect(by(m, 2).cy).toBeGreaterThan(by(m, 1).cy);
    expect(by(m, 7).cy).toBeGreaterThan(by(m, 8).cy);
    expect(m.notch).not.toBeNull();
    expect(m.pin1).not.toBeNull();
  });
  it('dual-row: every pin sits inside the canvas and none overlap', () => {
    const m = buildPinout(mk(Array.from({ length: 28 }, (_, i) => `PIN${i + 1}-LONG`)), 'dual');
    for (const p of m.pins) {
      expect(p.cx).toBeGreaterThan(0);
      expect(p.cx).toBeLessThan(m.width);
      expect(p.cy).toBeGreaterThan(0);
      expect(p.cy).toBeLessThan(m.height);
    }
    const spots = new Set(m.pins.map((p) => `${p.cx},${p.cy}`));
    expect(spots.size).toBe(28);
  });
  it('single-row: a vertical strip with pin 1 at the top', () => {
    const m = buildPinout(mk(Array.from({ length: 16 }, (_, i) => `P${i}`)), 'single');
    expect(by(m, 1).cy).toBeLessThan(by(m, 2).cy);
    expect(by(m, 16).cy).toBeGreaterThan(by(m, 15).cy);
    expect(new Set(m.pins.map((p) => p.cx)).size).toBe(1);
    expect(m.notch).toBeNull();
  });
  it('three-lead: left to right in front view', () => {
    const m = buildPinout(mk(['E', 'B', 'C']), 'three-lead');
    expect(by(m, 1).cx).toBeLessThan(by(m, 2).cx);
    expect(by(m, 2).cx).toBeLessThan(by(m, 3).cx);
    expect(by(m, 1).cy).toBe(by(m, 3).cy);
    expect(by(m, 1).cy).toBeGreaterThan(m.body.y + m.body.height);
  });
  it('refuses pins that do not fit the layout', () => {
    expect(() => buildPinout(mk(['a', 'b', 'c']), 'dual')).toThrow();
  });
});

describe('pin editor text', () => {
  it('reads one pin per line, pin 1 first, guessing roles from names', () => {
    const pins = parsePinLines('DATA\nVCC\n\n GND ');
    expect(pins.map((p) => `${p.number} ${p.name} ${p.role}`)).toEqual(['1 DATA other', '2 VCC power', '3 GND ground']);
  });
  it('an explicit |role overrides the guess and unknown roles fall back to the guess', () => {
    const pins = parsePinLines('S|input\nVCC|output\nGND|banana');
    expect(pins.map((p) => p.role)).toEqual(['input', 'output', 'ground']);
  });
  it('round-trips through pinsToLines', () => {
    const pins = parsePinLines('DATA|io\nVCC|power\nGND|ground');
    expect(parsePinLines(pinsToLines(pins))).toEqual(pins);
  });
  it('explains why pins cannot be drawn', () => {
    expect(pinProblem([], 'single')).toMatch(/at least one/);
    expect(pinProblem(parsePinLines('a\nb\nc'), 'dual')).toMatch(/even number/);
    expect(pinProblem(parsePinLines('a\nb'), 'three-lead')).toMatch(/exactly 3/);
    expect(pinProblem(parsePinLines('a\nb\nc'), 'single')).toBeNull();
    expect(pinProblem(parsePinLines('a\nb\nc\nd'), 'dual')).toBeNull();
  });
});
