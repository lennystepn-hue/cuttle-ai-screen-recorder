// Zooms while typing: a burst of keys gets a zoom on where the text goes, and the zoom follows the
// text (`moves`) once it leaves the middle of the view, as a camera operator would. Where the app
// keeps a system caret (`caret` events), the zoom follows the caret; elsewhere it follows what the
// screen changes during the burst. Times are as people see them: output seconds, turned into source
// seconds at the clip's speed. Pure: `suggest` reads the screen's changes for it.
import type { InputEvent, Rect, ZoomMove } from '@cuttle/project';
import { MAX_AREA, minZoomWidth, type ClipSpan, type ZoomScreen } from '@cuttle/timeline';

export const TYPING_RULES = {
  /** Key counts (half seconds) that start at most this far apart are one burst: a pause under 1.5 s (output s)… */
  burstGap: 2,
  /** …which lasts at least this long (output s). */
  minBurst: 1.5,
  /** Bursts this close in one clip make one zoom (output s). */
  joinGap: 3,
  /** The view shows this share of the screen's width (about 2.2×). */
  width: 0.45,
  /** The camera moves once what is typed leaves the middle this share of the view… */
  middle: 0.6,
  /** …so that it sits this far into the view from the left, with room for what comes next. */
  lead: 0.35,
  /** No move shorter than this share of the view… */
  minMove: 0.05,
  /** …and at most one in this many output seconds. */
  moveGap: 0.8,
  /** A change bigger than this share of the view either way is no typing (a scroll, a new page). */
  maxChange: 0.9,
  /** The zoom eases in this long before the first key… */
  before: 0.7,
  /** …and lasts until this long after the last one, at least `min` (output s), as a click zoom does. */
  after: 2,
  min: 2.4,
  /** Typing in clips faster than this is not zoomed (waiting sped up). */
  maxSpeed: 2,
  /** No zoom starts or ends this close to its clip's edge (output s). */
  edge: 1,
  /** At most one zoom starts in any this many output seconds (the zooms there count). */
  gap: 5,
};

/** A `keys` event counts the presses of half a second. */
const KEY_SLOT = 0.5;

/** What changed on the screen between two frames (screen pixels), at the later frame's time (source s). */
export interface ScreenChange {
  t: number;
  box: { x: number; y: number; width: number; height: number };
}

/** Where typing went on, inside one clip (source seconds). */
export interface Burst {
  clip: number;
  from: number;
  to: number;
}

export interface TypingZoom {
  at: number;
  duration: number;
  rect: Rect;
  /** Where the view goes as the text moves on (none while it stays in view). */
  moves: ZoomMove[];
  /** What it follows: the caret, or what the screen changed. */
  follows: 'caret' | 'screen';
}

export interface TypingInput {
  events: readonly InputEvent[];
  clips: readonly ClipSpan[];
  screen: ZoomScreen;
  /** The zooms already there (the answer zoom, zooms made by hand): none of these overlaps one. */
  avoid: readonly { at: number; duration: number }[];
  /** What the screen changed during the bursts without a caret (`screenChanges`). */
  changes: readonly ScreenChange[];
}

/** The bursts of typing in `clips` at most `maxSpeed` fast, close ones joined; source seconds. */
export function keyBursts(events: readonly InputEvent[], clips: readonly ClipSpan[], rules = TYPING_RULES): Burst[] {
  const clipOf = (t: number) => clips.findIndex((clip) => t >= clip.from && t < clip.to);
  const keys = events
    .filter((event) => event.type === 'keys')
    .map((event) => ({ t: event.t, clip: clipOf(event.t) }))
    .filter((key) => key.clip >= 0 && clips[key.clip]!.speed <= rules.maxSpeed)
    .sort((a, b) => a.t - b.t);
  const bursts: Burst[] = [];
  for (const key of keys) {
    const clip = clips[key.clip]!;
    const end = Math.min(key.t + KEY_SLOT, clip.to);
    const last = bursts.at(-1);
    if (last && last.clip === key.clip && (key.t - (last.to - KEY_SLOT)) / clip.speed <= rules.burstGap) last.to = Math.max(last.to, end);
    else bursts.push({ clip: key.clip, from: key.t, to: end });
  }
  const joined: Burst[] = [];
  for (const burst of bursts.filter((one) => (one.to - one.from) / clips[one.clip]!.speed >= rules.minBurst)) {
    const last = joined.at(-1);
    if (last && last.clip === burst.clip && (burst.from - last.to) / clips[burst.clip]!.speed <= rules.joinGap) last.to = burst.to;
    else joined.push({ ...burst });
  }
  return joined;
}

interface Focus {
  t: number;
  x: number;
  y: number;
}

/** The view's size: `width` of the screen (as many points on a scaled display), in its shape. */
function viewOf(screen: ZoomScreen, rules: typeof TYPING_RULES): { width: number; height: number } {
  const width = minZoomWidth(screen, rules.width);
  return { width, height: (width * screen.height) / screen.width };
}

/** The stretch around a burst where the caret and the screen's changes count for it. */
const aroundOf = (burst: Burst) => ({ from: burst.from - KEY_SLOT, to: burst.to + KEY_SLOT });

/** The caret's middle during a burst, where it is on the screen. */
function caretsOf(burst: Burst, events: readonly InputEvent[], screen: { width: number; height: number }): Focus[] {
  const around = aroundOf(burst);
  return events
    .flatMap((event) => {
      if (event.type !== 'caret' || event.t <= around.from || event.t > around.to) return [];
      const [x, y, width, height] = event.rect;
      const point = { t: event.t, x: x + width / 2, y: y + height / 2 };
      return point.x >= 0 && point.y >= 0 && point.x < screen.width && point.y < screen.height ? [point] : [];
    })
    .sort((a, b) => a.t - b.t);
}

/** The stretches (source seconds) whose screen changes `typingZooms` needs: around the bursts without a caret on the screen. */
export function screenStretches(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, rules = TYPING_RULES): { from: number; to: number }[] {
  return keyBursts(events, clips, rules)
    .filter((burst) => caretsOf(burst, events, screen).length === 0)
    .map(aroundOf);
}

/**
 * Where the text goes during a burst: the caret's middle where the app keeps one on the screen, else
 * what the screen changed (the newest end of a wide change: a shell draws the whole line anew).
 */
function focusOf(burst: Burst, input: TypingInput, rules: typeof TYPING_RULES): { points: Focus[]; follows: TypingZoom['follows'] } {
  const { screen } = input;
  const view = viewOf(screen, rules);
  const carets = caretsOf(burst, input.events, screen);
  if (carets.length > 0) return { points: carets, follows: 'caret' };
  const around = aroundOf(burst);
  const during = (t: number) => t > around.from && t <= around.to;
  const points = input.changes
    .filter((change) => during(change.t) && change.box.width <= rules.maxChange * view.width && change.box.height <= rules.maxChange * view.height)
    .map(({ t, box }) => ({ t, x: Math.max(box.x + box.width / 2, box.x + box.width - 0.1 * view.width), y: box.y + box.height / 2 }))
    .sort((a, b) => a.t - b.t);
  return { points, follows: 'screen' };
}

/**
 * The camera's path over the focus points: it starts with the first second's points `lead` into the
 * view, and moves (so the point is `lead` in again) whenever a point leaves the view's middle.
 */
function pathOf(points: readonly Focus[], speed: number, screen: ZoomScreen, rules: typeof TYPING_RULES): { rect: Rect; moves: ZoomMove[] } {
  const view = viewOf(screen, rules);
  const place = (x: number, y: number): Rect => [
    Math.round(Math.min(Math.max(x - rules.lead * view.width, 0), screen.width - view.width)),
    Math.round(Math.min(Math.max(y - view.height / 2, 0), screen.height - view.height)),
    Math.round(view.width),
    Math.round(view.height),
  ];
  const opening = points.filter((point) => point.t <= points[0]!.t + speed);
  const middleOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  const first = place(middleOf(opening.map((point) => point.x)), middleOf(opening.map((point) => point.y)));
  let rect = first;
  const moves: ZoomMove[] = [];
  let movedAt = -Infinity;
  for (const point of points) {
    const outside = Math.abs(point.x - (rect[0] + view.width / 2)) > (rules.middle / 2) * view.width || Math.abs(point.y - (rect[1] + view.height / 2)) > (rules.middle / 2) * view.height;
    if (!outside || (point.t - movedAt) / speed < rules.moveGap) continue;
    const next = place(point.x, point.y);
    // against the screen's edge the view cannot follow further
    if (Math.abs(next[0] - rect[0]) < rules.minMove * view.width && Math.abs(next[1] - rect[1]) < rules.minMove * view.height) continue;
    moves.push({ at: round(point.t), rect: next });
    rect = next;
    movedAt = point.t;
  }
  return { rect: first, moves };
}

/**
 * The zooms for the typing in `clips`, in source seconds and pixels: one per burst (close bursts
 * joined) that has somewhere to look, following the text. None overlaps a zoom of `avoid`, and they
 * count for the 5 output seconds between zoom starts.
 */
export function typingZooms(input: TypingInput, rules = TYPING_RULES): TypingZoom[] {
  const { clips, avoid, screen } = input;
  // a view of (nearly) all of the screen barely zooms: none (a small window on a scaled display)
  const view = viewOf(screen, rules);
  if ((view.width * view.height) / (screen.width * screen.height) > MAX_AREA) return [];
  const outputAt = (t: number, index: number) => clips[index]!.start + (t - clips[index]!.from) / clips[index]!.speed;
  const starts = avoid.flatMap((other) => {
    const index = clips.findIndex((clip) => other.at >= clip.from && other.at < clip.to);
    return index < 0 ? [] : [outputAt(other.at, index)];
  });
  const result: TypingZoom[] = [];
  let lastEnd = -Infinity;
  const bursts = keyBursts(input.events, clips, rules).sort((a, b) => outputAt(a.from, a.clip) - outputAt(b.from, b.clip));
  for (const burst of bursts) {
    const clip = clips[burst.clip]!;
    const s = clip.speed;
    const at = Math.max(burst.from - rules.before * s, clip.from + rules.edge * s);
    const next = Math.min(...avoid.filter((other) => other.at > burst.from).map((other) => other.at));
    const end = Math.min(Math.max(burst.to + rules.after * s, at + rules.min * s), clip.to - rules.edge * s, next);
    if ((end - at) / s < rules.min - 1e-9) continue;
    if (avoid.some((other) => at < other.at + other.duration && other.at < end)) continue;
    const start = outputAt(at, burst.clip);
    if (start < lastEnd || starts.some((other) => Math.abs(start - other) < rules.gap)) continue;
    const { points, follows } = focusOf(burst, input, rules);
    if (points.length === 0) continue;
    const { rect, moves } = pathOf(points, s, input.screen, rules);
    result.push({ at: round(at), duration: round(end - at), rect, moves: moves.filter((move) => move.at > at && move.at < end), follows });
    starts.push(start);
    lastEnd = outputAt(end, burst.clip);
  }
  return result;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
