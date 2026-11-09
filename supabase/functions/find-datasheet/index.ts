// Finds a part's official datasheet and stores a parsed fact sheet on the item.
// Falls back to storing the PDF when no specs could be extracted. JWT-authenticated; RLS scopes everything.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPrompt, checkUrl, collectHosts, downloadPdf, type FactSheet, REPORT_TOOL, sanitizeFacts } from './facts.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 50000 },
  REPORT_TOOL,
];

type Block = { type: string; name?: string; input?: Record<string, unknown> };

async function ask(messages: unknown[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Model request failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<{ stop_reason: string; content: Block[] }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Missing Authorization header' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { item_id } = (await req.json()) as { item_id?: string };
    if (!item_id) return json({ error: 'item_id is required' }, 400);
    const { data: item, error } = await sb.from('items').select('*').eq('id', item_id).maybeSingle();
    if (error) throw error;
    if (!item) return json({ error: 'Item not found' }, 404);

    // Search + fetch run server-side; pause_turn means the model needs another turn to finish.
    const messages: unknown[] = [{ role: 'user', content: buildPrompt(item) }];
    const seenHosts = new Set<string>();
    let report: Record<string, unknown> | null = null;
    for (let turn = 0; turn < 5 && !report; turn++) {
      const out = await ask(messages);
      if (out.stop_reason === 'refusal') break;
      for (const h of collectHosts(out.content)) seenHosts.add(h);
      report = out.content.find((b) => b.type === 'tool_use' && b.name === 'report_datasheet')?.input ?? null;
      if (out.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: out.content });
    }

    const patch: Record<string, unknown> = { datasheet_checked_at: new Date().toISOString() };
    const url = typeof report?.url === 'string' ? checkUrl(report.url) : null;
    // Reject low confidence and any URL whose host never appeared in the tools' results (hallucination guard).
    const trusted =
      report?.found === true && url && report.confidence !== 'low' && (seenHosts.size === 0 || seenHosts.has(url.hostname.toLowerCase()));
    if (!trusted) {
      patch.datasheet_status = 'not_found';
      await sb.from('items').update(patch).eq('id', item_id);
      return json({ status: 'not_found' });
    }

    const facts: FactSheet | null = report!.extracted === false ? null : sanitizeFacts(report, url.toString());
    patch.datasheet_status = 'found';
    if (!item.datasheet_url) patch.datasheet_url = url.toString();

    let stored = 'link';
    if (facts) {
      patch.fact_sheet = facts;
      stored = 'facts';
    } else {
      // Fallback: no parsed specs, so attach the PDF itself if it can be downloaded safely.
      const dl = await downloadPdf(url.toString());
      if (dl.ok) {
        const path = `${user.id}/${item_id}.pdf`;
        const up = await sb.storage.from('datasheets').upload(path, dl.bytes, { contentType: 'application/pdf', upsert: true });
        if (!up.error) {
          patch.datasheet_path = path;
          stored = 'pdf';
        }
      }
    }
    const { error: upErr } = await sb.from('items').update(patch).eq('id', item_id);
    if (upErr) throw upErr;
    return json({ status: 'found', stored, source_url: url.toString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
