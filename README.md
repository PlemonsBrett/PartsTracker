# PartsTracker

Personal electronics inventory. Search it, tap +/− to change quantities, and add or update parts by **photo, typing, or voice dictation**. Export the list for AI agents.

- **Frontend**: React + Vite, static, hosted on **GitHub Pages**
- **Backend**: **Supabase** (Postgres + RLS, auth, two edge functions)
- **AI**: `parse-inventory` edge function sends photo/text to Claude and returns *proposed* changes. You review them before anything is saved. The Anthropic key never reaches the browser.
- **Voice**: browser Web Speech API (Chrome, Edge, Safari). The transcript goes through the same parser.

Cloudflare/Railway aren't needed. You could put Cloudflare in front of Pages later.

## Setup

1. **Supabase**: create a project, then
   ```sh
   npx supabase login && npx supabase link --project-ref <ref>
   npx supabase db push                                   # creates tables + RLS
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... EXPORT_API_KEY=$(openssl rand -hex 24) MCP_API_KEY=$(openssl rand -hex 24)
   npx supabase functions deploy parse-inventory inventory-export mcp
   ```
   Create your account via the app, then **turn off "Allow new users to sign up"** (Auth → Providers → Email) so it stays single-user. Then `npx supabase secrets set OWNER_USER_ID=<your auth uid>` (Auth → Users). The MCP server requires it; the export endpoint uses it to limit results to your rows.
2. **GitHub Pages**: repo Settings → Pages → Source: *GitHub Actions*. The workflow already embeds the public Supabase URL and publishable key (override with Actions variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` if you move projects). Push to `main` to deploy.
3. **Local dev**: `cp .env.example .env.local`, fill in, `npm install && npm run dev`.

## Using it

- **✨ Capture**: 📷 photo of a bag/part/label, 🎤 dictate, or type (“used 4 ATmega328P”, “bought 50 10k 0805, bin A3”). Review the proposed changes, then Apply.
- **Search**: all terms must match across name, value, package, part number, location, etc. (`10k 0805`). Category chips and a Low-stock filter sit below.
- **Quantities**: − / + buttons, or tap the number to type an exact count. Every change is logged in `inventory_events`.

## Export for agents

- In-app **⬇ Export** copies/downloads the current (filtered) view as Markdown, JSON or CSV.
- Live endpoint agents can call:
  ```sh
  curl -H "x-api-key: $EXPORT_API_KEY" \
    "https://<ref>.supabase.co/functions/v1/inventory-export?format=md&q=resistor&in_stock=1"
  ```
  `format=json|csv|md`, `q=` search terms, `in_stock=1`, `low=1`.

## MCP server (agent API)

`mcp` is a remote [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, stateless) so agents can read and edit the inventory directly.

- URL: `https://<ref>.supabase.co/functions/v1/mcp`
- Auth: `Authorization: Bearer <MCP_API_KEY>` (or `x-api-key`). Treat this key like a password: it can edit and delete.

| Tool | Purpose |
|---|---|
| `search_items` | query + category / in-stock / low-stock filters |
| `get_item` | all fields for one item |
| `list_low_stock` | items at or below their threshold |
| `add_item` | create a part (agents are told to search first) |
| `adjust_quantity` | relative change (+received / −used); refuses to go below 0 |
| `set_quantity` | absolute recount |
| `update_item` | edit name, location, value, notes, threshold… (not quantity) |
| `delete_item` | requires `confirm: true` |
| `export_inventory` | md / json / csv |

Connect it:
```sh
claude mcp add --transport http partstracker https://<ref>.supabase.co/functions/v1/mcp \
  --header "Authorization: Bearer $MCP_API_KEY"
```
Or in any client's JSON config: `{"mcpServers":{"partstracker":{"type":"http","url":"https://<ref>.supabase.co/functions/v1/mcp","headers":{"Authorization":"Bearer <MCP_API_KEY>"}}}}`.

Quick check without a client:
```sh
curl -s https://<ref>.supabase.co/functions/v1/mcp -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Dev

`npm test` (search, export, quantity logic, MCP protocol and tools; the MCP logic lives in `supabase/functions/mcp/core.ts` with no Deno dependencies so it runs under vitest) · `npm run build`
