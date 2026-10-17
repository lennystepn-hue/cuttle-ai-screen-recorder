// The crop: the part of the screen a clip shows, so a browser's tabs and bars, a taskbar or a side
// bar stay out of the video. It comes from the recorder's `area` events (the content area of the
// window shown) where there are any, else from the picture: the edge bands that hardly change while
// the middle does. Pure: `suggest` reads the picture's statistics for it.
import type { InputEvent, Rect } from '@cuttle/project';

export const CROP_RULES = {
  /** A content area that moved less than this (px) is the same… */
  slack: 8,
  /** …and it counts once it held this long (source s); a shorter one goes to the stretch before. */
  hold: 2,
  /** No crop when it covers this share of the screen or more… */
  maxShare: 0.95,
  /** …or less than this. */
  minShare: 0.3,
  /** An area less than this share inside the screen is another monitor's or window's: none. */
  inside: 0.9,
  /** An edge band: rows (columns) from the edge inward that change less than this share of the middle's… */
  band: 0.05,
  /** …where the middle changes at least this share of its pixels between frames (else no crop). */
  minMiddle: 0.002,
  /** No piece of a clip shorter than this (source s): it goes to its neighbour. */
  minPiece: 0.5,
};

/** A content area as a crop of the screen: the part inside it, when that is neither (nearly) all of the screen nor too little. */
export function cropOf(rect: Rect | null | undefined, screen: { width: number; height: number }, rules = CROP_RULES): Rect | undefined {
  if (!rect) return undefined;
  const [x, y, width, height] = rect;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(screen.width, x + width);
  const bottom = Math.min(screen.height, y + height);
  if (right <= left || bottom <= top) return undefined;
  const inside = (right - left) * (bottom - top);
  if (inside < rules.inside * width * height) return undefined;
  const share = inside / (screen.width * screen.height);
  if (share >= rules.maxShare || share < rules.minShare) return undefined;
  return [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top)];
}

/** A stretch of the take (source seconds) with the crop it gets, or none. */
export interface CropStretch {
  from: number;
  to: number;
  rect?: Rect;
}

const near = (a: Rect | undefined, b: Rect | undefined, slack: number) => a === b || (!!a && !!b && a.every((value, k) => Math.abs(value - b[k]!) <= slack));

/**
 * The take's stretches by the content area the recorder saw, each with its crop (or none), from 0 to
 * `duration`; none without `area` events. Areas within `slack` are one; one that held less than `hold`
 * belongs to the stretch before it.
 */
export function areaStretches(events: readonly InputEvent[], duration: number, screen: { width: number; height: number }, rules = CROP_RULES): CropStretch[] {
  const areas = events.flatMap((event) => (event.type === 'area' ? [event] : [])).sort((a, b) => a.t - b.t);
  const stretches: CropStretch[] = [];
  areas.forEach((area, i) => {
    const stretch = { from: i === 0 ? 0 : area.t, to: areas[i + 1]?.t ?? duration, rect: cropOf(area.rect, screen, rules) };
    if (stretch.to <= stretch.from) return;
    const last = stretches.at(-1);
    if (last && (near(last.rect, stretch.rect, rules.slack) || stretch.to - stretch.from < rules.hold)) last.to = stretch.to;
    else stretches.push(stretch);
  });
  // a short first one goes to the next
  if (stretches.length > 1 && stretches[0]!.to - stretches[0]!.from < rules.hold) {
    stretches[1]!.from = stretches[0]!.from;
    stretches.shift();
  }
  return stretches.map(({ rect, ...span }) => ({ ...span, ...(rect && { rect }) }));
}

/**
 * Each clip cut where the crop changes inside it (at the stretches' edges), each piece with its
 * crop; a piece shorter than `minPiece` goes to its neighbour.
 */
export function cropPieces<T extends { from: number; to: number }>(clips: readonly T[], stretches: readonly CropStretch[], rules = CROP_RULES): { clip: T; from: number; to: number; rect?: Rect }[] {
  return clips.flatMap((clip) => {
    const pieces: { clip: T; from: number; to: number; rect?: Rect }[] = [];
    for (const stretch of stretches) {
      if (stretch.to <= clip.from || stretch.from >= clip.to) continue;
      const piece = { clip, from: Math.max(clip.from, stretch.from), to: Math.min(clip.to, stretch.to), ...(stretch.rect && { rect: stretch.rect }) };
      const last = pieces.at(-1);
      if (last && (near(last.rect, piece.rect, 0) || piece.to - piece.from < rules.minPiece)) last.to = piece.to;
      else pieces.push(piece);
    }
    if (pieces.length === 0) return [{ clip, from: clip.from, to: clip.to }];
    if (pieces.length > 1 && pieces[0]!.to - pieces[0]!.from < rules.minPiece) {
      pieces[1]!.from = pieces[0]!.from;
      pieces.shift();
    }
    pieces[0]!.from = clip.from;
    pieces.at(-1)!.to = clip.to;
    return pieces;
  });
}

/** How much each row and column of the picture changed between frames: a share of its pixels, on average. */
export interface ScreenBands {
  rows: readonly number[];
  cols: readonly number[];
  frames: number;
}

/**
 * The crop from the picture alone: the bands from each edge inward whose rows (columns) change
 * less than `band` as much as the middle's. None when the middle hardly changes, or when what is
 * left is no crop (`cropOf`).
 */
export function bandCrop(bands: ScreenBands, screen: { width: number; height: number }, rules = CROP_RULES): Rect | undefined {
  const { rows, cols } = bands;
  if (bands.frames < 2 || rows.length === 0 || cols.length === 0) return undefined;
  const middle = (list: readonly number[]) => {
    const part = list.slice(Math.floor(list.length * 0.3), Math.ceil(list.length * 0.7));
    return part.reduce((sum, value) => sum + value, 0) / Math.max(1, part.length);
  };
  const [rowMiddle, colMiddle] = [middle(rows), middle(cols)];
  if (Math.min(rowMiddle, colMiddle) < rules.minMiddle) return undefined;
  const band = (list: readonly number[], limit: number, fromEnd: boolean) => {
    let count = 0;
    for (const value of fromEnd ? [...list].reverse() : list) {
      if (value > limit) break;
      count++;
    }
    return count;
  };
  const top = band(rows, rowMiddle * rules.band, false);
  const bottom = band(rows, rowMiddle * rules.band, true);
  const left = band(cols, colMiddle * rules.band, false);
  const right = band(cols, colMiddle * rules.band, true);
  if (top + bottom >= rows.length || left + right >= cols.length) return undefined;
  const [sx, sy] = [screen.width / cols.length, screen.height / rows.length];
  return cropOf([left * sx, top * sy, (cols.length - left - right) * sx, (rows.length - top - bottom) * sy], screen, rules);
}
