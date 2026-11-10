// Small per-browser preferences. Storage can be unavailable (private windows, blocked site data), so every access is guarded.
const DICTATE_KEY = 'partstracker.dictateOnOpen';

export function readDictateOnOpen(): boolean {
  try {
    return localStorage.getItem(DICTATE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDictateOnOpen(on: boolean): void {
  try {
    localStorage.setItem(DICTATE_KEY, on ? '1' : '0');
  } catch {
    // nothing to do: the choice just isn't remembered
  }
}
