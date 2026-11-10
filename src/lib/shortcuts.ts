export type Action = 'search' | 'capture' | 'add' | 'next' | 'prev' | 'open' | 'inc' | 'dec' | 'help' | 'clear';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface Context {
  /** Focus is in a text field, so letters are text, not commands. */
  typing: boolean;
  /** A dialog is open and handles its own keys. */
  modalOpen: boolean;
  /** The search box has focus (a few keys still work there). */
  inSearch: boolean;
}

/** Elements where typing a letter means typing a letter. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'file'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Maps a key press to a command for the parts list. Single keys only fire outside text fields and dialogs, and
 * never with Ctrl, Alt or Cmd held, so browser and OS shortcuts keep working.
 */
export function actionFor(e: KeyLike, ctx: Context): Action | null {
  if (ctx.modalOpen) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  if (ctx.inSearch) {
    if (e.key === 'ArrowDown') return 'next';
    if (e.key === 'Enter') return 'open';
    if (e.key === 'Escape') return 'clear';
    return null;
  }
  if (ctx.typing) return null;

  switch (e.key) {
    case '/':
      return 'search';
    case 'c':
      return 'capture';
    case 'n':
      return 'add';
    case 'j':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'prev';
    case 'Enter':
      return 'open';
    case '+':
    case '=':
      return 'inc';
    case '-':
      return 'dec';
    case '?':
      return 'help';
    case 'Escape':
      return 'clear';
    default:
      return null;
  }
}

/** Moves the highlighted row. -1 means nothing is selected; the first press selects the first or last row. */
export function moveSelection(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + dir));
}

/** Whether the device has a mouse and hover, i.e. is a desktop-style setup rather than a phone or tablet. */
export function hasFinePointer(): boolean {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}
