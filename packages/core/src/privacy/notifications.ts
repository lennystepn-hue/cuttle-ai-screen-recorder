// Notification masks: a notification that opens over the screen (a toast, the notification centre)
// is masked while it is open, whatever it says: it may be private. The recorder logs when one opens
// and closes (`window` events of kind `notification`). Pure.
import type { InputEvent, Rect } from '@cuttle/project';

export const NOTIFICATION_RULES = {
  /** The recorder looks at the windows about 4 times a second: a mask starts this long before one was seen… */
  before: 0.3,
  /** …and ends this long after it was seen gone (source s). */
  after: 0.3,
  /** Room around it (px). */
  pad: 6,
};

export interface NotificationMask {
  from: number;
  to: number;
  rect: Rect;
}

/**
 * A mask per notification over the screen, from just before it opened to just after it closed (the
 * take's `end` when it never did), padded and kept on the screen; one entirely off the screen gets none.
 */
export function notificationMasks(events: readonly InputEvent[], screen: { width: number; height: number }, end = Infinity, rules = NOTIFICATION_RULES): NotificationMask[] {
  const windows = events.flatMap((event) => (event.type === 'window' && event.kind === 'notification' ? [event] : [])).sort((a, b) => a.t - b.t);
  const masks: NotificationMask[] = [];
  for (const opened of windows.filter((event) => event.open)) {
    const [x, y, width, height] = opened.rect;
    const left = Math.max(0, x - rules.pad);
    const top = Math.max(0, y - rules.pad);
    const right = Math.min(screen.width, x + width + rules.pad);
    const bottom = Math.min(screen.height, y + height + rules.pad);
    if (right <= left || bottom <= top) continue;
    const closed = windows.find((event) => !event.open && event.id === opened.id && event.t > opened.t)?.t;
    const to = closed === undefined ? (Number.isFinite(end) ? end : opened.t + 5) : closed + rules.after;
    masks.push({ from: round(Math.max(0, opened.t - rules.before)), to: round(to), rect: [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top)] });
  }
  return masks;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
