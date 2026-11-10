import { addPart, createProject, NAME_MAX } from './projects';
import { supabase } from './supabase';
import type { Idea, IdeaPart, Item } from './types';

export type PartStatus = 'have' | 'short' | 'buy';

export interface ScoredPart {
  part: IdeaPart;
  status: PartStatus;
  /** How many are in stock (0 when the part is not in the inventory). */
  have: number;
}

export interface Scored {
  idea: Idea;
  parts: ScoredPart[];
  /** Whole percent of the required parts that are fully in stock. */
  percent: number;
  required: number;
  haveCount: number;
  shortCount: number;
  buyCount: number;
  printCount: number;
}

/**
 * How much of an idea is already on the shelf. A required part counts as "have" only when the stock covers the quantity;
 * partly covered parts are "short", and parts not in the inventory (or deleted since) are "buy". Optional parts are shown
 * but never counted, and printed parts are made, not bought, so they are not counted either.
 * Worked out here from the live inventory, never taken from the model.
 */
export function scoreIdea(idea: Idea, items: readonly Pick<Item, 'id' | 'quantity'>[]): Scored {
  const stock = new Map(items.map((i) => [i.id, i.quantity]));
  const parts: ScoredPart[] = idea.parts.map((part) => {
    const have = part.item_id ? (stock.get(part.item_id) ?? 0) : 0;
    const status: PartStatus = part.item_id && have >= part.quantity ? 'have' : part.item_id && have > 0 ? 'short' : 'buy';
    return { part, status, have };
  });
  const req = parts.filter((p) => !p.part.optional);
  const haveCount = req.filter((p) => p.status === 'have').length;
  return {
    idea,
    parts,
    percent: req.length ? Math.round((100 * haveCount) / req.length) : 0,
    required: req.length,
    haveCount,
    shortCount: req.filter((p) => p.status === 'short').length,
    buyCount: req.filter((p) => p.status === 'buy').length,
    printCount: idea.printed.length,
  };
}

/** Best match first: highest percent in stock, then least to buy, then the more substantial project. */
export function rankIdeas<T extends { id: string; idea: Idea }>(
  rows: readonly T[],
  items: readonly Pick<Item, 'id' | 'quantity'>[],
): (T & { score: Scored })[] {
  return rows
    .map((r) => ({ ...r, score: scoreIdea(r.idea, items) }))
    .sort(
      (a, b) =>
        b.score.percent - a.score.percent ||
        a.score.buyCount - b.score.buyCount ||
        b.score.required - a.score.required ||
        a.idea.title.localeCompare(b.idea.title),
    );
}

/** The notes a project starts with when it comes from an idea: how it works, what to print, what to have on hand. */
export function ideaNotes(idea: Idea): string {
  const out: string[] = [idea.summary];
  if (idea.printed.length) {
    out.push(
      '',
      '3D printing:',
      ...idea.printed.map((p) => `- ${p.name} on the ${p.printer} (${p.material})${p.notes ? `: ${p.notes}` : ''}`),
    );
  }
  if (idea.tools_needed.length) out.push('', `Tools: ${idea.tools_needed.join(', ')}.`);
  if (idea.steps.length) out.push('', 'Steps:', ...idea.steps.map((s, i) => `${i + 1}. ${s}`));
  return out.join('\n').slice(0, 19000);
}

// ---- storage and the function ----

export async function listIdeas(): Promise<{ id: string; idea: Idea; created_at: string }[]> {
  const { data, error } = await supabase
    .from('project_ideas')
    .select('id,idea,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as { id: string; idea: Idea; created_at: string }[];
}

export async function saveIdeas(ideas: Idea[]): Promise<void> {
  if (!ideas.length) return;
  const { error } = await supabase.from('project_ideas').insert(ideas.map((idea) => ({ idea })));
  if (error) throw error;
}

export async function deleteIdea(id: string): Promise<void> {
  const { error } = await supabase.from('project_ideas').delete().eq('id', id);
  if (error) throw error;
}

/** Asks Claude for project ideas from what is in stock. Nothing is saved here. */
export async function requestIdeas(args: { text?: string; count?: number }): Promise<Idea[]> {
  const { data, error } = await supabase.functions.invoke('project-ideas', { body: { text: args.text || undefined, count: args.count } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.ideas as Idea[];
}

/**
 * Turns an idea into a project: notes from the idea, parts from the owner's inventory where they exist and "to get" parts
 * where they don't. Returns the new project's id.
 */
export async function startProject(idea: Idea, items: readonly Pick<Item, 'id'>[]): Promise<string> {
  const project = await createProject(idea.title.slice(0, NAME_MAX));
  const { error } = await supabase
    .from('projects')
    .update({ description: idea.summary.slice(0, 2000), notes: ideaNotes(idea) })
    .eq('id', project.id);
  if (error) throw error;
  const known = new Set(items.map((i) => i.id));
  for (const p of idea.parts) {
    await addPart(project.id, {
      item_id: p.item_id && known.has(p.item_id) ? p.item_id : null,
      name: p.name,
      quantity: Math.max(1, p.quantity),
      role: p.optional ? `Optional: ${p.role}` : p.role,
    });
  }
  return project.id;
}
