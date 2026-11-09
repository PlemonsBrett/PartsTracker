import type { Item } from './types';

/** Lowercase and drop ohm/unit noise so "10k", "10kΩ" and "10K ohm" all match. */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ωΩ]|\bohms?\b/gi, '')
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();

const haystack = (i: Item) =>
  normalize(
    [i.name, i.category, i.value, i.package, i.part_number, i.manufacturer, i.location, i.description, i.notes].filter(Boolean).join(' '),
  );

/** Every whitespace-separated term must appear somewhere in the item. */
export function searchItems(items: Item[], query: string): Item[] {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return items;
  return items.filter((i) => {
    const h = haystack(i);
    return terms.every((t) => h.includes(t));
  });
}
