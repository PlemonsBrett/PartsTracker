import { supabase } from './supabase';
import type { Item, Project, ProjectPart, ProjectStatus } from './types';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: 'Idea',
  building: 'Building',
  done: 'Done',
  shelved: 'Shelved',
};
export const STATUSES = Object.keys(STATUS_LABEL) as ProjectStatus[];

export const NAME_MAX = 120;
export const ROLE_MAX = 300;

/** Trims and caps a project or part name. Null when there is nothing usable. */
export const cleanName = (s: string): string | null => s.trim().slice(0, NAME_MAX) || null;

// ---- stock check (pure) ----

export type PartState =
  | { kind: 'to-get' } // not in the inventory
  | { kind: 'used'; taken: number } // stock already taken for this project
  | { kind: 'ok'; have: number }
  | { kind: 'short'; have: number; missing: number };

/** Where one part stands against the inventory. */
export function partState(part: ProjectPart, items: readonly Pick<Item, 'id' | 'quantity'>[]): PartState {
  if (part.used_at) return { kind: 'used', taken: part.taken ?? 0 };
  const item = part.item_id ? items.find((i) => i.id === part.item_id) : undefined;
  if (!item) return { kind: 'to-get' };
  return item.quantity >= part.quantity
    ? { kind: 'ok', have: item.quantity }
    : { kind: 'short', have: item.quantity, missing: part.quantity - item.quantity };
}

export interface StockSummary {
  /** Parts that are not in the inventory at all. */
  toGet: ProjectPart[];
  /** In the inventory, but not enough. */
  short: { part: ProjectPart; have: number; missing: number }[];
  /** Parts that can be taken from the inventory now (not already used). */
  available: number;
  used: number;
  /** Nothing to buy and nothing short. */
  ready: boolean;
}

export function summarize(parts: readonly ProjectPart[], items: readonly Pick<Item, 'id' | 'quantity'>[]): StockSummary {
  const toGet: ProjectPart[] = [];
  const short: StockSummary['short'] = [];
  let available = 0;
  let used = 0;
  for (const part of parts) {
    const s = partState(part, items);
    if (s.kind === 'to-get') toGet.push(part);
    else if (s.kind === 'short') {
      short.push({ part, have: s.have, missing: s.missing });
      available++;
    } else if (s.kind === 'ok') available++;
    else used++;
  }
  return { toGet, short, available, used, ready: toGet.length === 0 && short.length === 0 };
}

/** What "use parts" would take: each unused inventory part, capped at what is on hand. */
export function takePlan(parts: readonly ProjectPart[], items: readonly Pick<Item, 'id' | 'quantity'>[]) {
  const plan: { part: ProjectPart; itemId: string; take: number; missing: number }[] = [];
  for (const part of parts) {
    if (part.used_at || !part.item_id) continue;
    const item = items.find((i) => i.id === part.item_id);
    if (!item) continue;
    const take = Math.min(part.quantity, Math.max(0, item.quantity));
    plan.push({ part, itemId: item.id, take, missing: part.quantity - take });
  }
  return plan;
}

/** Plain-text shopping list for what is missing or short, e.g. to paste into a store's cart notes. */
export function shoppingList(s: StockSummary): string {
  return [...s.toGet.map((p) => `${p.quantity} × ${p.name}`), ...s.short.map((x) => `${x.missing} × ${x.part.name} (have ${x.have})`)].join(
    '\n',
  );
}

// ---- projects ----

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert({ name }).select().single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'notes' | 'diagram'>>,
): Promise<void> {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ---- project parts ----

export async function listParts(projectId: string): Promise<ProjectPart[]> {
  const { data, error } = await supabase.from('project_parts').select('*').eq('project_id', projectId).order('created_at');
  if (error) throw error;
  return data as ProjectPart[];
}

export async function addPart(
  projectId: string,
  part: { item_id?: string | null; name: string; quantity?: number; role?: string | null },
): Promise<ProjectPart> {
  const row = {
    project_id: projectId,
    item_id: part.item_id ?? null,
    name: part.name.trim().slice(0, NAME_MAX),
    quantity: part.quantity ?? 1,
    role: part.role?.trim().slice(0, ROLE_MAX) || null,
  };
  const { data, error } = await supabase.from('project_parts').insert(row).select().single();
  if (error) throw error;
  return data as ProjectPart;
}

export async function updatePart(id: string, patch: Partial<Pick<ProjectPart, 'quantity' | 'role' | 'name'>>): Promise<void> {
  const { error } = await supabase.from('project_parts').update(patch).eq('id', id);
  if (error) throw error;
}

export async function removePart(id: string): Promise<void> {
  const { error } = await supabase.from('project_parts').delete().eq('id', id);
  if (error) throw error;
}

async function currentQuantities(ids: string[]): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('items').select('id,quantity').in('id', ids);
  if (error) throw error;
  return new Map((data as { id: string; quantity: number }[]).map((r) => [r.id, r.quantity]));
}

/**
 * Takes the project's parts out of the inventory. Quantities are read fresh first so a recent change isn't overwritten,
 * and each part is marked used so it can't be taken twice. Returns what was short, if anything.
 */
export async function takeParts(parts: readonly ProjectPart[]): Promise<{ name: string; missing: number }[]> {
  const todo = parts.filter((p) => p.item_id && !p.used_at);
  if (!todo.length) return [];
  const have = await currentQuantities(todo.map((p) => p.item_id as string));
  const short: { name: string; missing: number }[] = [];
  for (const part of todo) {
    const id = part.item_id as string;
    if (!have.has(id)) continue;
    const onHand = have.get(id) as number;
    const take = Math.min(part.quantity, Math.max(0, onHand));
    if (take < part.quantity) short.push({ name: part.name, missing: part.quantity - take });
    const { error } = await supabase
      .from('items')
      .update({ quantity: onHand - take })
      .eq('id', id);
    if (error) throw error;
    const { error: e2 } = await supabase.from('project_parts').update({ used_at: new Date().toISOString(), taken: take }).eq('id', part.id);
    if (e2) throw e2;
  }
  return short;
}

/** Undoes `takeParts`: gives back exactly what was taken. */
export async function putBackParts(parts: readonly ProjectPart[]): Promise<void> {
  const todo = parts.filter((p) => p.used_at);
  for (const part of todo) {
    if (part.item_id && part.taken) {
      const have = await currentQuantities([part.item_id]);
      if (have.has(part.item_id)) {
        const { error } = await supabase
          .from('items')
          .update({ quantity: (have.get(part.item_id) as number) + part.taken })
          .eq('id', part.item_id);
        if (error) throw error;
      }
    }
    const { error } = await supabase.from('project_parts').update({ used_at: null, taken: null }).eq('id', part.id);
    if (error) throw error;
  }
}

/** Matches for the "add a part" box: inventory items not already in the project, best name matches first. */
export function pickable(items: readonly Item[], parts: readonly ProjectPart[], query: string, limit = 6): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(parts.map((p) => p.item_id).filter(Boolean));
  const hay = (i: Item) => [i.name, i.value, i.part_number, i.category, i.package].filter(Boolean).join(' ').toLowerCase();
  return items
    .filter((i) => !taken.has(i.id) && q.split(/\s+/).every((w) => hay(i).includes(w)))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}
