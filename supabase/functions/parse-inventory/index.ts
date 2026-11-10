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
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'How sure you are of what this part is and its key details. low = could not tell what it is.',
            },
            unknowns: {
              type: 'array',
              items: { type: 'string' },
              description:
                'What you could not determine and that matters, e.g. "exact part number", "pin order", "voltage rating", "what it does"',
            },
          },
          required: ['op', 'name', 'quantity'],
        },
      },
    },
    required: ['changes'],
  },
};

const SYSTEM = `You maintain a hobbyist electronics parts inventory.
Given a photo and/or a message, always respond by calling propose_changes once, with one entry per distinct part (an empty list if nothing is identifiable).
Rules:
- Match an existing item (by item_id) only when it is clearly the same part (same value/package/part number). Otherwise create a new item with item_id null.
- Never invent part numbers, values or counts you cannot see or were not told. Leave fields null and put doubts in "note".
- From a photo: read markings, labels and bags. Count visible units only if countable; otherwise quantity 1 and say so in "note".
- Default op is "add" for photos and for phrases like "got", "bought", "received". Use "remove" for "used", "took", "gave". Use "set" for "I have N", "recount", "there are N".
- Prefer SI-style values with units (10kΩ, 4.7µF).
- Record what you are told. If a dictated value is unusual or looks like a mis-hearing, keep the value as said and put the doubt in "note": never swap it for a different standard value. Dictation often garbles digits ("23.3k" for 3.3k); a number the owner reads out twice is usually a restart, not two parts.
- Ceramic capacitors and many SMD parts carry a 3-digit code: the first two digits are the value in pF and the third is the number of zeros (100 = 10pF, 221 = 220pF, 104 = 100nF). A code spoken after a value is that marking; put it in "description" as "Marking 104". Do not treat it as a quantity.
- If the message has a "Shared details" line, those facts are true of EVERY part in the message. Apply them to each part (package, description and so on) and never list them under "unknowns".
- Say how sure you are. "confidence" is "high" when you can read the part number or are certain what it is, "medium" when you are fairly sure but key details are missing, "low" when you cannot tell what it is. List what you could not determine in "unknowns" (short phrases). If you list nothing important, confidence is "high". The owner can test unknown parts, so being honest about gaps is more useful than guessing.`;

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

    const { text, image, mediaType, shared } = (await req.json()) as { text?: string; image?: string; mediaType?: string; shared?: string };
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
      text: `Existing inventory (JSON):\n${JSON.stringify(items)}\n\n${shared?.trim() ? `Shared details (true of every part below): ${shared.trim().slice(0, 500)}\n\n` : ''}User message: ${text?.trim() || '(photo only — add what you see)'}`,
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
        // Sonnet 5.5 rejects forced tool_choice (400) and thinks by default: ask for the tool in the prompt and keep effort modest.
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [tool],
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return json({ error: `Model request failed (${res.status})`, detail: await res.text() }, 502);
    const out = await res.json();
    const block = out.content?.find((b: { type: string }) => b.type === 'tool_use');

    // Drop any item_id the model hallucinated: it must exist in the user's inventory.
    const known = new Set((items ?? []).map((i) => i.id));
    const changes = (block?.input?.changes ?? []).map((c: { item_id?: string | null; confidence?: unknown; unknowns?: unknown }) => ({
      ...c,
      item_id: c.item_id && known.has(c.item_id) ? c.item_id : null,
      confidence: c.confidence === 'low' || c.confidence === 'medium' ? c.confidence : 'high',
      unknowns: (Array.isArray(c.unknowns) ? c.unknowns : [])
        .filter((u): u is string => typeof u === 'string')
        .map((u) => u.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 6),
    }));
    return json({ changes });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
