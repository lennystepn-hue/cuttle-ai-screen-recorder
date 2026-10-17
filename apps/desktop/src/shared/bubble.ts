// The webcam bubble moved and resized on the video: where a drag puts it, and when it snaps to a
// corner (its place without a position, a margin from the edges) or to the middle of the video. Pure:
// output pixels in, the look's new webcam fields out.
import type { Look, Rect } from '@cuttle/project';
import { WEBCAM_CORNERS } from '@cuttle/project';

type Webcam = Look['webcam'];
type Corner = Webcam['corner'];
type Size = { width: number; height: number };

/** Output px within which a dragged bubble snaps to a corner's place or to the middle. */
export const SNAP_PX = 28;
/** The bubble's size, as a share of the output's short side (the schema allows up to 0.5). */
export const MIN_SIZE = 0.08;
export const MAX_SIZE = 0.5;

/** Where the bubble goes after a move: a corner, or a position with the guides it snapped to. */
export type Moved = { corner: Corner } | { position: { x: number; y: number }; guides: { x?: number; y?: number } };

/**
 * The bubble moved by `dx`, `dy` output px from `rect` (where it was at the drag's start): to a
 * corner's place when its centre comes near one (`cornerRect` gives a corner's bubble), else its
 * centre as a share of the output, kept inside it, snapped to the middle across and down.
 */
export function movedBubble(output: Size, rect: Rect, dx: number, dy: number, cornerRect: (corner: Corner) => Rect): Moved {
  const centre = (box: Rect) => ({ x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 });
  const half = rect[2] / 2;
  const x = Math.min(Math.max(rect[0] + half + dx, half), output.width - half);
  const y = Math.min(Math.max(rect[1] + half + dy, half), output.height - half);
  for (const corner of WEBCAM_CORNERS) {
    const spot = centre(cornerRect(corner));
    if (Math.hypot(spot.x - x, spot.y - y) <= SNAP_PX) return { corner };
  }
  const guides: { x?: number; y?: number } = {};
  let cx = x;
  let cy = y;
  if (Math.abs(x - output.width / 2) <= SNAP_PX) cx = guides.x = output.width / 2;
  if (Math.abs(y - output.height / 2) <= SNAP_PX) cy = guides.y = output.height / 2;
  return { position: { x: round(cx / output.width), y: round(cy / output.height) }, guides };
}

/** The handles at the bubble's corners, and which way each one grows it. */
export const HANDLES = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] } as const;
export type Handle = keyof typeof HANDLES;

/**
 * The bubble's size after its `handle` was dragged by `dx`, `dy` output px: dragging outwards along
 * the handle's diagonal grows it, inwards shrinks it, within MIN_SIZE and MAX_SIZE.
 */
export function resizedBubble(output: Size, rect: Rect, handle: Handle, dx: number, dy: number): number {
  const [sx, sy] = HANDLES[handle];
  const grown = rect[2] + (sx * dx + sy * dy) / 2;
  const short = Math.min(output.width, output.height);
  return round(Math.min(Math.max(grown / short, MIN_SIZE), MAX_SIZE));
}

const round = (value: number) => Math.round(value * 1000) / 1000;
