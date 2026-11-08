// Pure MCP (JSON-RPC 2.0) logic: no Deno or network imports, so it is unit-testable with vitest.

export interface Item {
  id: string; name: string; quantity: number; min_quantity: number
  category: string | null; value: string | null; package: string | null; part_number: string | null
  manufacturer: string | null; location: string | null; description: string | null
  datasheet_url: string | null; notes: string | null; updated_at: string
}
export type Fields = Partial<Omit<Item, 'id' | 'updated_at'>>

/** Storage abstraction; index.ts backs it with Supabase, tests with an array. */
export interface Store {
  list(): Promise<Item[]>
  get(id: string): Promise<Item | null>
  insert(fields: Fields & { name: string }): Promise<Item>
  update(id: string, patch: Fields): Promise<Item>
  remove(id: string): Promise<void>
}

const normalize = (s: string) =>
  s.toLowerCase().replace(/[ωΩ]|\bohms?\b/gi, '').replace(/[µμ]/g, 'u').replace(/\s+/g, ' ').trim()
const hay = (i: Item) => normalize([i.name, i.category, i.value, i.package, i.part_number, i.manufacturer, i.location, i.description, i.notes].filter(Boolean).join(' '))
export const search = (items: Item[], q?: string) => {
  const terms = normalize(q ?? '').split(' ').filter(Boolean)
  return terms.length ? items.filter((i) => { const h = hay(i); return terms.every((t) => h.includes(t)) }) : items
}

const FIELD_PROPS = {
  category: { type: 'string', description: 'e.g. Resistor, Capacitor, IC, Microcontroller, Connector, Sensor, Module' },
  value: { type: 'string', description: 'Electrical value, e.g. 10kΩ, 100nF, 3.3V' },
  package: { type: 'string', description: 'e.g. 0805, DIP-8, TO-220' },
  part_number: { type: 'string' }, manufacturer: { type: 'string' },
  location: { type: 'string', description: 'Bin / drawer / shelf' },
  description: { type: 'string' }, datasheet_url: { type: 'string' }, notes: { type: 'string' },
  min_quantity: { type: 'integer', minimum: 0, description: 'Low-stock threshold' },
} as const
const FIELD_KEYS = Object.keys(FIELD_PROPS) as (keyof typeof FIELD_PROPS)[]
const id = { type: 'string', description: 'Item id from search_items' }
const int = (description: string, extra = {}) => ({ type: 'integer', description, ...extra })

interface Tool {
  name: string; description: string; inputSchema: object
  annotations?: Record<string, boolean>
  run(args: Record<string, unknown>, store: Store): Promise<unknown>
}

class ToolError extends Error {}

async function need(store: Store, args: Record<string, unknown>) {
  const item = typeof args.id === 'string' ? await store.get(args.id) : null
  if (!item) throw new ToolError(`No item with id ${String(args.id)}. Use search_items to find ids.`)
  return item
}
const pickFields = (args: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const k of FIELD_KEYS) if (args[k] !== undefined) out[k] = args[k]
  return out as Fields
}
const summary = (i: Item) => ({ id: i.id, name: i.name, quantity: i.quantity, category: i.category, value: i.value, package: i.package, part_number: i.part_number, location: i.location, min_quantity: i.min_quantity })
const isLow = (i: Item) => i.min_quantity > 0 && i.quantity <= i.min_quantity

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const mdCell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function exportItems(items: Item[], format: string) {
  if (format === 'csv') {
    const cols = ['name', 'quantity', 'min_quantity', 'category', 'value', 'package', 'part_number', 'manufacturer', 'location', 'description', 'datasheet_url', 'notes'] as const
    return [cols.join(','), ...items.map((i) => cols.map((c) => csvCell(i[c])).join(','))].join('\n')
  }
  if (format === 'md') {
    const cols = ['name', 'quantity', 'category', 'value', 'package', 'part_number', 'location'] as const
    return [`# Electronics inventory (${items.length} items)`, '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
      ...items.map((i) => `| ${cols.map((c) => mdCell(i[c])).join(' | ')} |`)].join('\n')
  }
  return JSON.stringify({ count: items.length, items }, null, 2)
}

export const TOOLS: Tool[] = [
  {
    name: 'search_items',
    description: 'Search the electronics parts inventory. All words in `query` must match somewhere (name, value, package, part number, location, notes). "10k" matches "10kΩ". Call this before add_item to avoid duplicates.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string' }, category: { type: 'string' },
      in_stock_only: { type: 'boolean' }, low_stock_only: { type: 'boolean' },
      limit: int('Max results (default 50, max 500)', { minimum: 1, maximum: 500 }),
    } },
    annotations: { readOnlyHint: true },
    async run(a, store) {
      let r = search(await store.list(), a.query as string | undefined)
      if (a.category) r = r.filter((i) => i.category?.toLowerCase() === String(a.category).toLowerCase())
      if (a.in_stock_only) r = r.filter((i) => i.quantity > 0)
      if (a.low_stock_only) r = r.filter(isLow)
      const limit = Math.min(Number(a.limit) || 50, 500)
      return { total_matches: r.length, items: r.slice(0, limit).map(summary) }
    },
  },
  {
    name: 'get_item', description: 'Get every field of one inventory item.',
    inputSchema: { type: 'object', properties: { id }, required: ['id'] }, annotations: { readOnlyHint: true },
    run: (a, store) => need(store, a),
  },
  {
    name: 'list_low_stock', description: 'Items at or below their low-stock threshold (min_quantity > 0), plus items with zero stock that have a threshold.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
    async run(_a, store) { const r = (await store.list()).filter(isLow); return { count: r.length, items: r.map(summary) } },
  },
  {
    name: 'add_item', description: 'Create a new part. Search first: if the part exists, use adjust_quantity instead.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, quantity: int('Initial count (default 0)', { minimum: 0 }), ...FIELD_PROPS }, required: ['name'] },
    async run(a, store) {
      if (typeof a.name !== 'string' || !a.name.trim()) throw new ToolError('name is required')
      const qty = a.quantity === undefined ? 0 : Number(a.quantity)
      if (!Number.isInteger(qty) || qty < 0) throw new ToolError('quantity must be a non-negative integer')
      return store.insert({ name: a.name.trim(), quantity: qty, ...pickFields(a) })
    },
  },
  {
    name: 'adjust_quantity', description: 'Add or remove stock by a relative amount: positive delta = received/bought, negative = used. Fails rather than going below zero.',
    inputSchema: { type: 'object', properties: { id, delta: int('Amount to add (negative to remove)') }, required: ['id', 'delta'] },
    async run(a, store) {
      const item = await need(store, a)
      const delta = Number(a.delta)
      if (!Number.isInteger(delta)) throw new ToolError('delta must be an integer')
      if (item.quantity + delta < 0) throw new ToolError(`Only ${item.quantity} of "${item.name}" in stock; cannot remove ${-delta}.`)
      const updated = await store.update(item.id, { quantity: item.quantity + delta })
      return { previous_quantity: item.quantity, ...summary(updated) }
    },
  },
  {
    name: 'set_quantity', description: 'Set an absolute count (e.g. after a recount).',
    inputSchema: { type: 'object', properties: { id, quantity: int('New count', { minimum: 0 }) }, required: ['id', 'quantity'] },
    async run(a, store) {
      const item = await need(store, a)
      const q = Number(a.quantity)
      if (!Number.isInteger(q) || q < 0) throw new ToolError('quantity must be a non-negative integer')
      const updated = await store.update(item.id, { quantity: q })
      return { previous_quantity: item.quantity, ...summary(updated) }
    },
  },
  {
    name: 'update_item', description: 'Edit descriptive fields (name, location, value, notes, low-stock threshold…). Does not change quantity; use adjust_quantity or set_quantity.',
    inputSchema: { type: 'object', properties: { id, name: { type: 'string' }, ...FIELD_PROPS }, required: ['id'] },
    async run(a, store) {
      const item = await need(store, a)
      const patch: Fields = pickFields(a)
      if (typeof a.name === 'string' && a.name.trim()) patch.name = a.name.trim()
      if (!Object.keys(patch).length) throw new ToolError('No fields to update')
      return store.update(item.id, patch)
    },
  },
  {
    name: 'delete_item', description: 'Permanently delete a part and its history. Only use when the user clearly asked; to record running out, set quantity to 0 instead.',
    inputSchema: { type: 'object', properties: { id, confirm: { type: 'boolean', description: 'Must be true' } }, required: ['id', 'confirm'] },
    annotations: { destructiveHint: true },
    async run(a, store) {
      const item = await need(store, a)
      if (a.confirm !== true) throw new ToolError('Set confirm: true to delete.')
      await store.remove(item.id)
      return { deleted: summary(item) }
    },
  },
  {
    name: 'export_inventory', description: 'Whole inventory (optionally filtered by `query`) as md (compact table, best for prompts), json (all fields) or csv.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['md', 'json', 'csv'] }, query: { type: 'string' }, in_stock_only: { type: 'boolean' } } },
    annotations: { readOnlyHint: true },
    async run(a, store) {
      let r = search(await store.list(), a.query as string | undefined)
      if (a.in_stock_only) r = r.filter((i) => i.quantity > 0)
      return { __text: exportItems(r, String(a.format ?? 'md')) }
    },
  },
]

// ---- JSON-RPC ----------------------------------------------------------------------------
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const ok = (id: Msg['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: Msg['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Returns the JSON-RPC response, or null for notifications (HTTP 202, no body). */
export async function handleMessage(msg: Msg, store: Store): Promise<object | null> {
  if (msg.id === undefined) return null // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return ok(msg.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'partstracker', version: '0.1.0' },
        instructions: 'Electronics parts inventory. Search before adding. Prefer adjust_quantity for "used/bought N", set_quantity for recounts.',
      })
    }
    case 'ping': return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS.map(({ run: _r, ...t }) => t) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name)
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${String(msg.params?.name)}`)
      try {
        const out = await tool.run((msg.params?.arguments ?? {}) as Record<string, unknown>, store) as { __text?: string }
        const text = out && typeof out === 'object' && '__text' in out ? out.__text! : JSON.stringify(out, null, 2)
        return ok(msg.id, { content: [{ type: 'text', text }] })
      } catch (e) {
        // Tool failures are reported in-band so the model can read and recover from them.
        return ok(msg.id, { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] })
      }
    }
    default: return fail(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}
