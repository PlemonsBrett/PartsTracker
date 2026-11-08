export interface Item {
  id: string
  name: string
  category: string | null
  quantity: number
  min_quantity: number
  location: string | null
  part_number: string | null
  manufacturer: string | null
  value: string | null
  package: string | null
  description: string | null
  datasheet_url: string | null
  notes: string | null
  updated_at: string
}

export type ItemInput = Partial<Omit<Item, 'id' | 'updated_at'>> & { name: string }

/** A change suggested by the AI parser; the user reviews it before it is applied. */
export interface Proposal {
  op: 'add' | 'remove' | 'set'
  item_id: string | null
  name: string
  quantity: number
  category?: string | null
  value?: string | null
  package?: string | null
  part_number?: string | null
  manufacturer?: string | null
  location?: string | null
  description?: string | null
  note?: string | null
}
