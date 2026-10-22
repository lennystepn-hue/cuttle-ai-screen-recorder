// The badges of the shortcuts pressed (events.jsonl's `shortcut`): which one shows when, the same
// shortcut pressed again and again as one badge with its count (⌘Z ×5), in and out with a fade.
import { isChord, type InputEvent, type KeyBadgeShow } from '@cuttle/project';
import { clamp } from './easing';

/** A shortcut of the take: source seconds, and its keys as the recording system writes them. */
export interface Shortcut {
  t: number;
  keys: readonly string[];
}

/** One badge: a shortcut pressed once, or again and again, and the source seconds of each press. */
export interface KeyGroup {
  keys: readonly string[];
  presses: number[];
}

/** The badge a frame shows. */
export interface KeyBadge {
  keys: readonly string[];
  /** How often it was pressed up to this frame (shown as ×n from 2). */
  count: number;
  opacity: number;
  /** Output seconds since it came in (it rises as it does). */
  age: number;
}

/** The same shortcut again within this many seconds of the last press is one badge. */
export const KEY_REPEAT_SECONDS = 1;
/** A badge stays this long (output seconds) after its last press, unless another one comes. */
export const KEY_HOLD_SECONDS = 1.5;
/** It comes in and goes out over these (output seconds). */
const KEY_IN_SECONDS = 0.12;
const KEY_OUT_SECONDS = 0.3;
/** No badges in clips faster than this: waiting sped up shows no keys. */
export const KEY_MAX_SPEED = 2;

/** The take's shortcuts among its input events (events.jsonl). */
export function shortcutsOf(events: readonly InputEvent[]): Shortcut[] {
  return events.flatMap((event) => (event.type === 'shortcut' ? [{ t: event.t, keys: event.keys }] : []));
}

/** The take's shortcuts as badges: chords only, or (`keys`) also special keys alone; repeats joined. */
export function keyGroups(shortcuts: readonly Shortcut[], show: KeyBadgeShow): KeyGroup[] {
  const groups: KeyGroup[] = [];
  for (const shortcut of [...shortcuts].sort((a, b) => a.t - b.t)) {
    if (show === 'shortcuts' && !isChord(shortcut.keys)) continue;
    const last = groups.at(-1);
    if (last && last.keys.join('+') === shortcut.keys.join('+') && shortcut.t - last.presses.at(-1)! <= KEY_REPEAT_SECONDS) last.presses.push(shortcut.t);
    else groups.push({ keys: shortcut.keys, presses: [shortcut.t] });
  }
  return groups;
}

/**
 * The badge at a source second of a clip played at `speed`: the last one that came in, while it
 * holds (a newer one takes its place at once). None in a clip faster than `KEY_MAX_SPEED`.
 */
export function keyBadgeAt(groups: readonly KeyGroup[], sourceTime: number, speed: number): KeyBadge | undefined {
  if (speed > KEY_MAX_SPEED || groups.length === 0) return undefined;
  // the last group that started by now (binary search: a take can have thousands)
  let lo = 0;
  let hi = groups.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid]!.presses[0]! <= sourceTime + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const group = groups[found];
  if (!group) return undefined;
  const start = group.presses[0]!;
  const end = group.presses.at(-1)! + KEY_HOLD_SECONDS * speed;
  if (sourceTime >= end) return undefined;
  // output seconds since it came in and until it goes
  const age = (sourceTime - start) / speed;
  const left = (end - sourceTime) / speed;
  const opacity = clamp(Math.min(age / KEY_IN_SECONDS, left / KEY_OUT_SECONDS), 0, 1);
  const count = group.presses.filter((t) => t <= sourceTime + 1e-9).length;
  return { keys: group.keys, count, opacity, age };
}
