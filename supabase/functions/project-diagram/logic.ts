// Pure helpers for project-diagram (no Deno or network imports, so they run under vitest).
// The model's wiring is untrusted: every name, reference and connection is checked before anything is stored or drawn.

export type PinRole = 'power' | 'ground' | 'input' | 'output' | 'io' | 'nc' | 'other';
const ROLES: PinRole[] = ['power', 'ground', 'input', 'output', 'io', 'nc', 'other'];

export interface PartInfo {
  /** Short reference the model must use, e.g. "R1", "U2". */
  ref: string;
  name: string;
  category: string | null;
  value: string | null;
  package: string | null;
  part_number: string | null;
  quantity: number;
  /** Where the owner said it goes. */
  role: string | null;
  /** True when the part is in the inventory (as opposed to one still to get). */
  inInventory: boolean;
  /** Known pin names from the part's pinout or datasheet, in pin order; null when unknown. */
  pins: string[] | null;
}

export interface Diagram {
  parts: { ref: string; label: string; role: string | null; external: boolean; pins: { name: string; role: PinRole }[] }[];
  nets: { name: string; ends: { ref: string; pin: string }[] }[];
  notes: string[];
  generated_at: string;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const PREFIX: [RegExp, string][] = [
  [/resistor|potentiometer|trim ?pot|photoresistor|thermistor/i, 'R'],
  [/capacitor|electrolytic/i, 'C'],
  [/inductor|coil|choke/i, 'L'],
  [/diode|zener|led\b/i, 'D'],
  [/transistor|mosfet|fet\b|bjt/i, 'Q'],
  [/switch|button/i, 'SW'],
  [/connector|header|terminal|jack/i, 'J'],
  [/crystal|oscillator/i, 'Y'],
  [/battery/i, 'B'],
];

/** Hands out references like R1, R2, C1, U1 by kind of part, so the prompt and the diagram agree on names. */
export function assignRefs<T extends { name: string; category: string | null }>(parts: T[]): (T & { ref: string })[] {
  const counts = new Map<string, number>();
  return parts.map((p) => {
    const hay = `${p.category ?? ''} ${p.name}`;
    const prefix = PREFIX.find(([re]) => re.test(hay))?.[1] ?? 'U';
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    return { ...p, ref: `${prefix}${n}` };
  });
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Keeps only wiring that refers to real parts and pins. A part with a known pinout may only use those pin names
 * (a pin number is accepted and turned into its name); a part with no known pinout may use the pins the model listed.
 * Outside things the model adds (a battery, a USB supply) are marked external and capped. Nets with fewer than two
 * valid ends are dropped, so nothing dangling is stored.
 */
export function sanitizeDiagram(raw: unknown, known: PartInfo[], now = new Date().toISOString()): Diagram | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const byRef = new Map(known.map((p) => [p.ref, p]));
  const parts = new Map<string, Diagram['parts'][number]>();

  for (const p of known) {
    parts.set(p.ref, { ref: p.ref, label: p.name.slice(0, 60), role: null, external: false, pins: [] });
  }

  const addPin = (ref: string, name: string, role: PinRole): string | null => {
    const part = parts.get(ref);
    const info = byRef.get(ref);
    if (!part || !name) return null;
    let pin = name.slice(0, 16);
    if (info?.pins) {
      const hit = info.pins.find((k) => norm(k) === norm(pin)) ?? (/^\d+$/.test(pin) ? info.pins[Number(pin) - 1] : undefined);
      if (!hit) return null;
      pin = hit;
    }
    const existing = part.pins.find((x) => norm(x.name) === norm(pin));
    if (existing) return existing.name;
    if (part.pins.length >= 24) return null;
    part.pins.push({ name: pin, role });
    return pin;
  };

  for (const x of Array.isArray(r.parts) ? r.parts : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const ref = clip(o.ref, 8);
    const part = parts.get(ref);
    if (!part || !byRef.has(ref)) continue;
    part.role = clip(o.role, 300) || null;
    for (const pn of Array.isArray(o.pins) ? o.pins : []) {
      const q = (pn ?? {}) as Record<string, unknown>;
      const role = ROLES.includes(q.role as PinRole) ? (q.role as PinRole) : 'other';
      addPin(ref, clip(q.name, 16), role);
    }
  }

  let externals = 0;
  for (const x of Array.isArray(r.external) ? r.external : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const ref = clip(o.ref, 8);
    const label = clip(o.label, 40);
    if (!ref || !label || parts.has(ref) || externals >= 4) continue;
    externals++;
    parts.set(ref, { ref, label, role: clip(o.role, 300) || null, external: true, pins: [] });
    for (const pn of Array.isArray(o.pins) ? o.pins : []) {
      const q = (pn ?? {}) as Record<string, unknown>;
      addPin(ref, clip(q.name, 16), ROLES.includes(q.role as PinRole) ? (q.role as PinRole) : 'other');
    }
  }

  const nets: Diagram['nets'] = [];
  for (const x of Array.isArray(r.nets) ? r.nets : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const ends: { ref: string; pin: string }[] = [];
    for (const e of Array.isArray(o.ends) ? o.ends : []) {
      const q = (e ?? {}) as Record<string, unknown>;
      const ref = clip(q.ref, 8);
      const part = parts.get(ref);
      if (!part) continue;
      const wanted = clip(q.pin, 16);
      // A pin the model never listed is added only for parts whose pins we don't already know.
      const pin = part.pins.find((k) => norm(k.name) === norm(wanted))?.name ?? addPin(ref, wanted, 'other');
      if (!pin || ends.some((d) => d.ref === ref && d.pin === pin)) continue;
      ends.push({ ref, pin });
    }
    if (ends.length >= 2 && nets.length < 40) nets.push({ name: clip(o.name, 24) || `Net ${nets.length + 1}`, ends: ends.slice(0, 8) });
  }
  if (nets.length === 0) return null;

  const notes = (Array.isArray(r.notes) ? r.notes : [])
    .map((n) => clip(n, 300))
    .filter(Boolean)
    .slice(0, 8);
  return { parts: [...parts.values()], nets, notes, generated_at: now };
}

export function buildPrompt(
  project: { name: string; description: string | null; notes: string | null },
  parts: PartInfo[],
  comment: string,
): string {
  const lines = parts.map((p) => {
    const bits = [p.value, p.package, p.part_number].filter(Boolean).join(', ');
    const pins = p.pins
      ? ` Pins: ${p.pins.map((n, i) => `${i + 1}=${n}`).join(', ')}.`
      : ' (Pinout not saved: use the datasheet or the standard pinout for this part.)';
    return `- ${p.ref}: ${p.name}${bits ? ` (${bits})` : ''} ×${p.quantity}${p.inInventory ? '' : ' [not in the inventory yet]'}.${p.role ? ` Owner's note: ${p.role}.` : ''}${pins}`;
  });
  return `A hobbyist is planning an electronics project and wants a wiring diagram.

Project: ${project.name}
${project.description ? `Description: ${project.description}\n` : ''}${project.notes ? `Their notes:\n"""\n${project.notes.slice(0, 4000)}\n"""\n` : ''}${comment ? `Extra instructions for this diagram:\n"""\n${comment}\n"""\n` : ''}
Parts they plan to use (refer to them ONLY by these refs):
${lines.join('\n')}

Call propose_diagram once.
Rules:
- Wire only what the project needs. Use the listed parts; where a quantity is more than 1 draw one box and mention the count in that part's "role".
- For each listed part, "pins" lists only the pins actually used in this circuit, with a role per pin. Use the part's own pin names exactly (and its listed numbering). If a part's pinout is not listed, use the standard pinout and say so in "notes" if you are not certain.
- "nets" are the electrical connections: each net has a short name (e.g. "5V", "GND", "SDA", "LED anode") and two or more ends, each a ref and a pin.
- If something the circuit needs is not in the list (a battery, a USB supply, a load, a resistor value you recommend), do not silently add it: put outside things in "external" (a ref like "X1", a label, pins) and put the missing parts, with values, in "notes". At most 4 external items.
- "role" says in one short sentence where the part goes and what it does, for example "Current-limiting resistor in series with the LED".
- Put any safety or assembly cautions in "notes" (polarity, voltage limits, current limits, orientation). At most 8 short notes.
- Do not invent a connection you are not confident about. A smaller correct diagram is better than a complete wrong one. You may search the web to check a pinout or typical wiring.`;
}

export const DIAGRAM_TOOL = {
  name: 'propose_diagram',
  description: 'Propose the wiring diagram. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            role: { type: 'string', description: 'Where this part goes and what it does, one short sentence' },
            pins: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, role: { type: 'string', enum: ROLES } },
                required: ['name'],
              },
            },
          },
          required: ['ref', 'pins'],
        },
      },
      external: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            label: { type: 'string' },
            role: { type: 'string' },
            pins: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, role: { type: 'string', enum: ROLES } },
                required: ['name'],
              },
            },
          },
          required: ['ref', 'label', 'pins'],
        },
      },
      nets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            ends: {
              type: 'array',
              items: { type: 'object', properties: { ref: { type: 'string' }, pin: { type: 'string' } }, required: ['ref', 'pin'] },
            },
          },
          required: ['name', 'ends'],
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['parts', 'nets'],
  },
};
