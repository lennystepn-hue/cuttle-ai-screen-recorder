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
  /**
   * What the content, the masks and the cursor are clipped to, in output px, with its corner radius:
   * the window (its rounded corners), or a device's screen inside its bezel.
   */
  clip: Rect;
  clipRadius: number;
}

/**
 * Centres a window whose content has the aspect ratio `contentAspect` (width / height) in the
 * output, `WINDOW_PADDING` units from the edges. `chrome` sizes are in units. Without chrome the
 * content fills the output (letterboxed) with square corners. A `device` has no title bar but a
 * bezel all round, its bezel and corner radius shares of the screen's short side (a phone held
 * either way). Results are whole pixels.
 */
export function windowLayout(
  output: Size,
  contentAspect: number,
  chrome: { titleBar: number; radius: number; device?: { bezel: number; radius: number } } | null,
): WindowLayout {
  const unit = unitFor(output);
  const padding = chrome ? WINDOW_PADDING * unit : 0;
  if (chrome?.device) {
    const { bezel, radius } = chrome.device;
    // the screen as large as the output allows with the bezel (a share of its short side) around it
    const short = Math.min(contentAspect, 1);
    const exact = Math.min((output.width - 2 * padding) / (contentAspect + 2 * bezel * short), (output.height - 2 * padding) / (1 + 2 * bezel * short));
    const height = Math.round(exact);
    const width = Math.round(exact * contentAspect);
    const band = Math.round(bezel * Math.min(width, height));
    const x = Math.round((output.width - width) / 2);
    const y = Math.round((output.height - height) / 2);
    const window: Rect = [x - band, y - band, width + 2 * band, height + 2 * band];
    const outer = Math.min(radius * Math.min(window[2], window[3]), window[2] / 2, window[3] / 2);
    return { window, content: [x, y, width, height], radius: outer, titleBar: 0, clip: [x, y, width, height], clipRadius: Math.max(0, outer - band) };
  }
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
  const window: Rect = [x, y, width, height + titleBar];
  return { window, content: [x, y + titleBar, width, height], radius, titleBar, clip: window, clipRadius: radius };
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

/**
 * The webcam bubble's square in output px; `size` is its diameter as a share of the output's short
 * side. A `position` puts its centre there (shares of the output), kept inside the output; else it
 * sits in its `corner`, a margin from the edges.
 */
export function webcamRect(output: Size, webcam: Pick<Look['webcam'], 'corner' | 'size' | 'position'>): Rect {
  const unit = unitFor(output);
  const diameter = Math.round(webcam.size * Math.min(output.width, output.height));
  if (webcam.position) {
    const x = Math.round(Math.min(Math.max(webcam.position.x * output.width - diameter / 2, 0), output.width - diameter));
    const y = Math.round(Math.min(Math.max(webcam.position.y * output.height - diameter / 2, 0), output.height - diameter));
    return [x, y, diameter, diameter];
  }
  const margin = Math.round(WEBCAM_MARGIN * unit);
  const x = webcam.corner.endsWith('left') ? margin : output.width - margin - diameter;
  const y = webcam.corner.startsWith('top') ? margin : output.height - margin - diameter;
  return [x, y, diameter, diameter];
}

/** Space between the watermark and the output's edges, in units. */
export const WATERMARK_MARGIN = 40;

/**
 * The watermark's rect in output px: `size` is its height as a share of the output's short side,
 * `aspect` its own (width / height); in its `corner`, a margin from the edges, and past the
 * webcam bubble (`avoid`) when they share a corner (above it at the bottom, below it at the top).
 */
export function watermarkRect(output: Size, watermark: Pick<Look['watermark'], 'corner' | 'size'>, aspect: number, avoid?: Rect): Rect {
  const unit = unitFor(output);
  const margin = Math.round(WATERMARK_MARGIN * unit);
  const height = Math.round(watermark.size * Math.min(output.width, output.height));
  const width = Math.min(Math.round(height * aspect), output.width - 2 * margin);
  const x = watermark.corner.endsWith('left') ? margin : output.width - margin - width;
  let y = watermark.corner.startsWith('top') ? margin : output.height - margin - height;
  const rect: Rect = [x, y, width, height];
  if (avoid && overlaps(rect, avoid)) y = watermark.corner.startsWith('top') ? avoid[1] + avoid[3] + Math.round(margin / 2) : avoid[1] - height - Math.round(margin / 2);
  return [x, y, width, height];
}

/** Space between a text overlay and the output edge, in units. */
export const OVERLAY_MARGIN = 56;

function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/**
 * Where a text overlay sprite goes in the output: `position` picks the row, `align` the column.
 * A top or bottom text moves vertically past each rect of `avoid` it would cover (the webcam
 * bubble, the badge), half a margin away, nearest to its edge first; a centred row stays.
 */
export function placeOverlay(output: Size, sprite: Size, position: TextPosition, align: 'center' | 'left', avoid: readonly Rect[] = []): Rect {
  const margin = Math.round(OVERLAY_MARGIN * unitFor(output));
  const x = align === 'left' ? margin : Math.round((output.width - sprite.width) / 2);
  let y =
    position === 'top'
      ? margin
      : position === 'bottom'
        ? output.height - margin - sprite.height
        : Math.round((output.height - sprite.height) / 2);
  if (position !== 'center') {
    const gap = Math.round(margin / 2);
    const nearestFirst = [...avoid].sort((a, b) => (position === 'bottom' ? b[1] + b[3] - (a[1] + a[3]) : a[1] - b[1]));
    for (const rect of nearestFirst) {
      if (!overlaps([x, y, sprite.width, sprite.height], rect)) continue;
      y = position === 'bottom' ? rect[1] - gap - sprite.height : rect[1] + rect[3] + gap;
    }
  }
  return [x, y, sprite.width, sprite.height];
}

/** Space between the speed badge and the content's top-right corner, in units. */
export const BADGE_MARGIN = 16;

/**
 * The speed badge sits in the top-right corner of the content. When it would cover `avoid` (the
 * webcam bubble) it moves left of it, or below it if that would leave the content.
 */
export function placeBadge(content: Rect, sprite: Size, unit: number, avoid?: Rect): Rect {
  const margin = Math.round(BADGE_MARGIN * unit);
  const badge: Rect = [Math.round(content[0] + content[2] - margin - sprite.width), Math.round(content[1] + margin), sprite.width, sprite.height];
  if (avoid && overlaps(badge, avoid)) {
    const left = Math.round(avoid[0] - margin - sprite.width);
    if (left >= content[0] + margin) badge[0] = left;
    else badge[1] = Math.round(avoid[1] + avoid[3] + margin);
  }
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
