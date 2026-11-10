// Suggests project ideas from the parts the owner has in stock, and the printers they own. It saves nothing:
// the app stores the ideas and works out how much of each is in stock. JWT-authenticated; everything is read through RLS.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPrompt, IDEAS_TOOL, MAX_IDEAS, type StockItem, sanitizeIdeas, type ToolInfo } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const TOOLS = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }, IDEAS_TOOL];

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
    body: JSON.stringify({ model: MODEL, max_tokens: 24000, output_config: { effort: 'medium' }, tools: TOOLS, messages }),
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

    const body = (await req.json()) as { text?: unknown; count?: unknown };
    const wish = typeof body.text === 'string' ? body.text.trim().slice(0, 600) : '';
    const count = Math.min(MAX_IDEAS, Math.max(1, Math.round(Number(body.count)) || 8));

    const { data: stockRows, error } = await sb
      .from('items')
      .select('id,name,category,value,package,part_number,quantity')
      .gt('quantity', 0)
      .order('name')
      .limit(1500);
    if (error) throw error;
    const stock = (stockRows ?? []) as StockItem[];
    if (stock.length === 0) return json({ error: 'There is nothing in stock yet, so there is nothing to build from.' }, 422);

    const { data: toolRows, error: tErr } = await sb.from('tools').select('kind,name,notes').order('created_at');
    if (tErr) throw tErr;
    const tools = (toolRows ?? []) as ToolInfo[];

    // Don't repeat what they already have, whether still an idea or already a project.
    const [{ data: oldIdeas }, { data: projects }] = await Promise.all([
      sb.from('project_ideas').select('idea').order('created_at', { ascending: false }).limit(40),
      sb.from('projects').select('name').order('updated_at', { ascending: false }).limit(40),
    ]);
    const avoid = [
      ...(oldIdeas ?? []).map((r: { idea?: { title?: string } }) => r.idea?.title).filter((t): t is string => typeof t === 'string'),
      ...(projects ?? []).map((p: { name: string }) => p.name),
    ];

    // The web search runs server-side; pause_turn means the model needs another turn to finish.
    const messages: unknown[] = [{ role: 'user', content: buildPrompt(stock, tools, count, wish, avoid) }];
    let proposal: unknown = null;
    for (let turn = 0; turn < 4 && !proposal; turn++) {
      const out = await ask(messages);
      if (out.stop_reason === 'refusal') return json({ error: 'The model declined this request' }, 422);
      proposal = out.content.find((b) => b.type === 'tool_use' && b.name === 'propose_ideas')?.input ?? null;
      if (out.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: out.content });
    }

    const printers = tools.filter((t) => t.kind === '3d_printer').map((t) => t.name);
    const ideas = sanitizeIdeas(proposal, stock, printers, avoid);
    if (ideas.length === 0) return json({ error: 'No usable ideas came back. Try again, or say what you would like to make.' }, 422);
    return json({ ideas });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
