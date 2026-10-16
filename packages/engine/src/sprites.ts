import { FONT_FAMILY } from './assets';
import { createTexture, uploadTexture } from './gl/texture';
import type { Size } from './layout';
import type { LabelStyle } from './presets/labels';

/** A label drawn into a texture. `width`/`height` cover the whole canvas, shadow `margin` included; `box` is the visible box. */
export interface Sprite {
  texture: WebGLTexture;
  width: number;
  height: number;
  margin: number;
  box: Size;
}

export function cssFont(weight: 400 | 600, px: number): string {
  return `${weight} ${px}px "${FONT_FAMILY}"`;
}

/** Shortens `text` with "…" until it is at most `maxWidth` px wide in the context's current font. */
export function fitText(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

/** Draws one line of text in `style` at `unit` scale, at most `maxWidth` px wide (box included). */
export function drawLabel(text: string, style: LabelStyle, unit: number, maxWidth: number): { canvas: OffscreenCanvas; margin: number } {
  const fontPx = Math.max(1, Math.round(style.size * unit));
  const padX = Math.round(style.padX * unit);
  const padY = Math.round(style.padY * unit);
  const accent = style.accent ? Math.max(2, Math.round(6 * unit)) : 0;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  measure.font = cssFont(style.weight, fontPx);
  const shown = fitText(measure, text, Math.max(0, maxWidth - 2 * padX - accent));
  const boxWidth = Math.max(1, Math.ceil(measure.measureText(shown).width) + 2 * padX + accent);
  const boxHeight = Math.round(fontPx * 1.3) + 2 * padY;
  const margin = style.shadow ? Math.ceil((style.shadow.blur + Math.abs(style.shadow.y)) * unit) : 0;

  const canvas = new OffscreenCanvas(boxWidth + 2 * margin, boxHeight + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
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
  ctx.font = cssFont(style.weight, fontPx);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, accent + padX, boxHeight / 2);
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

  label(text: string, style: LabelStyle, unit: number, maxWidth: number): Sprite {
    const key = JSON.stringify([text, style, unit, maxWidth]);
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { canvas, margin } = drawLabel(text, style, unit, maxWidth);
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
