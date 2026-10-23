// Annotations over a clip's screen: arrows, boxes, ellipses, highlighter strokes, a spotlight and a
// magnifier, drawn into a canvas the output's size, frame by frame, where the screen's content shows
// now (under a zoom too), clipped to the window. Each draws itself in: an arrow grows to its head, a
// box and an ellipse trace their outline, a highlighter sweeps across, a spotlight dims the rest, a
// magnifier opens; its callout comes in beside it.
import type { Mask, Rect } from '@cuttle/project';
import type { ActiveAnnotation } from '@cuttle/timeline';
import { sourceRectToOutput, sourceToOutput, type Size, type WindowLayout } from './layout';
import { cssFont } from './sprites';

/** Sizes in units (1 px at 1080p). */
const LOOK = {
  stroke: 6,
  head: 26,
  /** A box's corners, and the spotlight hole's. */
  radius: 10,
  /** How far a box and an ellipse sit outside what they mark. */
  pad: 8,
  highlight: 0.38,
  spotlight: 0.62,
  /** The spotlight hole's soft edge. */
  feather: 18,
  ring: 5,
  font: 26,
  callout: { padX: 16, padY: 9, radius: 12, gap: 14 },
  shadow: { blur: 18, y: 6, color: 'rgba(0, 0, 0, 0.35)' },
};

/** What the annotations of a frame are drawn on: where the screen shows and how big, the masks over it, the frame for a magnifier. */
export interface AnnotationStage {
  zoom: Rect;
  layout: WindowLayout;
  /** Output px per unit. */
  unit: number;
  /** The colour of an annotation that names none. */
  accent: string;
  /** The masks over the screen now: a magnifier hides what they hide. */
  masks: readonly Mask[];
  /** The screen's frame, for a magnifier (none: its lens shows nothing). */
  screen?: CanvasImageSource;
  screenSize: Size;
}

/** `#rrggbb` at `alpha`. */
function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** White text on a dark colour, near-black on a light one. */
function textOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 160 ? '#111114' : '#FFFFFF';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The window's content area as the clip: its rect, with the window's rounded corners. */
function clipToContent(ctx: OffscreenCanvasRenderingContext2D, layout: WindowLayout): void {
  ctx.beginPath();
  ctx.rect(...layout.content);
  ctx.clip();
  ctx.beginPath();
  ctx.roundRect(...layout.clip, layout.clipRadius);
  ctx.clip();
}

/** A callout's pill beside `box` (output px): above it, else below where there is no room. */
function drawCallout(ctx: OffscreenCanvasRenderingContext2D, text: string, box: Rect, color: string, u: number, content: Rect, appear: number): void {
  const { padX, padY, radius, gap } = LOOK.callout;
  ctx.font = cssFont(600, Math.round(LOOK.font * u));
  const width = Math.ceil(ctx.measureText(text).width) + 2 * padX * u;
  const height = Math.round(LOOK.font * u * 1.25) + 2 * padY * u;
  let x = box[0] + box[2] / 2 - width / 2;
  x = Math.max(content[0] + gap * u, Math.min(x, content[0] + content[2] - width - gap * u));
  const above = box[1] - gap * u - height;
  const y = above >= content[1] + gap * u ? above : box[1] + box[3] + gap * u;
  ctx.save();
  ctx.globalAlpha *= appear;
  ctx.translate(0, (1 - appear) * 8 * u * (y < box[1] ? 1 : -1));
  ctx.shadowColor = LOOK.shadow.color;
  ctx.shadowBlur = LOOK.shadow.blur * u;
  ctx.shadowOffsetY = LOOK.shadow.y * u;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = textOn(color);
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX * u, y + height / 2);
  ctx.restore();
}

/** The average colour of a stretch of the frame (what a fill mask shows in a magnifier). */
function averageColor(screen: CanvasImageSource, rect: Rect): string {
  const one = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  one.drawImage(screen, rect[0], rect[1], Math.max(1, rect[2]), Math.max(1, rect[3]), 0, 0, 1, 1);
  const [r, g, b] = one.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** A magnifier over `rect`: its content `zoom` times larger in a round lens, with what masks hide still hidden. */
function drawMagnifier(ctx: OffscreenCanvasRenderingContext2D, rect: Rect, zoom: number, color: string, stage: AnnotationStage, progress: number): Rect {
  const u = stage.unit;
  const [x, y, w, h] = sourceRectToOutput(rect, stage.zoom, stage.layout.content);
  const cx = x + w / 2;
  const cy = y + h / 2;
  // output px per source px in the lens
  const scale = (stage.layout.content[2] / stage.zoom[2]) * zoom;
  const radius = (Math.max(w, h) * zoom * lerp(0.7, 1, progress)) / 2;
  const lens: Rect = [cx - radius, cy - radius, 2 * radius, 2 * radius];
  ctx.save();
  ctx.shadowColor = LOOK.shadow.color;
  ctx.shadowBlur = LOOK.shadow.blur * u * 1.5;
  ctx.shadowOffsetY = LOOK.shadow.y * u;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (stage.screen) {
    // the source around the rect's centre that fills the lens
    const half = radius / scale;
    const srcX = rect[0] + rect[2] / 2;
    const srcY = rect[1] + rect[3] / 2;
    const into = (sx: number, sy: number): [number, number] => [cx + (sx - srcX) * scale, cy + (sy - srcY) * scale];
    ctx.imageSmoothingQuality = 'high';
    const [dx, dy] = into(srcX - half, srcY - half);
    ctx.drawImage(stage.screen, srcX - half, srcY - half, 2 * half, 2 * half, dx, dy, 2 * radius, 2 * radius);
    // what a mask hides stays hidden, magnified or not
    for (const mask of stage.masks) {
      const [mx, my] = into(mask.rect[0], mask.rect[1]);
      const box: Rect = [mx, my, mask.rect[2] * scale, mask.rect[3] * scale];
      if (box[0] > lens[0] + lens[2] || box[1] > lens[1] + lens[3] || box[0] + box[2] < lens[0] || box[1] + box[3] < lens[1]) continue;
      if (mask.style === 'blur') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(...box);
        ctx.clip();
        ctx.filter = `blur(${Math.max(8, Math.min(box[2], box[3]) / 4)}px)`;
        ctx.drawImage(stage.screen, mask.rect[0], mask.rect[1], mask.rect[2], mask.rect[3], ...box);
        ctx.restore();
      } else {
        ctx.fillStyle = averageColor(stage.screen, mask.rect);
        ctx.fillRect(...box);
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = LOOK.ring * u;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  return lens;
}

/** Draws the frame's annotations, in order, into `ctx` (cleared by the caller). */
export function drawAnnotations(ctx: OffscreenCanvasRenderingContext2D, annotations: readonly ActiveAnnotation[], stage: AnnotationStage): void {
  const u = stage.unit;
  const { content } = stage.layout;
  ctx.save();
  clipToContent(ctx, stage.layout);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { annotation, progress, opacity } of annotations) {
    if (opacity <= 0) continue;
    const color = annotation.color ?? stage.accent;
    ctx.save();
    ctx.globalAlpha = opacity;
    let box: Rect | undefined;
    if (annotation.kind === 'arrow' && annotation.from && annotation.to) {
      const [x1, y1] = sourceToOutput(annotation.from[0], annotation.from[1], stage.zoom, content);
      const [x2, y2] = sourceToOutput(annotation.to[0], annotation.to[1], stage.zoom, content);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = LOOK.head * u;
      // the shaft grows to the tip, the head opens at the end
      const reach = Math.min(1, progress / 0.75);
      const tipX = lerp(x1, x2, reach);
      const tipY = lerp(y1, y2, reach);
      ctx.shadowColor = LOOK.shadow.color;
      ctx.shadowBlur = LOOK.shadow.blur * u * 0.6;
      ctx.shadowOffsetY = LOOK.shadow.y * u * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = LOOK.stroke * u;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(tipX - Math.cos(angle) * head * 0.6 * Math.min(1, reach * 4), tipY - Math.sin(angle) * head * 0.6 * Math.min(1, reach * 4));
      ctx.stroke();
      const open = Math.max(0, Math.min(1, (progress - 0.55) / 0.45));
      if (open > 0) {
        const size = head * lerp(0.4, 1, open);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(angle - 0.45) * size, tipY - Math.sin(angle - 0.45) * size);
        ctx.lineTo(tipX - Math.cos(angle + 0.45) * size, tipY - Math.sin(angle + 0.45) * size);
        ctx.closePath();
        ctx.fill();
      }
      box = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
    } else if (annotation.rect) {
      const [x, y, w, h] = sourceRectToOutput(annotation.rect, stage.zoom, content);
      const pad = LOOK.pad * u;
      box = [x, y, w, h];
      if (annotation.kind === 'box' || annotation.kind === 'ellipse') {
        const outline: Rect = [x - pad, y - pad, w + 2 * pad, h + 2 * pad];
        ctx.shadowColor = LOOK.shadow.color;
        ctx.shadowBlur = LOOK.shadow.blur * u * 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = LOOK.stroke * u;
        const path = new Path2D();
        if (annotation.kind === 'box') path.roundRect(...outline, LOOK.radius * u);
        else path.ellipse(outline[0] + outline[2] / 2, outline[1] + outline[3] / 2, outline[2] / 2, outline[3] / 2, 0, -Math.PI / 2, Math.PI * 1.5);
        // the outline traces itself: a dash as long as the whole, shown up to `progress`
        const around = annotation.kind === 'box' ? 2 * (outline[2] + outline[3]) : Math.PI * (outline[2] + outline[3]) / 2;
        ctx.setLineDash([around * progress, around]);
        ctx.stroke(path);
        box = outline;
      } else if (annotation.kind === 'highlight') {
        // a marker's stroke, swept from left to right
        ctx.fillStyle = rgba(color, LOOK.highlight);
        ctx.beginPath();
        ctx.roundRect(x - pad / 2, y, (w + pad) * progress, h, Math.min(h / 4, LOOK.radius * u));
        ctx.fill();
      } else if (annotation.kind === 'spotlight') {
        // the rest of the screen darker, a soft-edged hole over the rect
        const dim = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height).getContext('2d')!;
        dim.fillStyle = `rgba(0, 0, 0, ${LOOK.spotlight * progress})`;
        dim.fillRect(...content);
        dim.globalCompositeOperation = 'destination-out';
        dim.filter = `blur(${LOOK.feather * u}px)`;
        dim.beginPath();
        dim.roundRect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, LOOK.radius * u * 1.5);
        dim.fill();
        ctx.drawImage(dim.canvas, 0, 0);
      } else if (annotation.kind === 'magnifier') {
        box = drawMagnifier(ctx, annotation.rect, annotation.zoom, color, stage, progress);
      }
    }
    if (annotation.text && box) drawCallout(ctx, annotation.text, box, color, u, content, Math.max(0, Math.min(1, (progress - 0.3) / 0.7)));
    ctx.restore();
  }
  ctx.restore();
}
