// Proposes updates to one saved part from new photos and comments. It writes nothing: the app shows the
// proposal and the user accepts changes one by one. JWT-authenticated; the part is read through RLS.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildPrompt, cleanRefinement, REFINE_TOOL } from './logic.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 3_500_000; // base64 characters, about 2.6 MB each

type Image = { data: string; mediaType: string };

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

    const body = (await req.json()) as { item_id?: string; text?: string; images?: Image[] };
    const comments = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    const images = Array.isArray(body.images) ? body.images : [];
    if (!body.item_id) return json({ error: 'item_id is required' }, 400);
    if (!comments && images.length === 0) return json({ error: 'Add a photo or a comment' }, 400);
    if (images.length > MAX_IMAGES) return json({ error: `At most ${MAX_IMAGES} photos` }, 400);
    for (const img of images) {
      if (typeof img?.data !== 'string' || !MEDIA_TYPES.includes(img.mediaType) || img.data.length > MAX_IMAGE_CHARS) {
        return json({ error: 'A photo was not usable (type or size)' }, 400);
      }
    }

    const { data: item, error } = await sb.from('items').select('*').eq('id', body.item_id).maybeSingle();
    if (error) throw error;
    if (!item) return json({ error: 'Item not found' }, 404);

    const content: unknown[] = images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } }));
    content.push({ type: 'text', text: buildPrompt(item, comments, images.length) });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      // Sonnet 5.5 rejects forced tool_choice, so the prompt asks for the tool.
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        tools: [REFINE_TOOL],
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return json({ error: `Model request failed (${res.status})`, detail: await res.text() }, 502);
    const out = (await res.json()) as { stop_reason: string; content: { type: string; name?: string; input?: unknown }[] };
    if (out.stop_reason === 'refusal') return json({ error: 'The model declined this request' }, 422);

    const proposal = out.content.find((b) => b.type === 'tool_use' && b.name === 'propose_update')?.input;
    return json(cleanRefinement(proposal, item));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
