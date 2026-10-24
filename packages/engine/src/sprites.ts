import { FONT_FAMILY } from './assets';
import { createTexture, uploadTexture } from './gl/texture';
import type { Size } from './layout';
import type { LabelStyle } from './presets/labels';

/** A label drawn into a texture. `width`/`height` cover the whole canvas, `margin` (for the shadow and overhanging glyphs) included; `box` is the visible box. */
export interface Sprite {
  texture: WebGLTexture;
  width: number;
  height: number;
  margin: number;
  box: Size;
}

export function cssFont(weight: number, px: number, family = FONT_FAMILY): string {
  return `${weight} ${px}px "${family}"`;
}

/** Shortens `text` with "…" until it is at most `maxWidth` px wide in the context's current font. */
export function fitText(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * A label as it comes in or goes out (`textMotion`): the first `reveal` letters of its text, the
 * left `sweep` share of it, blurred by `blur` px. Its box stays the whole label's.
 */
export interface LabelPart {
  reveal?: number;
  sweep?: number;
  blur?: number;
}

/** Draws one line of text in `style` at `unit` scale, at most `maxWidth` px wide (box included); `part`: a part of it. */
export function drawLabel(text: string, style: LabelStyle, unit: number, maxWidth: number, part: LabelPart = {}): { canvas: OffscreenCanvas; margin: number } {
  const fontPx = Math.max(1, Math.round(style.size * unit));
  const padX = Math.round(style.padX * unit);
  const padY = Math.round(style.padY * unit);
  const accent = style.accent ? Math.max(2, Math.round(6 * unit)) : 0;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = cssFont(style.weight, fontPx, style.family);
  const shown = fitText(measure, text, Math.max(0, maxWidth - 2 * padX - accent));
  const boxWidth = Math.max(1, Math.ceil(measure.measureText(shown).width) + 2 * padX + accent);
  const boxHeight = Math.round(fontPx * 1.3) + 2 * padY;
  const shadowMargin = style.shadow ? Math.ceil((style.shadow.blur + Math.abs(style.shadow.y)) * unit) : 0;
  // Glyph ink can reach past the advance width and the 1.3 em box (the hook of a j, the dots of Ä);
  // a blur spreads it further
  const blur = part.blur && part.blur > 0 ? part.blur : 0;
  const margin = Math.max(shadowMargin, Math.ceil(fontPx * 0.15)) + Math.ceil(blur * 2.5);

  const canvas = new OffscreenCanvas(boxWidth + 2 * margin, boxHeight + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  if (part.sweep !== undefined && part.sweep < 1) {
    // the left part of it, its shadow and overhanging ink with it
    ctx.beginPath();
    ctx.rect(-margin, -margin, margin + boxWidth * Math.max(0, part.sweep), boxHeight + 2 * margin);
    ctx.clip();
  }
  const shadowOn = () => {
    if (!style.shadow) return;
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur * unit;
    ctx.shadowOffsetY = style.shadow.y * unit;
  };
  if (style.fill) {
    const radius = style.radius === 'pill' ? boxHeight / 2 : style.radius * unit;
    shadowOn();
    ctx.fillStyle = style.fill;
    ctx.beginPath();
    ctx.roundRect(0, 0, boxWidth, boxHeight, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (style.accent) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = style.accent;
      ctx.fillRect(0, 0, accent, boxHeight);
      ctx.restore();
    }
  } else {
    shadowOn();
  }
  ctx.font = cssFont(style.weight, fontPx, style.family);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(part.reveal === undefined ? shown : [...shown].slice(0, Math.max(0, part.reveal)).join(''), accent + padX, boxHeight / 2);
  return { canvas, margin };
}

/** Label sprites by content; a sprite unused for `maxIdleFrames` rendered frames is deleted. */
export class SpriteCache {
  private readonly sprites = new Map<string, Sprite & { lastUsed: number }>();
  private frame = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxIdleFrames = 120,
  ) {}

  label(text: string, style: LabelStyle, unit: number, maxWidth: number, part?: LabelPart): Sprite {
    // a part keyed in steps: a sweep in 48ths, a blur in half pixels (a sprite each, while it moves)
    const key = part && (part.reveal !== undefined || (part.sweep !== undefined && part.sweep < 1) || (part.blur ?? 0) > 0)
      ? { reveal: part.reveal, sweep: part.sweep === undefined ? undefined : Math.round(part.sweep * 48) / 48, blur: part.blur ? Math.round(part.blur * 2) / 2 : undefined }
      : undefined;
    return this.drawn(JSON.stringify([text, style, unit, maxWidth, key]), () => drawLabel(text, style, unit, maxWidth, key));
  }

  /** A sprite drawn by `draw` once per `key` (anything else drawn into a canvas: a caption). */
  drawn(key: string, draw: () => { canvas: OffscreenCanvas; margin: number }): Sprite {
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { canvas, margin } = draw();
      const texture = createTexture(this.gl, false);
      uploadTexture(this.gl, texture, canvas, false);
      sprite = {
        texture,
        width: canvas.width,
        height: canvas.height,
        margin,
        box: { width: canvas.width - 2 * margin, height: canvas.height - 2 * margin },
        lastUsed: this.frame,
      };
      this.sprites.set(key, sprite);
    }
    sprite.lastUsed = this.frame;
    return sprite;
  }

  /** Call once after each rendered frame. */
  endFrame(): void {
    for (const [key, sprite] of this.sprites) {
      if (this.frame - sprite.lastUsed >= this.maxIdleFrames) {
        this.gl.deleteTexture(sprite.texture);
        this.sprites.delete(key);
      }
    }
    this.frame++;
  }

  get size(): number {
    return this.sprites.size;
  }

  dispose(): void {
    for (const sprite of this.sprites.values()) this.gl.deleteTexture(sprite.texture);
    this.sprites.clear();
  }
}
