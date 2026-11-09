export const SWIPE_THRESHOLD = 72;
/** How far the row follows the finger, in px. */
export const SWIPE_MAX_TRAVEL = 96;

/**
 * Decides what a horizontal drag means: right = +1, left = -1.
 * Needs to travel far enough and be clearly more horizontal than vertical, so scrolling never triggers it.
 */
export function swipeAction(dx: number, dy: number, threshold = SWIPE_THRESHOLD): 'inc' | 'dec' | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx > 0 ? 'inc' : 'dec';
}
