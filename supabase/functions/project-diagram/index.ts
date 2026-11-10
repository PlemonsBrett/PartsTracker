// Writes a wiring diagram for one project from its parts, pinouts and notes. It saves nothing:
// the app stores the diagram on the project. JWT-authenticated; everything is read through RLS.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { assignRefs, buildPrompt, DIAGRAM_TOOL, type PartInfo, sanitizeDiagram } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const TOOLS = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }, DIAGRAM_TOOL];

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

type Item = {
  id: string;
  name: string;
  category: string | null;
  value: string | null;
  package: string | null;
  part_number: string | null;
  pinout: { pins?: { number: number; name: string }[] } | null;
  fact_sheet: { pins?: { number: number; name: string }[] } | null;
};

const pinNames = (it: Item | undefined): string[] | null => {
  const pins = it?.pinout?.pins ?? it?.fact_sheet?.pins;
  return pins?.length ? [...pins].sort((a, b) => a.number - b.number).map((p) => p.name) : null;
};

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

    const body = (await req.json()) as { project_id?: string; text?: unknown };
    if (!body.project_id) return json({ error: 'project_id is required' }, 400);
    const comment = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';

    const { data: project, error } = await sb.from('projects').select('id,name,description,notes').eq('id', body.project_id).maybeSingle();
    if (error) throw error;
    if (!project) return json({ error: 'Project not found' }, 404);
    const { data: rows, error: pErr } = await sb
      .from('project_parts')
      .select('id,item_id,name,quantity,role')
      .eq('project_id', project.id)
      .order('created_at');
    if (pErr) throw pErr;
    if (!rows?.length) return json({ error: 'Add some parts to the project first.' }, 422);

    const ids = rows.map((r) => r.item_id).filter(Boolean) as string[];
    const { data: itemRows, error: iErr } = ids.length
      ? await sb.from('items').select('id,name,category,value,package,part_number,pinout,fact_sheet').in('id', ids)
      : { data: [] as Item[], error: null };
    if (iErr) throw iErr;
    const items = new Map((itemRows as Item[]).map((i) => [i.id, i]));

    const base = rows.map((r) => {
      const it = r.item_id ? items.get(r.item_id) : undefined;
      return {
        name: it?.name ?? r.name,
        category: it?.category ?? null,
        value: it?.value ?? null,
        package: it?.package ?? null,
        part_number: it?.part_number ?? null,
        quantity: r.quantity,
        role: r.role,
        inInventory: Boolean(it),
        pins: pinNames(it),
      };
    });
    const parts: PartInfo[] = assignRefs(base);

    // The web search runs server-side; pause_turn means the model needs another turn to finish.
    const messages: unknown[] = [{ role: 'user', content: buildPrompt(project, parts, comment) }];
    let proposal: unknown = null;
    for (let turn = 0; turn < 4 && !proposal; turn++) {
      const out = await ask(messages);
      if (out.stop_reason === 'refusal') return json({ error: 'The model declined this request' }, 422);
      proposal = out.content.find((b) => b.type === 'tool_use' && b.name === 'propose_diagram')?.input ?? null;
      if (out.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: out.content });
    }

    const diagram = sanitizeDiagram(proposal, parts);
    if (!diagram) return json({ error: 'Could not draw a diagram from these parts. Try adding what the project does in its notes.' }, 422);
    // Tell the app which box is which part, so it can fill in "where it goes" for the owner's parts.
    return json({ diagram, refs: parts.map((p, i) => ({ ref: p.ref, part_id: rows[i].id })) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
