// Writes a test plan for one saved part, using the owner's own test equipment. It saves nothing:
// the app stores the plan on the part. JWT-authenticated; the part and tools are read through RLS.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPrompt, PLAN_TOOL, sanitizePlan, type ToolInfo } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const TOOLS = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }, PLAN_TOOL];

type Block = { type: string; name?: string; input?: unknown };

async function ask(messages: unknown[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    // Sonnet 5.5 rejects forced tool_choice, so the prompt asks for the tool.
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, output_config: { effort: 'medium' }, tools: TOOLS, messages }),
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

    const body = (await req.json()) as { item_id?: string; unknowns?: unknown; text?: unknown };
    if (!body.item_id) return json({ error: 'item_id is required' }, 400);
    const unknowns = (Array.isArray(body.unknowns) ? body.unknowns : [])
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 8);
    const context = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';

    const { data: item, error } = await sb.from('items').select('*').eq('id', body.item_id).maybeSingle();
    if (error) throw error;
    if (!item) return json({ error: 'Item not found' }, 404);
    const { data: toolRows, error: toolErr } = await sb.from('tools').select('kind,name,notes').order('created_at');
    if (toolErr) throw toolErr;
    const tools = (toolRows ?? []) as ToolInfo[];

    // The web search runs server-side; pause_turn means the model needs another turn to finish.
    const messages: unknown[] = [{ role: 'user', content: buildPrompt(item, tools, unknowns, context) }];
    let proposal: unknown = null;
    for (let turn = 0; turn < 4 && !proposal; turn++) {
      const out = await ask(messages);
      if (out.stop_reason === 'refusal') return json({ error: 'The model declined this request' }, 422);
      proposal = out.content.find((b) => b.type === 'tool_use' && b.name === 'propose_plan')?.input ?? null;
      if (out.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: out.content });
    }

    const plan = sanitizePlan(proposal, tools);
    if (!plan) return json({ error: 'Could not make a test plan for this part. Try adding details in the comment.' }, 422);
    return json({ plan, tools_used: tools.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
