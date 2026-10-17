// Where the screen changed between two moments: the zoom on Claude's answer.
import type { Rect } from '@cuttle/project';
import type { Gray } from './media';

/** A pixel counts as changed when its grey value moved more than this. */
const THRESHOLD = 24;
/** Fewer changed pixels than this share of the picture is noise (a caret, a clock). */
const MIN_SHARE = 0.002;
/** The box spans the changed pixels from this quantile to its complement, so stray pixels do not stretch it. */
const QUANTILE = 0.02;

/** The box (in the grey pictures' pixels) around what changed between `before` and `after`. */
export function changedRegion(before: Gray, after: Gray): { x: number; y: number; width: number; height: number } | undefined {
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const i = y * before.width + x;
      if (Math.abs(before.data[i]! - after.data[i]!) > THRESHOLD) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < MIN_SHARE * before.width * before.height) return undefined;
  const bounds = (values: number[]) => {
    values.sort((a, b) => a - b);
    const low = values[Math.floor(QUANTILE * (values.length - 1))]!;
    const high = values[Math.ceil((1 - QUANTILE) * (values.length - 1))]!;
    return [low, high] as const;
  };
  const [x0, x1] = bounds(xs);
  const [y0, y1] = bounds(ys);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Padding around the changed box, as a share of the screen's width. */
const PADDING = 0.06;
/** A zoom shows at least this share of the screen's width. */
const MIN_WIDTH = 0.35;
/** Above this share of the screen's area a zoom is no focus at all: none is made. */
const MAX_AREA = 0.75;

/**
 * The zoom rect (screen pixels) for a changed box found in grey pictures `grayWidth` pixels wide,
 * padded and at least `MIN_WIDTH` wide, inside the screen; undefined when it would cover most of it.
 * The timeline fits it to the screen's aspect.
 */
export function zoomRect(region: { x: number; y: number; width: number; height: number }, grayWidth: number, screen: { width: number; height: number }): Rect | undefined {
  const scale = screen.width / grayWidth;
  const pad = PADDING * screen.width;
  let x = region.x * scale - pad;
  let y = region.y * scale - pad;
  let width = region.width * scale + 2 * pad;
  let height = region.height * scale + 2 * pad;
  if (width < MIN_WIDTH * screen.width) {
    x -= (MIN_WIDTH * screen.width - width) / 2;
    width = MIN_WIDTH * screen.width;
  }
  width = Math.min(width, screen.width);
  height = Math.min(height, screen.height);
  x = Math.min(Math.max(0, x), screen.width - width);
  y = Math.min(Math.max(0, y), screen.height - height);
  if (width * height > MAX_AREA * screen.width * screen.height) return undefined;
  return [Math.round(x), Math.round(y), Math.round(width), Math.round(height)];
}
