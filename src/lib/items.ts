import { supabase } from './supabase';
import type { Item, ItemInput, Proposal } from './types';

export async function listItems(): Promise<Item[]> {
  const { data, error } = await supabase.from('items').select('*').order('name').limit(5000);
  if (error) throw error;
  return data as Item[];
}

export async function createItem(input: ItemInput): Promise<Item> {
  const { data, error } = await supabase.from('items').insert(input).select().single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(id: string, patch: Partial<ItemInput>): Promise<Item> {
  const { data, error } = await supabase.from('items').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Item;
}

export async function deleteItem(id: string) {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
}

const FILLABLE = ['category', 'value', 'package', 'part_number', 'manufacturer', 'location', 'description'] as const;

/**
 * Adds a capture note to a part's existing notes without overwriting them.
 * Returns null when there is nothing new to save (no note, or it is already there).
 */
export function mergeNote(existing: string | null | undefined, note: string | null | undefined): string | null {
  const add = note?.trim();
  if (!add) return null;
  const current = existing?.trim() ?? '';
  if (current.includes(add)) return null;
  return current ? `${current}\n${add}` : add;
}

export function nextQuantity(current: number, p: Pick<Proposal, 'op' | 'quantity'>) {
  if (p.op === 'set') return Math.max(0, p.quantity);
  return Math.max(0, current + (p.op === 'add' ? p.quantity : -p.quantity));
}

/** Applies reviewed proposals. Existing items only get blank fields filled, never overwritten. */
/** Applies reviewed proposals and returns the items that were newly created. */
export async function applyProposals(proposals: Proposal[], items: Item[]): Promise<Item[]> {
  const created: Item[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const p of proposals) {
    const existing = p.item_id ? byId.get(p.item_id) : undefined;
    if (existing) {
      const patch: Partial<ItemInput> = { quantity: nextQuantity(existing.quantity, p) };
      for (const f of FILLABLE) if (!existing[f] && p[f]) patch[f] = p[f];
      const notes = mergeNote(existing.notes, p.note);
      if (notes) patch.notes = notes;
      await updateItem(existing.id, patch);
    } else {
      if (p.op === 'remove') continue; // nothing to remove from
      const input: ItemInput = { name: p.name, quantity: Math.max(0, p.quantity) };
      for (const f of FILLABLE) if (p[f]) input[f] = p[f];
      const notes = mergeNote(null, p.note);
      if (notes) input.notes = notes;
      created.push(await createItem(input));
    }
  }
  return created;
}

export async function parseInventory(args: { text?: string; image?: string; mediaType?: string }): Promise<Proposal[]> {
  const { data, error } = await supabase.functions.invoke('parse-inventory', { body: args });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.changes as Proposal[];
}

/** Downscale to ≤1568px JPEG so phone photos upload fast and stay within model limits. */
export async function imageToBase64(file: File, maxSide = 1568): Promise<{ data: string; mediaType: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}
