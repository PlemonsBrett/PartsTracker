import { useState } from 'react'
import type { Item, ItemInput } from '../lib/types'

const FIELDS: [keyof ItemInput, string][] = [
  ['category', 'Category'], ['value', 'Value (10kΩ, 100nF…)'], ['package', 'Package (0805, DIP-8…)'],
  ['part_number', 'Part number'], ['manufacturer', 'Manufacturer'], ['location', 'Location (bin / drawer)'],
  ['datasheet_url', 'Datasheet URL'], ['description', 'Description'], ['notes', 'Notes'],
]

interface Props {
  item?: Item
  onSave: (input: ItemInput) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

export default function ItemForm({ item, onSave, onDelete, onClose }: Props) {
  const [v, setV] = useState<Record<string, string>>(() => ({
    name: item?.name ?? '', quantity: String(item?.quantity ?? 1), min_quantity: String(item?.min_quantity ?? 0),
    ...Object.fromEntries(FIELDS.map(([k]) => [k, (item?.[k as keyof Item] as string | null) ?? ''])),
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const input: ItemInput = { name: v.name.trim(), quantity: Math.max(0, parseInt(v.quantity, 10) || 0), min_quantity: Math.max(0, parseInt(v.min_quantity, 10) || 0) }
      for (const [k] of FIELDS) (input as Record<string, unknown>)[k] = v[k].trim() || null
      await onSave(input)
      onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  return (
    <div className="modal" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{item ? 'Edit part' : 'Add part'}</h2>
        <label>Name<input value={v.name} onChange={set('name')} required autoFocus={!item} /></label>
        <div className="two">
          <label>Quantity<input type="number" min={0} inputMode="numeric" value={v.quantity} onChange={set('quantity')} /></label>
          <label>Low-stock at<input type="number" min={0} inputMode="numeric" value={v.min_quantity} onChange={set('min_quantity')} /></label>
        </div>
        {FIELDS.map(([k, label]) => <label key={k}>{label}<input value={v[k]} onChange={set(k)} /></label>)}
        {err && <p className="msg">{err}</p>}
        <div className="actions">
          {item && onDelete && <button type="button" className="danger" disabled={busy} onClick={async () => { if (confirm(`Delete ${item.name}?`)) { await onDelete(); onClose() } }}>Delete</button>}
          <span className="grow" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>
  )
}
