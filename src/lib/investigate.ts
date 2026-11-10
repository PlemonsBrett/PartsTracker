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
