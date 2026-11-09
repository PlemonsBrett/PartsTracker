// Remote MCP server (Streamable HTTP, stateless JSON responses) for the parts inventory.
// Secrets: MCP_API_KEY (required), OWNER_USER_ID (required: the user whose inventory is exposed).
// Connect:  URL  https://<ref>.supabase.co/functions/v1/mcp   Header  Authorization: Bearer <MCP_API_KEY>
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Fields, handleMessage, type Item, type Store } from './core.ts';

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const reply = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeStore(): Store {
  const owner = Deno.env.get('OWNER_USER_ID')!;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t = () => sb.from('items');
  const check = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    list: async () => check(await t().select('*').eq('user_id', owner).order('name').limit(5000)) as Item[],
    get: async (id) => check(await t().select('*').eq('user_id', owner).eq('id', id).maybeSingle()) as Item | null,
    insert: async (f: Fields & { name: string }) =>
      check(
        await t()
          .insert({ ...f, user_id: owner })
          .select()
          .single(),
      ) as Item,
    update: async (id, patch) => check(await t().update(patch).eq('user_id', owner).eq('id', id).select().single()) as Item,
    remove: async (id) => {
      check(await t().delete().eq('user_id', owner).eq('id', id));
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST JSON-RPC to this endpoint', { status: 405, headers: { Allow: 'POST' } });

  const key = Deno.env.get('MCP_API_KEY');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const given = bearer ?? req.headers.get('x-api-key') ?? '';
  if (!key || !Deno.env.get('OWNER_USER_ID') || !safeEqual(given, key)) return new Response('Unauthorized', { status: 401 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const store = makeStore();
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handleMessage(m, store)))).filter(Boolean);
    return out.length ? reply(out) : reply(null, 202);
  }
  const res = await handleMessage(payload as never, store);
  return res ? reply(res) : reply(null, 202);
});
