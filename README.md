# PartsTracker

Personal electronics inventory. Search it, tap +/− to change quantities, and add or update parts by **photo, typing, or voice dictation**. Export the list for AI agents.

- **Frontend**: React 19 + Vite, static, hosted on **GitHub Pages**
- **Backend**: **Supabase** (Postgres + RLS, auth, two edge functions)
- **AI**: `parse-inventory` edge function sends photo/text to Claude and returns _proposed_ changes. You review them before anything is saved. The Anthropic key never reaches the browser.
- **Voice**: browser Web Speech API (Chrome, Edge, Safari). The transcript goes through the same parser.

Cloudflare/Railway aren't needed. You could put Cloudflare in front of Pages later.

## Setup

1. **Supabase**: create a project, then

   ```sh
   npx supabase login && npx supabase link --project-ref <ref>
   npx supabase db push                                   # creates tables + RLS
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... EXPORT_API_KEY=$(openssl rand -hex 24) MCP_API_KEY=$(openssl rand -hex 24)
   npx supabase functions deploy parse-inventory inventory-export mcp find-datasheet
   ```

   Create your account via the app, then **turn off "Allow new users to sign up"** (Auth → Providers → Email) so it stays single-user. Then `npx supabase secrets set OWNER_USER_ID=<your auth uid>` (Auth → Users). The MCP server requires it; the export endpoint uses it to limit results to your rows.
2. **GitHub Pages**: repo Settings → Pages → Source: _GitHub Actions_. The workflow already embeds the public Supabase URL and publishable key (override with Actions variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` if you move projects). Push to `main` to deploy.
3. **Local dev**: `cp .env.example .env.local`, fill in, `npm install && npm run dev`.

## Using it

- **✨ Capture**: 📷 photo of a bag/part/label, 🎤 dictate, or type (“used 4 ATmega328P”, “bought 50 10k 0805, bin A3”). Review the proposed changes, then Apply.
- **Search**: all terms must match across name, value, package, part number, location, etc. (`10k 0805`). Category chips and a Low-stock filter sit below.
- **Quantities**: − / + buttons, tap the number to type an exact count, or swipe a row (right = +1, left = −1). A toast offers **Undo** for a few seconds. Every change is logged in `inventory_events`.
- **Capture notes**: if the analysis flags something (unreadable marking, a guess), that note is saved in the part's Notes. An existing part keeps its notes and the new one is added below.
- **Pinout diagrams**: a part's datasheet panel draws its pinout (pin 1 marked, pins coloured by role) when the lookup found a numbered pin table for a dual-row, single-row or 3-lead package. Parts looked up before this feature are drawn from their saved text pinout when the package is clear; "Look up again" refreshes them. Anything else keeps the plain text list.
- **Dictation in any browser**: Chrome, Edge and Safari use the browser's own speech recognition (live words). Firefox has none, so there the app records from the microphone and turns it into text with a small speech model running in the browser (`whisper-base.en`, about 76 MB, downloaded once and kept by the browser; nothing is sent to a server). You can keep talking while it downloads on first use. Words appear a few seconds after you press Stop, and it is somewhat less accurate than Chrome's, so skim the text before pressing Analyze. The model weights come from the Hugging Face hub; the runtime ships with the site.
- **Desktop mode** (automatic on a wide screen with a mouse): the parts list becomes a table (part, part number, value and package, location, quantity), Capture and Add move into the header, and dialogs open as a panel on the right so the list stays visible. Capture puts the cursor in the text box with Dictate first, and "Start dictating when this opens" is available. Phones and touch tablets keep the phone layout.
- **Keyboard shortcuts**: `/` search, `J`/`K` or arrows to move through parts, `Enter` open, `+`/`-` change the quantity, `C` capture, `N` add, `?` the full list, `Ctrl`+`Enter` to Analyze and then Apply in the capture dialog. Single keys only work when you are not typing in a box.
- **Hand-entered pinouts**: in a part's edit screen, "Add a pinout by hand" takes one pin per line (pin 1 first) and draws it as you type. Useful for breakout boards and modules with no datasheet pin table. Saved on the part, apart from the datasheet.
- **Update from photos & notes**: in a part's edit screen, add up to 4 more photos and any comments (what you measured, what's printed on it). Claude proposes changes to the part's fields, a note to add, and possibly a pinout; you tick what to keep. Nothing is saved until you press Apply, and existing notes are never replaced.
- **My tools** (🧰 in the header): record your test equipment with make, model and specs, for example a multimeter, an oscilloscope and a bench supply with its ratings. New accounts are asked once; "Not now" is remembered.
- **Investigate**: when capture can't tell what a part is, or some of its details, it says what it doesn't know (shown on the review screen). The part is saved with a 🔎 investigate tag and "Unsure at capture: …" in its notes. Open it to get a short test plan written for your tools: unpowered checks first, then powered ones with limits for your supply. Every step has its own **notes box** (with a microphone for dictating a reading); ticks and notes are saved as you type, even if you close the dialog straight away. "Save to the part's notes" adds them all to the part, and "Record results" opens "Update from photos & notes" with them already written out. Generating a new plan first saves your notes to the part, so nothing is lost. Any saved part has "How do I test this?" in its edit screen. A plan that uses a bench supply always carries a current-limit warning.
- **📷 camera button**: next to Capture; opens the camera and analyses the photo straight away, then shows the same review screen.
- **Install on your phone**: iPhone: Share → Add to Home Screen. Android/Chrome: menu → Install app. It opens full-screen; there is no offline mode.

## Datasheets

Each part can have a **fact sheet**: a short summary plus the key specs (supply voltage, current, package, pinout, ratings…) parsed from its datasheet, so you or an agent don't have to read the whole PDF.

- After ✨ Capture creates parts that have a part number, PartsTracker looks them up in the background. The 📄 **Find datasheets** chip does the same for existing parts (10 at a time), and each part has Find / Look up again / Remove.
- `find-datasheet` uses Claude with web search + web fetch to locate the manufacturer's datasheet and extract the specs. A lookup is rejected if the confidence is low or the reported URL's host never appeared in the search results. Generic parts (a plain 10k resistor) are skipped.
- Only if specs can't be extracted is the PDF itself downloaded (https only, size-capped, private `datasheets` bucket) and attached.
- The source link is always kept. Verify critical values against it.
- Each lookup is a web-search request, so it costs more than a capture. It needs web search enabled for your Anthropic organization (Console → Settings → Privacy).

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

| Tool               | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `search_items`     | query + category / in-stock / low-stock filters              |
| `get_item`         | all fields for one item                                      |
| `list_low_stock`   | items at or below their threshold                            |
| `add_item`         | create a part (agents are told to search first)              |
| `adjust_quantity`  | relative change (+received / −used); refuses to go below 0   |
| `set_quantity`     | absolute recount                                             |
| `update_item`      | edit name, location, value, notes, threshold… (not quantity) |
| `delete_item`      | requires `confirm: true`                                     |
| `export_inventory` | md / json / csv                                              |

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

- `npm run lint`: Biome lint + format check (`npm run fix` applies fixes). Style: single quotes, semicolons, trailing commas.
- `npm run typecheck`, `npm test`, `npm run build`
- Edge functions: `deno check supabase/functions/*/index.ts`
- CI (`.github/workflows/ci.yml`) runs all of the above on every pull request. Deploys happen only from `main`.
- The MCP logic lives in `supabase/functions/mcp/core.ts` with no Deno dependencies, so it is unit-tested under vitest.

Planned features are tracked in [ROADMAP.md](ROADMAP.md).
