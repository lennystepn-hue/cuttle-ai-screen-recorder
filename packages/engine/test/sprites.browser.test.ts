import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets } from '../src/assets';
import { BADGE_STYLE, TEXT_LABELS } from '../src/presets/labels';
import { SpriteCache, cssFont, drawLabel, fitText } from '../src/sprites';

beforeAll(async () => {
  await loadEngineAssets();
});

describe('fitText', () => {
  it('keeps text that fits and shortens the rest with an ellipsis', () => {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.font = cssFont(400, 20);
    expect(fitText(ctx, 'short', 500)).toBe('short');
    const cut = fitText(ctx, 'a rather long window title that will not fit', 120);
    expect(cut.endsWith('…')).toBe(true);
    expect(ctx.measureText(cut).width).toBeLessThanOrEqual(120);
  });
});

describe('drawLabel', () => {
  it('sizes the box from the font and padding, plus a margin for the shadow', () => {
    const { canvas, margin } = drawLabel('One prompt', TEXT_LABELS.pill, 1, 1000);
    expect(margin).toBe(22); // blur 18 + offset 4
    expect(canvas.height - 2 * margin).toBe(Math.round(28 * 1.3) + 2 * 12);
    expect(canvas.width - 2 * margin).toBeGreaterThan(2 * 26);
  });

  it('never gets wider than maxWidth', () => {
    const { canvas, margin } = drawLabel('x'.repeat(200), BADGE_STYLE, 1, 300);
    expect(canvas.width - 2 * margin).toBeLessThanOrEqual(300);
  });
});

describe('SpriteCache', () => {
  function cache(maxIdleFrames: number) {
    const gl = new OffscreenCanvas(4, 4).getContext('webgl2')!;
    return new SpriteCache(gl, maxIdleFrames);
  }

  it('reuses the sprite for the same text and style', () => {
    const sprites = cache(10);
    const a = sprites.label('12× speed', BADGE_STYLE, 1, 400);
    expect(sprites.label('12× speed', BADGE_STYLE, 1, 400)).toBe(a);
    expect(sprites.label('8× speed', BADGE_STYLE, 1, 400)).not.toBe(a);
    expect(sprites.size).toBe(2);
  });

  it('drops sprites that were not used for maxIdleFrames frames', () => {
    const sprites = cache(1);
    sprites.label('old', BADGE_STYLE, 1, 400);
    sprites.endFrame();
    sprites.label('new', BADGE_STYLE, 1, 400);
    sprites.endFrame();
    expect(sprites.size).toBe(1);
  });
});
