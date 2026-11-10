import { updateItem } from './items';
import { supabase } from './supabase';
import type { Investigation, Item, TestPlan } from './types';

/** Parts the model was unsure about at capture and that are not yet marked resolved. */
export const needsInvestigation = (i: Pick<Item, 'investigation'>) =>
  Boolean(i.investigation && !i.investigation.resolved && i.investigation.unknowns.length > 0);

/** Ticks or unticks a step; the result is sorted and has no duplicates. */
export function toggleDone(done: readonly number[], index: number): number[] {
  return done.includes(index) ? done.filter((d) => d !== index) : [...done, index].sort((a, b) => a - b);
}

/** Sets or clears one step's note. A blank note removes the entry, so empty boxes don't clutter what is stored. */
export function setStepNote(notes: Record<string, string>, index: number, text: string): Record<string, string> {
  const next = { ...notes };
  if (text.trim()) next[String(index)] = text;
  else delete next[String(index)];
  return next;
}

/** True when the owner has ticked a step or written anything, i.e. replacing the plan would lose something. */
export const hasProgress = (done: readonly number[], notes: Record<string, string>) =>
  done.length > 0 || Object.values(notes).some((n) => n.trim());

/**
 * The owner's results as plain text: one line per step they ticked or wrote about, in plan order.
 * Used to pre-fill "Update from photos & notes" and to add the notes to the part. Returns just the heading when
 * there is nothing yet, so it is always safe to hand on.
 */
export function compileResults(plan: Pick<TestPlan, 'steps'> | null, done: readonly number[], notes: Record<string, string>): string {
  const lines: string[] = [];
  for (const [i, step] of (plan?.steps ?? []).entries()) {
    const text = (notes[String(i)] ?? '').trim();
    const ticked = done.includes(i);
    if (!text && !ticked) continue;
    const tool = step.tool && !/^no tool/i.test(step.tool) ? ` (${step.tool})` : '';
    const body = text ? `: ${text.replace(/\n/g, '\n   ')}` : '';
    lines.push(`${i + 1}. ${step.title}${tool}${ticked ? ' ✓' : ''}${body}`);
  }
  return lines.length ? `Test results:\n${lines.join('\n')}\n` : 'Test results:\n';
}

/** Asks Claude for a test plan written for the user's own tools. Nothing is saved here. */
export async function requestPlan(args: { itemId: string; unknowns: string[]; text?: string }): Promise<TestPlan> {
  const { data, error } = await supabase.functions.invoke('investigate-item', {
    body: { item_id: args.itemId, unknowns: args.unknowns, text: args.text || undefined },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.plan as TestPlan;
}

export async function saveInvestigation(itemId: string, investigation: Investigation | null): Promise<void> {
  await updateItem(itemId, { investigation });
}
