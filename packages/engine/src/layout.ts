import type { Look, Rect, StillMotion, TextPosition } from '@cuttle/project';
import { easeInOutCubic } from '@cuttle/timeline';

export interface Size {
  width: number;
  height: number;
}

/** Chrome sizes are given in units: one unit is 1 px when the output's short side is 1080 px. */
export function unitFor(output: Size): number {
  return Math.min(output.width, output.height) / 1080;
}

/** Space between the window and the output edge, in units. */
export const WINDOW_PADDING = 64;

export interface WindowLayout {
  /** The whole window in output px, title bar included. */
  window: Rect;
  /** Where the screen or still image is drawn, in output px. */
  content: Rect;
  /** Corner radius of the window in output px. */
  radius: number;
  /** Title bar height in output px; 0 without one. */
  titleBar: number;
}

/**
 * Centres a window whose content has the aspect ratio `contentAspect` (width / height) in the
 * output, `WINDOW_PADDING` units from the edges. `chrome` sizes are in units. Without chrome the
 * content fills the output (letterboxed) with square corners. Results are whole pixels.
 */
export function windowLayout(
  output: Size,
  contentAspect: number,
  chrome: { titleBar: number; radius: number } | null,
): WindowLayout {
  const unit = unitFor(output);
  const padding = chrome ? WINDOW_PADDING * unit : 0;
  const titleBar = chrome ? Math.round(chrome.titleBar * unit) : 0;
  const availableWidth = output.width - 2 * padding;
  const availableHeight = output.height - 2 * padding - titleBar;
  let width = availableWidth;
  let height = width / contentAspect;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * contentAspect;
  }
  width = Math.round(width);
  height = Math.round(height);
  const x = Math.round((output.width - width) / 2);
  const y = Math.round((output.height - height - titleBar) / 2);
  const radius = chrome ? Math.min(chrome.radius * unit, width / 2, (height + titleBar) / 2) : 0;
  return { window: [x, y, width, height + titleBar], content: [x, y + titleBar, width, height], radius, titleBar };
}

/** Maps a point in source px to output px, for a screen cropped to `zoom` and shown in `content`. */
export function sourceToOutput(x: number, y: number, zoom: Rect, content: Rect): [x: number, y: number] {
  return [content[0] + ((x - zoom[0]) / zoom[2]) * content[2], content[1] + ((y - zoom[1]) / zoom[3]) * content[3]];
}

/** Maps a rect in source px to output px, like `sourceToOutput`. */
export function sourceRectToOutput(rect: Rect, zoom: Rect, content: Rect): Rect {
  const [x, y] = sourceToOutput(rect[0], rect[1], zoom, content);
  return [x, y, (rect[2] / zoom[2]) * content[2], (rect[3] / zoom[3]) * content[3]];
}

/**
 * Where a mask goes in output px, so the filtered edge of what it hides cannot peek out as a
 * hairline: the mask covers every source pixel it touches, and its mapped rect grows to whole
 * pixels plus one on every side, more under strong zoom, where bilinear magnification spreads
 * each source pixel half a pixel (in source px) past its edge.
 */
export function maskRectToOutput(rect: Rect, zoom: Rect, content: Rect): Rect {
  const sx = Math.floor(rect[0]);
  const sy = Math.floor(rect[1]);
  const covered: Rect = [sx, sy, Math.ceil(rect[0] + rect[2]) - sx, Math.ceil(rect[1] + rect[3]) - sy];
  const [x, y, w, h] = sourceRectToOutput(covered, zoom, content);
  // The extra pixel below covers 1.5 output px of spread, enough up to 3 output px per source px.
  const spreadX = Math.max(0, (0.5 * content[2]) / zoom[2] - 1.5);
  const spreadY = Math.max(0, (0.5 * content[3]) / zoom[3] - 1.5);
  const left = Math.floor(x - spreadX) - 1;
  const top = Math.floor(y - spreadY) - 1;
  return [left, top, Math.ceil(x + w + spreadX) + 1 - left, Math.ceil(y + h + spreadY) + 1 - top];
}

/** A rect in image px as texture coordinates `[u, v, w, h]`, with v = 0 at the image's top row. */
export function uvRect(rect: Rect, image: Size): Rect {
  return [rect[0] / image.width, rect[1] / image.height, rect[2] / image.width, rect[3] / image.height];
}

/** Cursor height in source px on a screen 1080 px tall; taller screens get a proportionally bigger cursor. */
export const CURSOR_SOURCE_PX = 32;

/** Cursor height in output px: `look.cursor.size` times the base size, scaled with the zoom like the screen. */
export function cursorSizePx(screen: Size, size: number, zoom: Rect, content: Rect): number {
  return CURSOR_SOURCE_PX * size * (screen.height / 1080) * (content[2] / zoom[2]);
}

/** Space between the webcam bubble and the output edge, in units. */
export const WEBCAM_MARGIN = 40;

/** The webcam bubble's square in output px; `size` is its diameter as a share of the output's short side. */
export function webcamRect(output: Size, corner: Look['webcam']['corner'], size: number): Rect {
  const unit = unitFor(output);
  const diameter = Math.round(size * Math.min(output.width, output.height));
  const margin = Math.round(WEBCAM_MARGIN * unit);
  const x = corner.endsWith('left') ? margin : output.width - margin - diameter;
  const y = corner.startsWith('top') ? margin : output.height - margin - diameter;
  return [x, y, diameter, diameter];
}

/** Space between a text overlay and the output edge, in units. */
export const OVERLAY_MARGIN = 56;

function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/**
 * Where a text overlay sprite goes in the output: `position` picks the row, `align` the column.
 * A top or bottom text that would cover `avoid` (the webcam bubble) moves vertically clear of it,
 * half a margin away; a centred row stays.
 */
export function placeOverlay(output: Size, sprite: Size, position: TextPosition, align: 'center' | 'left', avoid?: Rect): Rect {
  const margin = Math.round(OVERLAY_MARGIN * unitFor(output));
  const x = align === 'left' ? margin : Math.round((output.width - sprite.width) / 2);
  let y =
    position === 'top'
      ? margin
      : position === 'bottom'
        ? output.height - margin - sprite.height
        : Math.round((output.height - sprite.height) / 2);
  if (avoid && position !== 'center' && overlaps([x, y, sprite.width, sprite.height], avoid)) {
    const gap = Math.round(margin / 2);
    y = position === 'bottom' ? avoid[1] - gap - sprite.height : avoid[1] + avoid[3] + gap;
  }
  return [x, y, sprite.width, sprite.height];
}

/** Space between the speed badge and the content's top-right corner, in units. */
export const BADGE_MARGIN = 16;

/** The speed badge sits in the top-right corner of the content, or left of `avoid` (the webcam bubble) when it would cover it. */
export function placeBadge(content: Rect, sprite: Size, unit: number, avoid?: Rect): Rect {
  const margin = Math.round(BADGE_MARGIN * unit);
  const badge: Rect = [Math.round(content[0] + content[2] - margin - sprite.width), Math.round(content[1] + margin), sprite.width, sprite.height];
  if (avoid && overlaps(badge, avoid)) badge[0] = Math.round(avoid[0] - margin - sprite.width);
  return badge;
}

/** How far a `kenburns` still zooms in by the end of its scene. */
export const KENBURNS_ZOOM = 1.08;

/**
 * The part of a still image (image px) shown in a view of size `view` at `progress` (0..1).
 * The image fills the view's width from its top; an image too short for that covers the view,
 * centred. `scroll` pans to the bottom, `kenburns` zooms into the centre, both eased.
 */
export function stillCrop(image: Size, view: Size, motion: StillMotion, progress: number): Rect {
  const viewAspect = view.width / view.height;
  let width = image.width;
  let height = width / viewAspect;
  if (height > image.height) {
    height = image.height;
    width = height * viewAspect;
  }
  const x = (image.width - width) / 2;
  const eased = easeInOutCubic(progress);
  if (motion === 'scroll') return [x, eased * (image.height - height), width, height];
  if (motion === 'kenburns') {
    const zoom = 1 + (KENBURNS_ZOOM - 1) * eased;
    return [x + (width - width / zoom) / 2, (height - height / zoom) / 2, width / zoom, height / zoom];
  }
  return [x, 0, width, height];
}
