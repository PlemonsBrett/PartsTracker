// Pure helpers for find-datasheet (no Deno or network imports, so they run under vitest).

export type Layout = 'dual' | 'single' | 'three-lead';
export type PinRole = 'power' | 'ground' | 'input' | 'output' | 'io' | 'nc' | 'other';
export interface Pin {
  number: number;
  name: string;
  role: PinRole;
}

export interface FactSheet {
  summary: string;
  specs: { name: string; value: string }[];
  features: string[];
  pinout: string | null;
  /** Structured pins and package layout, used to draw the pinout diagram. */
  pins?: Pin[];
  layout?: Layout;
  source_url: string;
  extracted_at: string;
}

export interface PartInfo {
  name: string;
  category?: string | null;
  value?: string | null;
  package?: string | null;
  part_number?: string | null;
  manufacturer?: string | null;
  description?: string | null;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const LAYOUTS: Layout[] = ['dual', 'single', 'three-lead'];
const ROLES: PinRole[] = ['power', 'ground', 'input', 'output', 'io', 'nc', 'other'];

/**
 * Pins must be numbered 1..N with no gaps, and N must suit the layout, or no diagram can be drawn
 * faithfully. A wrong diagram is worse than none, so anything doubtful is dropped.
 */
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

/** The model's report is untrusted text: clamp sizes and drop anything malformed before storing it. */
export function sanitizeFacts(raw: unknown, sourceUrl: string, now = new Date()): FactSheet | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const specs = (Array.isArray(r.specs) ? r.specs : [])
    .map((s) => ({ name: clip((s as Record<string, unknown>)?.name, 60), value: clip((s as Record<string, unknown>)?.value, 120) }))
    .filter((s) => s.name && s.value)
    .slice(0, 20);
  const features = (Array.isArray(r.features) ? r.features : [])
    .map((f) => clip(f, 120))
    .filter(Boolean)
    .slice(0, 10);
  const summary = clip(r.summary, 400);
  const drawn = sanitizePins(r.pins, r.layout);
  if (!summary && specs.length === 0 && !drawn) return null;
  return {
    summary,
    specs,
    features,
    pinout: clip(r.pinout, 400) || null,
    ...(drawn ?? {}),
    source_url: sourceUrl,
    extracted_at: now.toISOString(),
  };
}

/** https only, no credentials, no odd ports, no IP literals or internal-looking hosts. */
export function checkUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost') return null;
  if (/\.(local|internal|localhost|lan|home)$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
  return u;
}

/** Every https URL the search/fetch tools returned, so a reported URL can be checked against real results. */
export function collectHosts(content: unknown[]): Set<string> {
  const hosts = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (k === 'url' && typeof val === 'string') {
          const u = checkUrl(val);
          if (u) hosts.add(u.hostname.toLowerCase());
        } else walk(val);
      }
    }
  };
  for (const block of content) {
    const t = (block as { type?: string })?.type ?? '';
    if (t.endsWith('_tool_result')) walk(block);
  }
  return hosts;
}

export type Download = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/** Fetch a PDF with redirect re-validation, a size cap and a magic-byte check. */
export async function downloadPdf(
  url: string,
  fetchImpl: typeof fetch = fetch,
  { maxBytes = 15 * 1024 * 1024, maxHops = 4, timeoutMs = 20000 } = {},
): Promise<Download> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = checkUrl(current);
    if (!u) return { ok: false, reason: 'URL not allowed' };
    let res: Response;
    try {
      res = await fetchImpl(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'PartsTracker/0.1 (personal inventory)', accept: 'application/pdf' },
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'fetch failed' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, reason: 'redirect without location' };
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok || !res.body) return { ok: false, reason: `HTTP ${res.status}` };
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) return { ok: false, reason: 'too large' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too large' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    const magic = new TextDecoder().decode(bytes.slice(0, 5));
    return magic === '%PDF-' ? { ok: true, bytes } : { ok: false, reason: 'not a PDF' };
  }
  return { ok: false, reason: 'too many redirects' };
}

export function buildPrompt(p: PartInfo): string {
  const lines = [
    ['Name', p.name],
    ['Manufacturer', p.manufacturer],
    ['Part number', p.part_number],
    ['Category', p.category],
    ['Value', p.value],
    ['Package', p.package],
    ['Description', p.description],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return `Find the official datasheet for this electronics part and extract a compact fact sheet.

${lines.join('\n')}

Steps:
1. Search for the manufacturer's datasheet (PDF or official product page). Prefer the manufacturer's own site over distributors or aggregators.
2. Fetch it and read only the parts you need: description, key electrical characteristics, absolute maximum ratings, package and pinout. Use filtering rather than reading every page.
3. Call report_datasheet once with what you found.

Rules:
- If the part is generic (e.g. a plain resistor or capacitor with only a value and no part number or maker) or you cannot identify it confidently, call report_datasheet with found=false. A wrong datasheet is worse than none.
- Only report a URL that appeared in your search or fetch results. Never construct one.
- Every spec must come from the document you read, with units. Do not fill gaps from memory. Set extracted=false if you could not read the document itself.
- Keep specs to the 8-15 that matter most for choosing and wiring the part (supply voltage, current, frequency, logic levels, operating temperature, dimensions, key ratings).
- Pins: if the datasheet has a pin table or diagram for this exact package, also report \`pins\` (number, name, role) and \`layout\`. Number pins as the datasheet does, from 1 with no gaps. Use layout "dual" for two-row packages (DIP, SOIC, SOP, TSSOP; pin 1 top-left, counting down the left side then up the right), "single" for one row of pins (SIP, module headers), "three-lead" for 3-pin transistor-style packages (TO-92, TO-220, SOT-223; front view, pin 1 on the left). For any other package (QFP, QFN, BGA, and so on), omit \`pins\` and \`layout\` and describe the pins in \`pinout\` instead. Never guess a pin.`;
}

export const REPORT_TOOL = {
  name: 'report_datasheet',
  description: 'Report the datasheet you found and the key facts extracted from it. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      url: { type: 'string', description: 'Direct URL of the datasheet PDF or official product page' },
      title: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'That this document is for exactly this part' },
      extracted: { type: 'boolean', description: 'True only if the facts below were read from the document itself' },
      summary: { type: 'string', description: 'One or two sentences on what the part is' },
      specs: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] },
      },
      features: { type: 'array', items: { type: 'string' } },
      pinout: { type: 'string', description: 'Brief pin list, e.g. "1 VCC, 2 GND, 3 OUT"' },
      layout: { type: 'string', enum: ['dual', 'single', 'three-lead'], description: 'Physical pin arrangement of this package' },
      pins: {
        type: 'array',
        description: 'Every pin of this package, numbered from 1 with no gaps',
        items: {
          type: 'object',
          properties: {
            number: { type: 'integer' },
            name: { type: 'string', description: 'As printed in the datasheet, e.g. VCC, GND, +INPUT, PB0' },
            role: { type: 'string', enum: ['power', 'ground', 'input', 'output', 'io', 'nc', 'other'] },
          },
          required: ['number', 'name', 'role'],
        },
      },
    },
    required: ['found'],
  },
};
