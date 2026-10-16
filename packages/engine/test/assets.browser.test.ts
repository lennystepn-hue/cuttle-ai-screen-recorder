import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, loadEngineAssets } from '../src/assets';
import { CURSOR_ART, CURSOR_TEXTURE_PX } from '../src/presets/cursors';

describe('loadEngineAssets', () => {
  it('loads Inter 400 and 600 into the document', async () => {
    await loadEngineAssets();
    expect(document.fonts.check(`400 20px "${FONT_FAMILY}"`)).toBe(true);
    expect(document.fonts.check(`600 20px "${FONT_FAMILY}"`)).toBe(true);
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.font = `600 40px "${FONT_FAMILY}"`;
    const inter = ctx.measureText('Cuttle 0123').width;
    ctx.font = '600 40px serif';
    expect(inter).not.toBe(ctx.measureText('Cuttle 0123').width);
  });

  it('rasterizes every cursor image with visible pixels', async () => {
    const { cursors } = await loadEngineAssets();
    expect([...cursors.keys()].sort()).toEqual(Object.keys(CURSOR_ART).sort());
    for (const [image, bitmap] of cursors) {
      expect(bitmap.width, image).toBe(CURSOR_TEXTURE_PX);
      expect(bitmap.height, image).toBe(CURSOR_TEXTURE_PX);
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const alpha = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.filter((_, i) => i % 4 === 3);
      expect(alpha.filter((a) => a > 200).length, image).toBeGreaterThan(200);
    }
  });
});
