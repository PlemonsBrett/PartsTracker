import type { Item } from './types'

const COLS = ['name', 'quantity', 'min_quantity', 'category', 'value', 'package', 'part_number', 'manufacturer', 'location', 'description', 'datasheet_url', 'notes'] as const

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCSV = (items: Item[]) =>
  [COLS.join(','), ...items.map((i) => COLS.map((c) => csvCell(i[c])).join(','))].join('\n')

export const toJSON = (items: Item[]) =>
  JSON.stringify({ generated_at: new Date().toISOString(), count: items.length, items: items.map((i) => Object.fromEntries(COLS.map((c) => [c, i[c]]))) }, null, 2)

const mdCell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function toMarkdown(items: Item[]) {
  const cols = ['name', 'quantity', 'category', 'value', 'package', 'part_number', 'location'] as const
  return [
    `# Electronics inventory (${items.length} items)`, '',
    `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...items.map((i) => `| ${cols.map((c) => mdCell(i[c])).join(' | ')} |`),
  ].join('\n')
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
