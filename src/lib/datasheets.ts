import { supabase } from './supabase';
import type { Item } from './types';

export interface LookupResult {
  status: 'found' | 'not_found';
  /** facts = specs parsed, pdf = file attached because parsing failed, link = only the source URL. */
  stored?: 'facts' | 'pdf' | 'link';
  source_url?: string;
}

/** Worth an automatic lookup: has a part number, nothing attached yet, and not already tried without luck. */
export const wantsLookup = (i: Item) => Boolean(i.part_number) && !i.fact_sheet && !i.datasheet_path && i.datasheet_status !== 'not_found';

export async function findDatasheet(itemId: string): Promise<LookupResult> {
  const { data, error } = await supabase.functions.invoke('find-datasheet', { body: { item_id: itemId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as LookupResult;
}

/** Opens the stored PDF. The tab is opened first so mobile popup blockers allow it. */
export async function openDatasheetFile(path: string) {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('datasheets').createSignedUrl(path, 300);
  if (error || !data) {
    tab?.close();
    throw error ?? new Error('Could not open datasheet');
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

export async function clearDatasheet(item: Item) {
  if (item.datasheet_path) await supabase.storage.from('datasheets').remove([item.datasheet_path]);
  const { error } = await supabase
    .from('items')
    .update({ fact_sheet: null, datasheet_path: null, datasheet_status: null, datasheet_checked_at: null })
    .eq('id', item.id);
  if (error) throw error;
}
