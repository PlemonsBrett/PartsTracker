import { supabase } from './supabase';
import type { Diagram, DiagramPart, PinRole } from './types';

export const BOX_W = 168;
const HEAD = 30;
const ROW = 20;
const PAD = 8;
const GAP_X = 150;
const GAP_Y = 36;
const MARGIN = 24;

export interface PlacedPart {
  part: DiagramPart;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
}
export interface Wire {
  net: string;
  index: number;
  d: string;
  label: { x: number; y: number };
}
export interface DiagramLayout {
  width: number;
  height: number;
  parts: PlacedPart[];
  wires: Wire[];
}

const pinY = (p: PlacedPart, pin: string) => {
  const i = Math.max(
    0,
    p.part.pins.findIndex((k) => k.name === pin),
  );
  return p.y + HEAD + PAD + i * ROW + ROW / 2;
};

/**
 * Boxes go in a grid, wide enough for the number of parts; every connection is a curve from one pin to the next end of
 * its net. A wire leaves a box on the side facing its target, so most wires cross the gap between columns rather than
 * running over other boxes. Pure, so it is tested without a browser.
 */
export function layoutDiagram(diagram: Diagram): DiagramLayout {
  const n = diagram.parts.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const heights = diagram.parts.map((p) => HEAD + PAD * 2 + Math.max(1, p.pins.length) * ROW);
  const placed: PlacedPart[] = [];
  const colY = new Array(cols).fill(MARGIN);
  diagram.parts.forEach((part, i) => {
    const col = i % cols;
    // Fill the row from the shortest column so tall boxes don't leave holes.
    const x = MARGIN + col * (BOX_W + GAP_X);
    placed.push({ part, x, y: colY[col], w: BOX_W, h: heights[i], col });
    colY[col] += heights[i] + GAP_Y;
  });
  const byRef = new Map(placed.map((p) => [p.part.ref, p]));
  const wires: Wire[] = [];
  diagram.nets.forEach((net, index) => {
    const ends = net.ends
      .map((e) => ({ e, p: byRef.get(e.ref) }))
      .filter((x): x is { e: typeof x.e; p: PlacedPart } => Boolean(x.p) && x.p?.part.pins.some((k) => k.name === x.e.pin) === true)
      .sort((a, b) => a.p.col - b.p.col || a.p.y - b.p.y);
    for (let k = 0; k + 1 < ends.length; k++) {
      const a = ends[k];
      const b = ends[k + 1];
      const ay = pinY(a.p, a.e.pin);
      const by = pinY(b.p, b.e.pin);
      const sameCol = a.p.col === b.p.col;
      const aRight = sameCol || a.p.col < b.p.col;
      const bRight = sameCol; // same column: both leave on the right and loop; otherwise b is entered from its left
      const ax = aRight ? a.p.x + a.p.w : a.p.x;
      const bx = bRight ? b.p.x + b.p.w : b.p.x;
      const reach = sameCol ? 46 + 10 * (index % 4) : Math.max(36, Math.abs(bx - ax) / 2);
      const c1 = ax + (aRight ? reach : -reach);
      const c2 = bx + (bRight ? reach : -reach);
      wires.push({
        net: net.name,
        index,
        d: `M ${ax} ${ay} C ${c1} ${ay}, ${c2} ${by}, ${bx} ${by}`,
        label: { x: (ax + bx) / 2 + (sameCol ? reach * 0.7 : 0), y: (ay + by) / 2 - 4 },
      });
    }
  });
  const width = MARGIN * 2 + cols * BOX_W + (cols - 1) * GAP_X + (cols === 1 || n <= cols ? 60 : 40);
  const height = Math.max(...colY) - GAP_Y + MARGIN;
  return { width, height: Math.max(height, 80), parts: placed, wires };
}

export type WireKind = 'power' | 'ground' | 'signal';
export const wireKind = (name: string): WireKind =>
  /^(gnd|agnd|ground|0v|vss|v-)\b/i.test(name.trim())
    ? 'ground'
    : /^(vcc|vdd|vin|vbat|vbus|\+?\d+(\.\d+)?v|3v3|5v|v\+|power)/i.test(name.trim())
      ? 'power'
      : 'signal';

/** Shallow check on what comes back from storage, so a malformed diagram never breaks the page. */
export function isDiagram(x: unknown): x is Diagram {
  const d = x as Diagram | null;
  return Boolean(
    d &&
      Array.isArray(d.parts) &&
      Array.isArray(d.nets) &&
      d.parts.every((p) => p && typeof p.ref === 'string' && typeof p.label === 'string' && Array.isArray(p.pins)) &&
      d.nets.every((n) => n && typeof n.name === 'string' && Array.isArray(n.ends)),
  );
}

export const PIN_ROLE_CLASS: Record<PinRole, string> = {
  power: 'power',
  ground: 'ground',
  input: 'input',
  output: 'output',
  io: 'io',
  nc: 'nc',
  other: 'other',
};

/** Asks Claude for a wiring diagram for the project's parts. Nothing is saved here. */
export async function requestDiagram(args: {
  projectId: string;
  text?: string;
}): Promise<{ diagram: Diagram; refs: { ref: string; part_id: string }[] }> {
  const { data, error } = await supabase.functions.invoke('project-diagram', {
    body: { project_id: args.projectId, text: args.text || undefined },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { diagram: Diagram; refs: { ref: string; part_id: string }[] };
}
