// Turns a photo and/or free text (typed or dictated) into proposed inventory changes.
// The browser never sees the Anthropic key; the user's JWT scopes the inventory lookup via RLS.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';

const tool = {
  name: 'propose_changes',
  description: 'Propose inventory changes for the electronics parts described by the user and/or shown in the photo.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['add', 'remove', 'set'],
              description: 'add = received/bought more, remove = used/lost/gave away, set = absolute count (e.g. "I have 40 left")',
            },
            item_id: {
              type: ['string', 'null'],
              description: 'id of the matching EXISTING item, or null to create a new item. Only match if clearly the same part.',
            },
            name: { type: 'string', description: 'Short human name, e.g. "10k resistor 0805" or "ATmega328P"' },
            quantity: { type: 'integer', minimum: 0, description: 'How many units. Use 1 if a single unit is shown and no count given.' },
            category: {
              type: ['string', 'null'],
              description: 'e.g. Resistor, Capacitor, IC, Microcontroller, Connector, Sensor, Module, Tool',
            },
            value: { type: ['string', 'null'], description: 'Electrical value, e.g. 10kΩ, 100nF, 3.3V' },
            package: { type: ['string', 'null'], description: 'e.g. 0805, DIP-8, TO-220, SOIC-16' },
            part_number: { type: ['string', 'null'] },
            manufacturer: { type: ['string', 'null'] },
            location: { type: ['string', 'null'], description: 'Bin/drawer/shelf if mentioned' },
            description: { type: ['string', 'null'] },
            note: { type: ['string', 'null'], description: 'Uncertainty or anything the user should double check' },
          },
          required: ['op', 'name', 'quantity'],
        },
      },
    },
    required: ['changes'],
  },
};

const SYSTEM = `You maintain a hobbyist electronics parts inventory.
Given a photo and/or a message, call propose_changes with one entry per distinct part.
Rules:
- Match an existing item (by item_id) only when it is clearly the same part (same value/package/part number). Otherwise create a new item with item_id null.
- Never invent part numbers, values or counts you cannot see or were not told. Leave fields null and put doubts in "note".
- From a photo: read markings, labels and bags. Count visible units only if countable; otherwise quantity 1 and say so in "note".
- Default op is "add" for photos and for phrases like "got", "bought", "received". Use "remove" for "used", "took", "gave". Use "set" for "I have N", "recount", "there are N".
- Prefer SI-style values with units (10kΩ, 4.7µF).`;

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

    const { text, image, mediaType } = (await req.json()) as { text?: string; image?: string; mediaType?: string };
    if (!text?.trim() && !image) return json({ error: 'Provide text and/or an image' }, 400);

    const { data: items, error } = await sb
      .from('items')
      .select('id,name,category,value,package,part_number,location,quantity')
      .limit(3000);
    if (error) throw error;

    const content: unknown[] = [];
    if (image) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType ?? 'image/jpeg', data: image } });
    }
    content.push({
      type: 'text',
      text: `Existing inventory (JSON):\n${JSON.stringify(items)}\n\nUser message: ${text?.trim() || '(photo only — add what you see)'}`,
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'propose_changes' },
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return json({ error: `Model request failed (${res.status})`, detail: await res.text() }, 502);
    const out = await res.json();
    const block = out.content?.find((b: { type: string }) => b.type === 'tool_use');

    // Drop any item_id the model hallucinated: it must exist in the user's inventory.
    const known = new Set((items ?? []).map((i) => i.id));
    const changes = (block?.input?.changes ?? []).map((c: { item_id?: string | null }) => ({
      ...c,
      item_id: c.item_id && known.has(c.item_id) ? c.item_id : null,
    }));
    return json({ changes });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
