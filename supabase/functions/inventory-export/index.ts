// Agent-friendly read-only export.
//   GET <fn-url>?format=json|csv|md&q=resistor&in_stock=1&low=1
//   Header:  x-api-key: <EXPORT_API_KEY>      (or ?key=...)
// Secrets: EXPORT_API_KEY (required), OWNER_USER_ID (recommended: limits export to your rows).
import { createClient } from 'npm:@supabase/supabase-js@2';

type Row = Record<string, string | number | null>;
const COLS = [
  'name',
  'quantity',
  'min_quantity',
  'category',
  'value',
  'package',
  'part_number',
  'manufacturer',
  'location',
  'description',
  'datasheet_url',
  'notes',
  'updated_at',
];

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows: Row[]) => [COLS.join(','), ...rows.map((r) => COLS.map((c) => esc(r[c])).join(','))].join('\n');
const cell = (v: unknown) =>
  String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const toMD = (rows: Row[]) => {
  const cols = ['name', 'quantity', 'category', 'value', 'package', 'part_number', 'location'];
  return [
    `# Electronics inventory (${rows.length} items)`,
    '',
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`),
  ].join('\n');
};

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const expected = Deno.env.get('EXPORT_API_KEY');
  const given = req.headers.get('x-api-key') ?? url.searchParams.get('key') ?? '';
  if (!expected || !safeEqual(given, expected)) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let query = sb.from('items').select(COLS.join(',')).order('category').order('name');
  const owner = Deno.env.get('OWNER_USER_ID');
  if (owner) query = query.eq('user_id', owner);
  const { data, error } = await query;
  if (error) return new Response(error.message, { status: 500 });

  let rows = (data ?? []) as unknown as Row[];
  const q = url.searchParams.get('q')?.toLowerCase().split(/\s+/).filter(Boolean);
  if (q?.length)
    rows = rows.filter((r) => {
      const h = JSON.stringify(r).toLowerCase();
      return q.every((t) => h.includes(t));
    });
  if (url.searchParams.get('in_stock')) rows = rows.filter((r) => Number(r.quantity) > 0);
  if (url.searchParams.get('low')) rows = rows.filter((r) => Number(r.quantity) <= Number(r.min_quantity));

  const fmt = url.searchParams.get('format') ?? 'json';
  if (fmt === 'csv') return new Response(toCSV(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  if (fmt === 'md') return new Response(toMD(rows), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), count: rows.length, items: rows }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
