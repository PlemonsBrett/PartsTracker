import { needsInvestigation } from './investigate';
import type { Item } from './types';

export type Status = '' | 'low' | 'investigate';

/** At or below the part's low-stock threshold (a threshold of 0 means "don't track"). */
export const isLow = (i: Pick<Item, 'quantity' | 'min_quantity'>) => i.min_quantity > 0 && i.quantity <= i.min_quantity;

export interface Facets {
  all: number;
  low: number;
  investigate: number;
  /** Every category in `items`, alphabetically, with how many parts each has. */
  categories: [string, number][];
}

export function countFacets(items: Item[]): Facets {
  const byCategory = new Map<string, number>();
  let low = 0;
  let investigate = 0;
  for (const i of items) {
    if (i.category) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
    if (isLow(i)) low++;
    if (needsInvestigation(i)) investigate++;
  }
  return { all: items.length, low, investigate, categories: [...byCategory].sort((a, b) => a[0].localeCompare(b[0])) };
}

export function matchesStatus(item: Item, status: Status): boolean {
  if (status === 'low') return isLow(item);
  if (status === 'investigate') return needsInvestigation(item);
  return true;
}
