import type { FactSheet, Layout, Pin, PinRole } from './types';

export type { Layout, Pin, PinRole };

/** Same rules as the lookup function applies before storing: numbered 1..N, count suits the layout. */
export function validPins(pins: Pin[], layout: Layout): boolean {
  const n = pins.length;
  if (pins.some((p, i) => p.number !== i + 1 || !p.name)) return false;
  if (layout === 'dual') return n >= 4 && n <= 64 && n % 2 === 0;
  if (layout === 'three-lead') return n === 3;
  return n >= 2 && n <= 40;
}

// Only the unambiguous names are coloured; everything else stays "other" rather than risk a misleading colour.
const POWER = /^(vcc|vdd|vs|vbat|vbus|vin|avcc|avdd|vccio|v\+|\+?\d+(\.\d+)?v|3v3)\d*$/i;
const GROUND = /^(gnd|agnd|dgnd|pgnd|vss|v-|ground|0v)\d*$/i;
const NC = /^(nc|n\/c|n\.c\.|dnc)$/i;
const INPUT = /^([+-]?in(put)?|din|rxd?)\d*$/i;
const OUTPUT = /^(v?out(put)?|dout|txd?)\d*$/i;

function guessRole(name: string): PinRole {
  const n = name.trim();
  if (GROUND.test(n)) return 'ground';
  if (NC.test(n)) return 'nc';
  if (POWER.test(n)) return 'power';
  if (OUTPUT.test(n)) return 'output';
  if (INPUT.test(n)) return 'input';
  return 'other';
}

/**
 * Reads the text pinout saved before structured pins existed: "1 GAIN, 2 -INPUT, 3 +INPUT, ...".
 * Returns null unless every entry parses and the numbers run 1..N, so a partial parse never draws a wrong diagram.
 */
export function parsePinoutText(text: string | null | undefined): Pin[] | null {
  if (!text) return null;
  const parts = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const pins: Pin[] = [];
  for (const part of parts) {
    // Separator is ":"/"=", a spaced dash ("2 - GND"), or plain space; a dash glued to the name ("2 -INPUT") stays in the name.
    const m = part.match(/^(?:pin\s*)?(\d+)(?:\s*[:=]\s*|\s+-\s+|\s+)(\S.*)$/i);
    if (!m) return null;
    // "Vcc (5V supply)" is labelled "Vcc" on the diagram; the note is dropped.
    const name = (m[2].replace(/\s*\(.*$/, '').trim() || m[2].trim()).slice(0, 24);
    pins.push({ number: Number(m[1]), name, role: guessRole(name) });
  }
  pins.sort((a, b) => a.number - b.number);
  return validPins(pins, 'single') || validPins(pins, 'dual') ? pins : null;
}

/** Guesses the layout from the part's own text (package, name, ...). Null when it can't tell. */
export function inferLayout(pinCount: number, hint: string): Layout | null {
  const h = hint.toLowerCase();
  if (pinCount === 3 && /\b(to-?(92|220|126|247)|sot-?(23|223|89))/.test(h)) return 'three-lead';
  if (pinCount >= 4 && pinCount % 2 === 0 && /\b(p?dip|soic|sop|ssop|tssop|msop|so-?\d+)/.test(h)) return 'dual';
  if (/\b(sip|(\d+-?pin )?header)\b/.test(h)) return pinCount >= 2 ? 'single' : null;
  return null;
}

const ROLE_WORDS: PinRole[] = ['power', 'ground', 'input', 'output', 'io', 'nc', 'other'];

/**
 * Pins typed one per line, pin 1 first: "DATA", "VCC|power", "GND". A trailing "|role" sets the colour;
 * otherwise it is guessed from the name. Blank lines are ignored.
 */
export function parsePinLines(text: string): Pin[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [rawName, rawRole] = line.split('|').map((x) => x.trim());
      const role = ROLE_WORDS.find((r) => r === rawRole?.toLowerCase());
      const name = rawName.slice(0, 24);
      return { number: i + 1, name, role: role ?? guessRole(name) };
    });
}

export function pinsToLines(pins: Pin[]): string {
  return pins.map((p) => `${p.name}|${p.role}`).join('\n');
}

/** A short reason the pins can't be drawn with this layout, or null when they can. */
export function pinProblem(pins: Pin[], layout: Layout): string | null {
  const n = pins.length;
  if (n === 0) return 'Add at least one pin.';
  if (validPins(pins, layout)) return null;
  if (layout === 'dual')
    return n % 2 !== 0 ? `A dual-row chip needs an even number of pins (you have ${n}).` : 'A dual-row chip needs 4 to 64 pins.';
  if (layout === 'three-lead') return `A 3-lead part needs exactly 3 pins (you have ${n}).`;
  return n < 2 ? 'A single row needs at least 2 pins.' : 'A single row can have at most 40 pins.';
}

export interface Drawable {
  pins: Pin[];
  layout: Layout;
}

/** What to draw for a part: the stored structured pins, or else the saved text pinout when it is unambiguous. */
export function resolvePinout(facts: FactSheet, hint: string): Drawable | null {
  if (facts.pins && facts.layout && validPins(facts.pins, facts.layout)) return { pins: facts.pins, layout: facts.layout };
  const pins = parsePinoutText(facts.pinout);
  const layout = pins ? inferLayout(pins.length, hint) : null;
  return pins && layout && validPins(pins, layout) ? { pins, layout } : null;
}

// ---- geometry -----------------------------------------------------------------------------------------------

export interface PinGeo {
  pin: Pin;
  /** Centre of the numbered circle. */
  cx: number;
  cy: number;
  /** The lead between the body and the circle. */
  stub: { x1: number; y1: number; x2: number; y2: number };
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}

export interface PinoutModel {
  layout: Layout;
  width: number;
  height: number;
  body: { x: number; y: number; width: number; height: number };
  pins: PinGeo[];
  /** Semicircle notch centre on the body's top edge (dual-row packages). */
  notch: { x: number; y: number } | null;
  /** Dot marking pin 1 on the body. */
  pin1: { x: number; y: number } | null;
  /** Where the part number is written. */
  title: { x: number; y: number };
}

export const ROW = 28;
export const STUB = 14;
export const R = 11;
const PAD = 8;
const CHAR_W = 6.8;

const labelWidth = (pins: Pin[], min: number, max: number) =>
  Math.min(max, Math.max(min, Math.max(...pins.map((p) => p.name.length)) * CHAR_W + 8));

export function buildPinout(pins: Pin[], layout: Layout): PinoutModel {
  if (!validPins(pins, layout)) throw new Error('Pins do not fit this layout');
  if (layout === 'dual') return dual(pins);
  if (layout === 'single') return single(pins);
  return threeLead(pins);
}

function dual(pins: Pin[]): PinoutModel {
  const half = pins.length / 2;
  const labelW = labelWidth(pins, 40, 120);
  const bodyW = 96;
  const leftCx = PAD + labelW + 6 + R;
  const bodyX = leftCx + R + STUB;
  const rightCx = bodyX + bodyW + STUB + R;
  const bodyY = PAD + 6;
  const rowY = (i: number) => bodyY + 22 + ROW / 2 + i * ROW;
  const geo: PinGeo[] = [];
  for (let i = 0; i < half; i++) {
    const cy = rowY(i);
    const left = pins[i];
    const right = pins[pins.length - 1 - i]; // pin N is top right, counting up the right side
    geo.push({
      pin: left,
      cx: leftCx,
      cy,
      stub: { x1: leftCx + R, y1: cy, x2: bodyX, y2: cy },
      label: { x: leftCx - R - 6, y: cy, anchor: 'end' },
    });
    geo.push({
      pin: right,
      cx: rightCx,
      cy,
      stub: { x1: bodyX + bodyW, y1: cy, x2: rightCx - R, y2: cy },
      label: { x: rightCx + R + 6, y: cy, anchor: 'start' },
    });
  }
  geo.sort((a, b) => a.pin.number - b.pin.number);
  const bodyH = 22 + half * ROW + 10;
  return {
    layout: 'dual',
    width: rightCx + R + 6 + labelW + PAD,
    height: bodyY + bodyH + PAD,
    body: { x: bodyX, y: bodyY, width: bodyW, height: bodyH },
    pins: geo,
    notch: { x: bodyX + bodyW / 2, y: bodyY },
    pin1: { x: bodyX + 14, y: bodyY + 16 },
    title: { x: bodyX + bodyW / 2, y: bodyY + bodyH / 2 },
  };
}

function single(pins: Pin[]): PinoutModel {
  const labelW = labelWidth(pins, 40, 160);
  const bodyW = 22;
  const bodyX = PAD;
  const bodyY = PAD;
  const cx = bodyX + bodyW + STUB + R;
  const geo: PinGeo[] = pins.map((pin, i) => {
    const cy = bodyY + ROW / 2 + i * ROW;
    return {
      pin,
      cx,
      cy,
      stub: { x1: bodyX + bodyW, y1: cy, x2: cx - R, y2: cy },
      label: { x: cx + R + 6, y: cy, anchor: 'start' },
    };
  });
  const bodyH = pins.length * ROW;
  return {
    layout: 'single',
    width: cx + R + 6 + labelW + PAD,
    height: bodyY + bodyH + PAD,
    body: { x: bodyX, y: bodyY, width: bodyW, height: bodyH },
    pins: geo,
    notch: null,
    pin1: { x: bodyX + bodyW / 2, y: bodyY + 8 },
    title: { x: bodyX + bodyW / 2, y: bodyY + bodyH / 2 },
  };
}

function threeLead(pins: Pin[]): PinoutModel {
  const colW = Math.min(100, Math.max(60, Math.max(...pins.map((p) => p.name.length)) * CHAR_W + 14));
  const bodyX = PAD;
  const bodyY = PAD;
  const bodyH = 52;
  const cy = bodyY + bodyH + STUB + R;
  const geo: PinGeo[] = pins.map((pin, i) => {
    const cx = bodyX + colW * (i + 0.5);
    return {
      pin,
      cx,
      cy,
      stub: { x1: cx, y1: bodyY + bodyH, x2: cx, y2: cy - R },
      label: { x: cx, y: cy + R + 14, anchor: 'middle' },
    };
  });
  return {
    layout: 'three-lead',
    width: bodyX * 2 + colW * 3,
    height: cy + R + 14 + 10 + PAD,
    body: { x: bodyX, y: bodyY, width: colW * 3, height: bodyH },
    pins: geo,
    notch: null,
    pin1: null,
    title: { x: bodyX + (colW * 3) / 2, y: bodyY + bodyH / 2 },
  };
}
