// Pure helpers for project-ideas (no Deno or network imports, so they run under vitest).
// The model's ideas are untrusted: every part is matched against the real inventory and every field is clamped.

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface IdeaPart {
  item_id: string | null;
  name: string;
  quantity: number;
  optional: boolean;
  role: string;
}
export interface PrintedPart {
  name: string;
  printer: string;
  material: string;
  notes: string;
}
export interface Idea {
  title: string;
  summary: string;
  difficulty: Difficulty;
  hours: number | null;
  parts: IdeaPart[];
  printed: PrintedPart[];
  tools_needed: string[];
  steps: string[];
}

export interface StockItem {
  id: string;
  name: string;
  category: string | null;
  value: string | null;
  package: string | null;
  part_number: string | null;
  quantity: number;
}
export interface ToolInfo {
  kind: string;
  name: string;
  notes: string | null;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number, each: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, each))
    .filter(Boolean)
    .slice(0, max);

export const MAX_IDEAS = 10;
const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced'];

/**
 * Keeps ideas that stand up: a title, at least one required part, and parts that are either real inventory items
 * (matched by id, named from the inventory so the label can't drift) or plainly "to buy". Printed parts survive only
 * when they name a printer the owner has. Ideas that repeat an earlier title are dropped.
 */
export function sanitizeIdeas(
  raw: unknown,
  stock: Pick<StockItem, 'id' | 'name'>[],
  printers: string[],
  existingTitles: string[] = [],
): Idea[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const byId = new Map(stock.map((s) => [s.id, s.name]));
  const ownedPrinters = new Map(printers.map((p) => [p.toLowerCase(), p]));
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const out: Idea[] = [];

  for (const x of Array.isArray(r.ideas) ? r.ideas : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const title = clip(o.title, 80);
    if (!title || seen.has(title.toLowerCase())) continue;

    const parts: IdeaPart[] = [];
    const used = new Set<string>();
    for (const y of Array.isArray(o.parts) ? o.parts : []) {
      const p = (y ?? {}) as Record<string, unknown>;
      const id = typeof p.item_id === 'string' && byId.has(p.item_id) ? p.item_id : null;
      if (id && used.has(id)) continue;
      const name = id ? (byId.get(id) as string) : clip(p.name, 80);
      if (!name) continue;
      if (id) used.add(id);
      const q = Math.round(Number(p.quantity));
      parts.push({
        item_id: id,
        name,
        quantity: Number.isFinite(q) ? Math.min(1000, Math.max(1, q)) : 1,
        optional: p.optional === true,
        role: clip(p.role, 200),
      });
      if (parts.length >= 14) break;
    }
    if (!parts.some((p) => !p.optional)) continue;

    const printed: PrintedPart[] = [];
    for (const y of Array.isArray(o.printed) ? o.printed : []) {
      const p = (y ?? {}) as Record<string, unknown>;
      const printer = ownedPrinters.get(clip(p.printer, 80).toLowerCase());
      const name = clip(p.name, 80);
      if (!printer || !name) continue;
      printed.push({ name, printer, material: clip(p.material, 40), notes: clip(p.notes, 240) });
      if (printed.length >= 4) break;
    }

    const hours = Number(o.hours);
    seen.add(title.toLowerCase());
    out.push({
      title,
      summary: clip(o.summary, 400),
      difficulty: DIFFICULTIES.includes(o.difficulty as Difficulty) ? (o.difficulty as Difficulty) : 'intermediate',
      hours: Number.isFinite(hours) && hours > 0 ? Math.min(200, Math.round(hours * 2) / 2) : null,
      parts,
      printed,
      tools_needed: list(o.tools_needed, 6, 60),
      steps: list(o.steps, 8, 300),
    });
    if (out.length >= MAX_IDEAS) break;
  }
  return out;
}

const line = (i: StockItem) => [i.id, i.name, i.value, i.package, i.part_number, `x${i.quantity}`].filter(Boolean).join(' | ');

export function buildPrompt(stock: StockItem[], tools: ToolInfo[], count: number, wish: string, avoid: string[]): string {
  const printers = tools.filter((t) => t.kind === '3d_printer');
  const others = tools.filter((t) => t.kind !== '3d_printer');
  const fmt = (t: ToolInfo) => `- ${t.name}${t.notes ? ` (${t.notes})` : ''}`;
  return `A hobbyist wants electronics project ideas that make good use of the parts they already own.

Their inventory, one part per line as "id | name | value | package | part number | quantity" (only parts with stock are listed):
${stock.map(line).join('\n') || '(empty)'}

Their equipment:
${others.length ? others.map(fmt).join('\n') : '- (none listed)'}
3D printers:
${printers.length ? printers.map(fmt).join('\n') : '- (none: do not suggest printed parts)'}
${wish ? `\nWhat they asked for this time:\n"""\n${wish}\n"""\n` : ''}${avoid.length ? `\nIdeas they already have (do not repeat): ${avoid.join('; ')}.\n` : ''}
Call propose_ideas once with ${count} different project ideas.
Rules:
- Aim for a spread: some that can be built almost entirely from the inventory, some that need a few extra parts, and one or two stretch projects. Prefer ideas that are fun and useful over generic ones.
- "parts" lists every electronic or mechanical part the project needs. When a part is in the inventory, copy its id exactly into item_id and use the quantity the project needs. When it is not, set item_id to null, name the part specifically (with its value, e.g. "BC547 NPN transistor") and say what it is. Never invent an id. Do not list the same inventory part twice. Mark genuinely optional extras with optional true.
- Be honest about what they need to buy: do not pretend a part is in the inventory because a similar one is. A different value or package is a different part unless it truly works as a substitute, and then say so in "role".
- 3D printing: only use the printers listed above, naming one exactly in "printer". Use it for things like enclosures, brackets, stands, knobs and mounts, and say what material to use. Resin (MSLA) suits small, detailed or smooth parts; FDM suits larger, stronger or functional parts. Look up the exact printers' build volumes and keep every printed part within them. Printed parts go in "printed", not "parts", because they are made rather than bought. Leave "printed" empty when printing does not help.
- Only suggest builds that are electrically sensible with the parts as listed: respect voltage and current limits, and put safety notes in the steps. Do not suggest anything connected to mains voltage.
- "tools_needed" lists tools beyond basic hand tools (use their equipment names where they apply). "steps" is a short outline, at most 8 steps. "hours" is a rough build time.
- You may search the web for inspiration or to check a part or printer.`;
}

export const IDEAS_TOOL = {
  name: 'propose_ideas',
  description: 'Propose the project ideas. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string', description: 'What it is and what it does, two sentences at most' },
            difficulty: { type: 'string', enum: DIFFICULTIES },
            hours: { type: 'number' },
            parts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item_id: { type: ['string', 'null'], description: 'The inventory id, or null when the part is not in the inventory' },
                  name: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 },
                  optional: { type: 'boolean' },
                  role: { type: 'string', description: 'What it does in the project, one short phrase' },
                },
                required: ['item_id', 'name', 'quantity'],
              },
            },
            printed: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  printer: { type: 'string', description: "One of the owner's printers by exact name" },
                  material: { type: 'string' },
                  notes: { type: 'string' },
                },
                required: ['name', 'printer'],
              },
            },
            tools_needed: { type: 'array', items: { type: 'string' } },
            steps: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'summary', 'parts'],
        },
      },
    },
    required: ['ideas'],
  },
};
