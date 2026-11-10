// Pure helpers for refine-item (no Deno or network imports, so they run under vitest).

export type Layout = 'dual' | 'single' | 'three-lead';
export type PinRole = 'power' | 'ground' | 'input' | 'output' | 'io' | 'nc' | 'other';
export interface Pin {
  number: number;
  name: string;
  role: PinRole;
}

export const FIELD_LIMITS = {
  name: 120,
  category: 60,
  value: 60,
  package: 80,
  part_number: 60,
  manufacturer: 60,
  location: 60,
  description: 400,
} as const;
export type Field = keyof typeof FIELD_LIMITS;
const FIELDS = Object.keys(FIELD_LIMITS) as Field[];

export interface Change {
  field: Field;
  from: string | null;
  to: string;
}

export interface Refinement {
  changes: Change[];
  /** Text to append to the part's notes. */
  notes_add: string | null;
  pinout: { layout: Layout; pins: Pin[] } | null;
  summary: string;
  /** Things the model could not read or was unsure about, shown to the user before they accept anything. */
  uncertain: string[];
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const LAYOUTS: Layout[] = ['dual', 'single', 'three-lead'];
const ROLES: PinRole[] = ['power', 'ground', 'input', 'output', 'io', 'nc', 'other'];

/** Numbered 1..N with no gaps and a count that suits the layout, or nothing is drawn: a wrong diagram is worse than none. */
export function sanitizePins(raw: unknown, layout: unknown): { pins: Pin[]; layout: Layout } | null {
  if (!LAYOUTS.includes(layout as Layout) || !Array.isArray(raw)) return null;
  const pins = raw.map((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { number: Number(r.number), name: clip(r.name, 24), role: (ROLES.includes(r.role as PinRole) ? r.role : 'other') as PinRole };
  });
  if (pins.some((p) => !Number.isInteger(p.number) || !p.name)) return null;
  pins.sort((a, b) => a.number - b.number);
  if (pins.some((p, i) => p.number !== i + 1)) return null;
  const n = pins.length;
  if (layout === 'dual' && (n < 4 || n > 64 || n % 2 !== 0)) return null;
  if (layout === 'three-lead' && n !== 3) return null;
  if (layout === 'single' && (n < 2 || n > 40)) return null;
  return { pins, layout: layout as Layout };
}

/**
 * Turns the model's untrusted proposal into safe, minimal changes against what is saved:
 * only known fields, clipped, and only where the value actually differs.
 */
export function cleanRefinement(raw: unknown, current: Record<string, unknown>): Refinement {
  const r = (raw ?? {}) as Record<string, unknown>;
  const proposed = (r.fields ?? {}) as Record<string, unknown>;
  const changes: Change[] = [];
  for (const field of FIELDS) {
    const to = clip(proposed[field], FIELD_LIMITS[field]);
    const from = typeof current[field] === 'string' ? (current[field] as string).trim() : '';
    if (to && to !== from) changes.push({ field, from: from || null, to });
  }

  const note = clip(r.notes_add, 600);
  const existingNotes = typeof current.notes === 'string' ? current.notes : '';
  const notes_add = note && !existingNotes.includes(note) ? note : null;

  let pinout = sanitizePins(r.pins, r.layout);
  if (pinout && JSON.stringify(pinout) === JSON.stringify(stripSource(current.pinout))) pinout = null;

  const uncertain = (Array.isArray(r.uncertain) ? r.uncertain : [])
    .map((u) => clip(u, 160))
    .filter(Boolean)
    .slice(0, 6);

  return { changes, notes_add, pinout, summary: clip(r.summary, 400), uncertain };
}

function stripSource(p: unknown): unknown {
  if (!p || typeof p !== 'object') return null;
  const { layout, pins } = p as { layout?: unknown; pins?: unknown };
  return { pins, layout };
}

const SHOWN = [
  'name',
  'category',
  'value',
  'package',
  'part_number',
  'manufacturer',
  'location',
  'description',
  'notes',
  'datasheet_url',
] as const;

export function buildPrompt(current: Record<string, unknown>, comments: string, imageCount: number): string {
  const known = Object.fromEntries(SHOWN.filter((k) => current[k]).map((k) => [k, current[k]]));
  const pinout = current.pinout ? { pinout: current.pinout } : {};
  return `You are updating one entry in a hobbyist electronics parts inventory with new information.

Currently saved:
${JSON.stringify({ ...known, ...pinout }, null, 2)}

New information from the owner: ${imageCount > 0 ? `${imageCount} photo${imageCount > 1 ? 's' : ''} (attached)` : 'no photos'}${comments ? ' and these comments:' : '.'}
${comments ? `"""\n${comments}\n"""` : ''}

Call propose_update once.
Rules:
- Only propose a field change when the photos or comments clearly support it. Leave a field out if it is already right. Do not reword things for style.
- The owner's comments beat what you infer from photos, and measurements they report are facts. If the two disagree, follow the comments and mention it in "uncertain".
- Never invent part numbers, values, markings or pin names. If something is not legible, leave it out and say so in "uncertain".
- Put new facts that do not belong in a field (markings, serial numbers, how it was tested, quirks) in "notes_add" as one or two short sentences. Do not repeat what the notes already say.
- Pins: report \`pins\` and \`layout\` only when you can read the pin labels or the owner gave the order, and you know which end is pin 1. Number from 1 with no gaps. Layout "dual" is a two-row chip (pin 1 top-left, down the left side then up the right), "single" is one row (headers, modules, wires), "three-lead" is a 3-pin transistor-style part. If you cannot tell the orientation, omit pins and say so.
- "summary" is one or two plain sentences on what you changed and why.`;
}

export const REFINE_TOOL = {
  name: 'propose_update',
  description: 'Propose updates to the saved part based on the new photos and comments. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        description: 'Only the fields that should change, with their new values',
        properties: Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])),
      },
      notes_add: { type: 'string', description: 'New facts to append to the notes' },
      layout: { type: 'string', enum: LAYOUTS, description: 'Physical pin arrangement, with pins' },
      pins: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            name: { type: 'string' },
            role: { type: 'string', enum: ROLES },
          },
          required: ['number', 'name', 'role'],
        },
      },
      summary: { type: 'string' },
      uncertain: { type: 'array', items: { type: 'string' }, description: 'Things you could not read or are unsure of' },
    },
    required: ['summary'],
  },
};
