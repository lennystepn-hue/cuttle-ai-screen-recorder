// Following each private thing from frame to frame, around and between the reads that found it. The
// screen's text is read at most twice a second, and text that scrolls moves on further in between:
// it comes in before it is first read, goes out after it was last read, and can go away and back
// between two reads. So the frames are compared 30 a second: where a read found the thing, its own
// picture is taken, and it is found again in each frame after that (and before, back to where it
// came in) near where it was. Where it cannot be told (it changed where it stood, or something
// covers it), its mask holds the places the reads found, as before.
import type { Rect } from '@cuttle/project';
import { runFfmpeg } from '../ffmpeg';
import { MASK_RULES, type Track } from './masks';

export const FOLLOW_RULES = {
  /** Frames a second the things are followed in (a take's rate). */
  rate: 30,
  /**
   * The frames are compared at this share of the screen's width and at its whole height: text that
   * scrolls moves a row at a time, and at half the height every other place reads half a row off.
   */
  scale: 0.5,
  /** From one frame to the next a thing is looked for this share of the screen's height up and down (a fast flick moves 130 px a frame)… */
  reach: 0.25,
  /** …and, where it is not in its column, this share of its width aside (a window dragged slowly). */
  side: 0.02,
  /** Room around the text in its picture (screen px). */
  pad: 4,
  /**
   * It is where the frame differs from its picture at most this much: the summed difference, a share
   * of the picture's ink (how far its pixels are from their mean). Text where it is reads under 0.1
   * in a take's frames, other text and the page around it over 0.6.
   */
  match: 0.35,
  /** Of two places that match, the nearer the one it was heading for: this much score for a whole `reach` farther. */
  nearer: 0.1,
  /** It is looked for where at least this share of its ink is on screen… */
  inside: 0.5,
  /**
   * …and, as it goes out or under something that covers it (a page's header it scrolls under), what
   * still shows of it at either end, down to this share of its ink. Then it goes on as it went until
   * it has moved its own height, or none of it is on screen.
   */
  part: 0.1,
  /** Where its strips side by side that show as they are hold this share of its ink, something covers the rest (a popup, a floating button). */
  covered: 0.25,
  /** It is followed back at most this long before a read that found it, where it was not followed before (s). */
  back: 1,
  /** A read that finds it at most this far from where it was followed to (screen px) agrees with the following. */
  agree: 12,
  /**
   * Where the read after its last no longer finds it but the following still does (only a part of it
   * shows, or the read missed it), it is followed on this long at most (s), as long as it is found.
   */
  beyond: 2.5,
};

/** Where a thing was at `at` (screen px). */
export interface Place {
  at: number;
  rect: Rect;
}

/** A stretch a thing was on screen: from, to (source s), and its places in between, in time order. */
export interface Stretch {
  from: number;
  to: number;
  places: Place[];
}

/** A grey frame, compared size. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A thing's own picture, taken from a frame where it was. */
export interface Template {
  width: number;
  height: number;
  data: Uint8Array;
  /** Its pixels' mean. */
  mean: number;
  /** Each row's ink: how far its pixels are from the picture's mean, summed (what there is to tell it by). */
  ink: Float64Array;
  /** All rows' ink. */
  total: number;
}

type Point = { x: number; y: number };

/** The template of `picture` at (x, y), `width` × `height` (compared px, on screen). */
export function templateOf(picture: Picture, x: number, y: number, width: number, height: number): Template {
  const data = new Uint8Array(width * height);
  let sum = 0;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) sum += data[j * width + i] = picture.data[(y + j) * picture.width + x + i]!;
  const mean = sum / data.length;
  const ink = new Float64Array(height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) ink[j]! += Math.abs(data[j * width + i]! - mean);
  return { width, height, data, mean, ink, total: ink.reduce((a, b) => a + b, 0) };
}

/** The share of the template's ink on screen at top `y`. */
export function inkOn(picture: Picture, template: Template, y: number): number {
  let on = 0;
  for (let j = Math.max(0, -y); j < Math.min(template.height, picture.height - y); j++) on += template.ink[j]!;
  return template.total > 0 ? on / template.total : 0;
}

/** The rows of the template on screen at (x, y), and the columns. */
const onScreen = (picture: Picture, template: Template, x: number, y: number) => ({
  top: Math.max(0, -y),
  bottom: Math.min(template.height, picture.height - y),
  left: Math.max(0, -x),
  right: Math.min(template.width, picture.width - x),
});

/** The summed difference of rows `top`…`bottom` at (x, y); stops once over `most`. */
function rowsDiffer(picture: Picture, template: Template, x: number, y: number, top: number, bottom: number, left: number, right: number, most = Infinity): number {
  let sum = 0;
  for (let j = top; j < bottom; j++) {
    const row = (y + j) * picture.width + x;
    const own = j * template.width;
    for (let i = left; i < right; i++) sum += Math.abs(picture.data[row + i]! - template.data[own + i]!);
    if (sum > most) return Infinity;
  }
  return sum;
}

/**
 * How much the picture at (x, y) differs from the template: the summed difference over the part on
 * screen, a share of that part's ink; Infinity where less than `inside` of its ink is on screen, or
 * once it is worse than `limit`.
 */
export function differs(picture: Picture, template: Template, x: number, y: number, inside: number, limit = Infinity): number {
  const { top, bottom, left, right } = onScreen(picture, template, x, y);
  if (bottom <= top || 2 * (right - left) < template.width) return Infinity;
  let on = 0;
  for (let j = top; j < bottom; j++) on += template.ink[j]!;
  if (on <= 0 || on < inside * template.total) return Infinity;
  const sum = rowsDiffer(picture, template, x, y, top, bottom, left, right, limit * on);
  return sum === Infinity ? Infinity : sum / on;
}

/**
 * The most of the template that shows at (x, y) as it is from one end (`top`: its top rows), the
 * rest covered or off screen: how many rows and their share of the ink, at least `rows` rows and
 * `part` of the ink, the rows differing at most `match`; undefined where none does.
 */
export function showing(picture: Picture, template: Template, x: number, y: number, end: 'top' | 'bottom', match: number, part: number, rows = 1): { rows: number; share: number } | undefined {
  const screen = onScreen(picture, template, x, y);
  if (screen.bottom <= screen.top || 2 * (screen.right - screen.left) < template.width) return undefined;
  const diff: number[] = [];
  for (let j = 0; j < template.height; j++) diff.push(j >= screen.top && j < screen.bottom ? rowsDiffer(picture, template, x, y, j, j + 1, screen.left, screen.right) : Infinity);
  let best: { rows: number; share: number } | undefined;
  // rows from that end on, as long as they match
  const [start, direction] = end === 'top' ? [0, 1] : [template.height - 1, -1];
  let sum = 0;
  let ink = 0;
  for (let j = start, count = 1; j >= 0 && j < template.height; j += direction, count++) {
    if (diff[j] === Infinity) break;
    sum += diff[j]!;
    ink += template.ink[j]!;
    if (count >= rows && ink >= part * template.total && sum <= match * ink) best = { rows: count, share: ink / template.total };
  }
  return best;
}

/**
 * The share of the template's ink in its strips (`strips` side by side) that show as they are at
 * (x, y), each strip with ink differing at most `match`: what shows of it where something covers a
 * part of it at a side (a popup, a floating button).
 */
export function stripsShowing(picture: Picture, template: Template, x: number, y: number, match: number, strips = 8): number {
  const { top, bottom, left, right } = onScreen(picture, template, x, y);
  if (bottom <= top) return 0;
  let shown = 0;
  for (let k = 0; k < strips; k++) {
    const from = Math.max(left, Math.floor((k * template.width) / strips));
    const to = Math.min(right, Math.floor(((k + 1) * template.width) / strips));
    let ink = 0;
    let diff = 0;
    for (let j = top; j < bottom; j++) {
      const row = (y + j) * picture.width + x;
      const own = j * template.width;
      for (let i = from; i < to; i++) {
        ink += Math.abs(template.data[own + i]! - template.mean);
        diff += Math.abs(picture.data[row + i]! - template.data[own + i]!);
      }
    }
    if (ink >= 0.04 * template.total && diff <= match * ink) shown += ink;
  }
  return template.total > 0 ? shown / template.total : 0;
}

/**
 * Where the template is in `picture`, from `from` (its top-left in the frame before) heading on by
 * `step`, looked for `reach` rows up and down (and, where it moves, `side` columns aside): `at`,
 * with the share of its ink that shows there (`edge`: only its end away from where it
 * moves, the rest out or under something); `gone` where it is nowhere in its column (none of it is
 * on screen where it was heading, or the page jumped and took it away, or another took its place);
 * undefined where no more than a part of it shows where it stood (something covers the rest).
 */
export type Found = { at: Point; share: number; edge?: { rows: number } } | { gone: true } | undefined;

/** `shown`: how many of its rows showed in the frame before (a part at an edge shows fewer, as many fewer at most as it moved). */
export function locate(picture: Picture, template: Template, from: Point, step: Point, reach: number, side: number, rules = FOLLOW_RULES, shown = template.height): Found {
  const ahead = { x: Math.round(from.x + step.x), y: Math.round(from.y + step.y) };
  const found = (at: Point) => ({ at, share: inkOn(picture, template, at.y) });
  if (differs(picture, template, ahead.x, ahead.y, rules.inside) <= rules.match / 4) return found(ahead);
  let best: { at: Point; total: number } | undefined;
  const consider = (x: number, y: number) => {
    const penalty = (rules.nearer * Math.hypot(x - ahead.x, y - ahead.y)) / Math.max(1, reach);
    const score = differs(picture, template, x, y, rules.inside, Math.min(rules.match, (best?.total ?? Infinity) - penalty));
    if (score !== Infinity && (!best || score + penalty < best.total)) best = { at: { x, y }, total: score + penalty };
  };
  const moving = Math.abs(step.x) >= 1 || Math.abs(step.y) >= 1;
  for (let dy = -reach; dy <= reach; dy++) consider(ahead.x, from.y + dy);
  if (!best && moving) for (let dx = -side; dx <= side; dx++) for (let dy = -reach; dy <= reach; dy++) if (dx !== 0) consider(ahead.x + dx, from.y + dy);
  if (best) return found(best.at);
  // where it moves up or down, the part of it that still shows as it goes out or under something
  // (its end away from where it goes), near where it was heading: it loses no more rows than it moved
  if (Math.abs(step.y) >= 1) {
    let part: { at: Point; share: number; rows: number } | undefined;
    const near = Math.max(3, Math.round(Math.abs(step.y) / 4));
    const rows = Math.max(1, shown - Math.ceil(Math.abs(step.y)) - near);
    for (let dy = -near; dy <= near; dy++) {
      const one = showing(picture, template, ahead.x, ahead.y + dy, step.y < 0 ? 'bottom' : 'top', rules.match, rules.part, rows);
      if (one && (!part || one.share > part.share || (one.share === part.share && Math.abs(dy) < Math.abs(part.at.y - ahead.y)))) part = { at: { x: ahead.x, y: ahead.y + dy }, ...one };
    }
    if (part) return { at: part.at, share: part.share, edge: { rows: part.rows } };
  }
  if (moving && inkOn(picture, template, ahead.y) === 0) return { gone: true };
  // something covers a part of it at a side: the strips that show, near where it was heading
  const near = moving ? Math.max(3, Math.round(Math.hypot(step.x, step.y) / 4)) : 0;
  let covered: { at: Point; share: number } | undefined;
  for (let dy = -near; dy <= near; dy++) {
    const share = stripsShowing(picture, template, ahead.x, ahead.y + dy, rules.match);
    if (share >= rules.covered && (!covered || share > covered.share)) covered = { at: { x: ahead.x, y: ahead.y + dy }, share };
  }
  if (covered) return moving ? covered : undefined;
  // it moved on further than it was looked for (a page jumped): anywhere in its column
  for (let y = -template.height; y < picture.height; y++) consider(ahead.x, y);
  return best ? found((best as { at: Point }).at) : { gone: true };
}

/** A track's time: from half a second before its first read to the read after its last (masks.ts's rule). */
export function spanOf(track: Track, reads: readonly number[], end: number, rules = MASK_RULES): { from: number; to: number } {
  const first = track.sightings[0]!.t;
  const last = track.sightings.at(-1)!.t;
  const next = reads.find((t) => t > last) ?? (Number.isFinite(end) ? end : last);
  return { from: Math.max(0, first - rules.margin), to: Math.max(last + rules.margin, next) };
}

const union = (a: Rect, b: Rect): Rect => {
  const left = Math.min(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const time = (value: number) => Math.round(value * 1000) / 1000;

interface Geometry {
  width: number;
  height: number;
  sx: number;
  sy: number;
  reach: number;
  side: number;
}

/** A thing followed: its picture, where it is, how it moves. */
interface Follower {
  template: Template;
  /** Where the template was taken (compared px) and the rect it stands for there (screen px). */
  origin: Point & { rect: Rect };
  at: Point;
  step: Point;
  /** How many of its rows showed in the frame before. */
  shown: number;
  /** Following it on as it went (out, or under something): frames left. */
  coast?: number;
}

/** How a following ended: it went out or under something, it was gone at once, it could not be told, or it was not followed further. */
type Ended = 'out' | 'gone' | 'lost' | 'limit';

/**
 * Follows `follower` one frame on (or back): its place there, or how it ended. Moves it.
 */
function advance(follower: Follower, picture: Picture, geometry: Geometry, rules: typeof FOLLOW_RULES): Point | Ended {
  if (follower.coast !== undefined) {
    const at = { x: Math.round(follower.at.x + follower.step.x), y: Math.round(follower.at.y + follower.step.y) };
    // where it shows again as it is, it is followed from there
    const back = differs(picture, follower.template, at.x, at.y, rules.inside) <= rules.match ? at : undefined;
    if (back) {
      follower.coast = undefined;
      follower.shown = follower.template.height;
      follower.at = back;
      return back;
    }
    if (follower.coast <= 0 || inkOn(picture, follower.template, at.y) === 0) return 'out';
    follower.coast--;
    follower.at = at;
    return at;
  }
  const found = locate(picture, follower.template, follower.at, follower.step, geometry.reach, geometry.side, rules, follower.shown);
  if (!found) return 'lost';
  if ('gone' in found) return 'gone';
  follower.step = { x: found.at.x - follower.at.x, y: found.at.y - follower.at.y };
  follower.at = found.at;
  follower.shown = found.edge ? found.edge.rows : follower.template.height;
  // little of it shows: it goes on as it went, until it has moved its own height
  if (found.edge && found.share < rules.inside && (follower.step.x !== 0 || follower.step.y !== 0)) follower.coast = Math.ceil(follower.template.height / Math.max(1, Math.abs(follower.step.y)));
  return found.at;
}

interface State {
  track: Track;
  span: { from: number; to: number };
  /** Its reads by frame index in the range. */
  reads: Map<number, Rect>;
  follower?: Follower;
  mode: 'none' | 'on' | 'lost' | 'out';
  stretches: Stretch[];
  /** The time of its last place followed, and of the last read it was followed from or to. */
  last?: number;
  read?: number;
}

/**
 * Each track followed in the frames of `screen` (its reads: `track.sightings`), as the stretches it
 * was on screen, with a place in each frame where it was followed. `reads`: the times of all frames
 * read, `end`: the take's length. Where it could not be told, a stretch has the reads' places.
 */
export async function followTracks(screen: string, tracks: readonly Track[], reads: readonly number[], size: { width: number; height: number }, end: number, rules = FOLLOW_RULES): Promise<Map<Track, Stretch[]>> {
  const result = new Map<Track, Stretch[]>();
  if (tracks.length === 0) return result;
  const width = 2 * Math.round((size.width * rules.scale) / 2);
  const height = size.height;
  const geometry: Geometry = { width, height, sx: width / size.width, sy: 1, reach: Math.round(rules.reach * height), side: Math.round(rules.side * width) };
  const sorted = [...reads].sort((a, b) => a - b);
  // the stretches of time to compare: each track's, from `back` before its first read; those that overlap, one
  const wanted = tracks
    .map((track) => {
      const span = spanOf(track, sorted, end);
      return { track, span, from: Math.max(0, track.sightings[0]!.t - rules.back), to: Math.min(span.to + rules.beyond, Number.isFinite(end) ? end : Infinity) };
    })
    .sort((a, b) => a.from - b.from);
  const ranges: { from: number; to: number; states: State[] }[] = [];
  for (const item of wanted) {
    const state: State = { track: item.track, span: item.span, reads: new Map(), mode: 'none', stretches: [] };
    const range = ranges.at(-1);
    if (range && item.from <= range.to) {
      range.to = Math.max(range.to, item.to);
      range.states.push(state);
    } else ranges.push({ from: item.from, to: item.to, states: [state] });
  }
  for (const range of ranges) {
    for (const state of range.states) {
      for (const sighting of state.track.sightings) state.reads.set(Math.round((sighting.t - range.from) * rules.rate), sighting.rect);
    }
    await followRange(screen, range, geometry, rules);
    for (const state of range.states) result.set(state.track, state.stretches);
  }
  return result;
}

async function followRange(screen: string, range: { from: number; to: number; states: State[] }, geometry: Geometry, rules: typeof FOLLOW_RULES): Promise<void> {
  const { width, height, sx, sy } = geometry;
  const area = width * height;
  const frame = 1 / rules.rate;
  /** The frames before, newest last, for following back. */
  const kept: { t: number; picture: Picture }[] = [];
  const keep = Math.ceil(rules.back * rules.rate) + 1;
  const rectAt = (follower: Follower, at: Point): Rect => {
    const { origin } = follower;
    return [round1(origin.rect[0] + (at.x - origin.x) / sx), round1(origin.rect[1] + (at.y - origin.y) / sy), origin.rect[2], origin.rect[3]];
  };
  const stretchOf = (state: State) => state.stretches.at(-1)!;
  const place = (state: State, t: number) => {
    stretchOf(state).places.push({ at: time(t), rect: rectAt(state.follower!, state.follower!.at) });
    state.last = t;
  };
  const end = (state: State, to: number) => {
    stretchOf(state).to = time(to);
    state.mode = 'out';
  };
  /** A follower from what a read found at `rect` (screen px), in `picture`: its part on screen. */
  const followerOf = (picture: Picture, rect: Rect): Follower | undefined => {
    const x = Math.max(0, Math.floor((rect[0] - rules.pad) * sx));
    const y = Math.max(0, Math.floor((rect[1] - rules.pad) * sy));
    const w = Math.min(picture.width, Math.ceil((rect[0] + rect[2] + rules.pad) * sx)) - x;
    const h = Math.min(picture.height, Math.ceil((rect[1] + rect[3] + rules.pad) * sy)) - y;
    if (w <= 0 || h <= 0) return undefined;
    const template = templateOf(picture, x, y, w, h);
    if (template.total < 4 * w * h) return undefined; // next to nothing to tell it by
    return { template, origin: { x, y, rect }, at: { x, y }, step: { x: 0, y: 0 }, shown: h };
  };
  /** Follows a new follower back from the frame at `t` through the frames kept, down to `stop`: its places, and how it came. */
  const followBack = (follower: Follower, t: number, stop: number): { places: Place[]; came: Ended } => {
    const places: Place[] = [];
    const back: Follower = { ...follower, at: { ...follower.at }, step: { x: 0, y: 0 } };
    for (let k = kept.length - 1; k >= 0; k--) {
      const { t: when, picture } = kept[k]!;
      if (when > t - frame / 2) continue;
      if (when <= stop + frame / 2 || t - when > rules.back + frame / 2) return { places, came: 'limit' };
      const moved = advance(back, picture, geometry, rules);
      if (typeof moved === 'string') return { places, came: moved };
      places.unshift({ at: time(when), rect: rectAt(back, moved) });
    }
    return { places, came: 'limit' };
  };
  const onFrame = (k: number, picture: Picture) => {
    const t = range.from + k * frame;
    for (const state of range.states) {
      const read = state.reads.get(k);
      if (state.mode === 'none' && !read) continue;
      // after the read that no longer found it, only as long as the following does
      const after = t > state.span.to + frame / 2;
      if (after && (state.mode === 'lost' || t > state.span.to + rules.beyond + frame / 2)) {
        if (state.mode === 'on' || state.mode === 'lost') end(state, Math.max(state.span.to, (state.last ?? 0) + frame));
        continue;
      }
      const open = state.mode === 'on' || state.mode === 'lost';
      // on to this frame: where the following has it now, or how it ended
      let here: Rect | undefined;
      let ended: Ended | undefined;
      if (open && state.follower) {
        if (state.mode === 'lost') state.follower.step = { x: 0, y: 0 };
        const moved = advance(state.follower, picture, geometry, rules);
        if (typeof moved === 'string') ended = moved;
        else here = rectAt(state.follower, moved);
      }
      if (!read) {
        if (here) {
          state.mode = 'on';
          place(state, t);
        } else if (ended === 'out' || ended === 'gone') end(state, after ? Math.max(state.span.to, t) : t);
        else if (ended === 'lost' && after) end(state, Math.max(state.span.to, (state.last ?? 0) + frame));
        else if (ended === 'lost') state.mode = 'lost';
        continue;
      }
      // a read: where the following has it too, it goes on, its picture taken again there (the text
      // may have changed a little) unless only a part of it shows, the rect grown to hold the read's
      const agrees = here && Math.abs(here[0] - read[0]) <= rules.agree && Math.abs(here[1] - read[1]) <= rules.agree && Math.abs(here[1] + here[3] - read[1] - read[3]) <= rules.agree;
      if (agrees) {
        const follower = state.follower!;
        const grown = union(here!, read);
        // a read whose box holds more of it (Vision's boxes jitter around text that stands): where it
        // stood since it last moved, it is that larger too, so its mask grows instead of moving
        const same = (a: Rect, b: Rect) => a.every((value, i) => value === b[i]);
        if (!same(grown, here!)) {
          const { places } = stretchOf(state);
          for (let k = places.length - 1; k >= 0 && same(places[k]!.rect, here!); k--) places[k] = { at: places[k]!.at, rect: grown };
        }
        const fresh = follower.coast === undefined ? followerOf(picture, grown) : undefined;
        if (fresh) state.follower = { ...fresh, step: follower.step };
        state.mode = 'on';
        state.read = t;
        place(state, t);
        continue;
      }
      // else it is followed again from the read: back to the read before where this stretch goes on
      // (what was followed since then is not trusted), else as far as it came from
      if (open && state.read !== undefined) {
        const since = state.read;
        const stretch = stretchOf(state);
        stretch.places = stretch.places.filter((one) => one.at <= time(since));
      }
      const fresh = followerOf(picture, read);
      const stop = open ? (state.read ?? -Infinity) : (state.last ?? -Infinity);
      const back = fresh ? followBack(fresh, t, stop) : { places: [], came: 'limit' as Ended };
      if (!open) {
        const first = back.places[0]?.at ?? t;
        // it came in (from off screen or from under something) or was there at once as the page
        // moved: from then; else from half a second before the read, as before
        const came = back.came === 'out' || back.came === 'gone';
        state.stretches.push({ from: time(Math.max(0, came ? first - frame : Math.min(first, t - MASK_RULES.margin))), to: state.span.to, places: [] });
      }
      stretchOf(state).places.push(...back.places);
      state.read = t;
      if (fresh) {
        state.follower = fresh;
        state.mode = 'on';
        place(state, t);
      } else {
        state.follower = undefined;
        state.mode = 'lost';
        stretchOf(state).places.push({ at: time(t), rect: read });
        state.last = t;
      }
    }
  };
  let pending: Buffer = Buffer.alloc(0);
  let index = 0;
  await runFfmpeg(['-ss', range.from.toFixed(3), '-t', (range.to - range.from + frame).toFixed(3), '-i', screen, '-map', '0:v:0', '-vf', `fps=${rules.rate},scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', '-'], (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= area) {
      const picture: Picture = { width, height, data: new Uint8Array(pending.subarray(0, area)) };
      pending = pending.subarray(area);
      onFrame(index, picture);
      kept.push({ t: range.from + index * frame, picture });
      if (kept.length > keep) kept.shift();
      index++;
    }
  });
  for (const state of range.states) if (state.mode === 'on' || state.mode === 'lost') end(state, Math.max(state.span.to, state.mode === 'on' ? (state.last ?? 0) + frame : 0));
}
