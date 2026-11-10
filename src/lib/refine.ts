import { mergeNote, updateItem } from './items';
import { supabase } from './supabase';
import type { Item, ItemInput, Layout, Pin } from './types';

export type RefineField = 'name' | 'category' | 'value' | 'package' | 'part_number' | 'manufacturer' | 'location' | 'description';

export const FIELD_LABEL: Record<RefineField, string> = {
  name: 'Name',
  category: 'Category',
  value: 'Value',
  package: 'Package',
  part_number: 'Part number',
  manufacturer: 'Manufacturer',
  location: 'Location',
  description: 'Description',
};

export interface Change {
  field: RefineField;
  from: string | null;
  to: string;
}

export interface Refinement {
  changes: Change[];
  notes_add: string | null;
  pinout: { layout: Layout; pins: Pin[] } | null;
  summary: string;
  uncertain: string[];
}

export interface Accepted {
  fields: ReadonlySet<RefineField>;
  notes: boolean;
  pinout: boolean;
}

/** Asks Claude what the new photos and comments change about this part. Nothing is saved yet. */
export async function refineItem(args: {
  itemId: string;
  text?: string;
  images: { data: string; mediaType: string }[];
}): Promise<Refinement> {
  const { data, error } = await supabase.functions.invoke('refine-item', {
    body: { item_id: args.itemId, text: args.text || undefined, images: args.images },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as Refinement;
}

/** How many separate things the user is accepting, for the Apply button. */
export const acceptedCount = (r: Refinement, a: Accepted) =>
  r.changes.filter((c) => a.fields.has(c.field)).length + (a.notes && r.notes_add ? 1 : 0) + (a.pinout && r.pinout ? 1 : 0);

/** Builds the update for exactly what was accepted. Existing notes are kept; the new note is added below them. */
export function buildPatch(item: Pick<Item, 'notes'>, r: Refinement, a: Accepted): Partial<ItemInput> {
  const patch: Partial<ItemInput> = {};
  for (const c of r.changes) if (a.fields.has(c.field)) patch[c.field] = c.to;
  if (a.notes && r.notes_add) {
    const notes = mergeNote(item.notes, r.notes_add);
    if (notes) patch.notes = notes;
  }
  if (a.pinout && r.pinout) patch.pinout = { ...r.pinout, source: 'photo' };
  return patch;
}

export async function applyRefinement(item: Item, r: Refinement, a: Accepted): Promise<Partial<ItemInput>> {
  const patch = buildPatch(item, r, a);
  if (Object.keys(patch).length > 0) await updateItem(item.id, patch);
  return patch;
}
