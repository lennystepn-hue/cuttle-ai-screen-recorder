import { ShotSchema, type ShotInput } from '@cuttle/project';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets } from '../src/assets';
import { drawShot } from '../src/shot';
import { pixelAt, readPixels, type Pixels } from './gl-util';

beforeAll(async () => {
  await loadEngineAssets();
});

const shot = (input: Partial<ShotInput>) => ShotSchema.parse({ version: 1, source: 'source.png', ...input });

/** An image whose every pixel has its own colour (a resampled pixel shows at once); `alpha` per pixel, default opaque. */
async function noise(width: number, height: number, alpha: (x: number, y: number) => number = () => 255): Promise<{ bitmap: ImageBitmap; at: (x: number, y: number) => number[] }> {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([next(), next(), next(), alpha(x, y)], (y * width + x) * 4);
  const bitmap = await createImageBitmap(new ImageData(data, width, height), { premultiplyAlpha: 'premultiply' });
  return { bitmap, at: (x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}

function draw(input: Partial<ShotInput>, bitmap: ImageBitmap, scale?: number): { pixels: Pixels; layout: ReturnType<typeof drawShot> } {
  const canvas = new OffscreenCanvas(1, 1);
  const layout = drawShot(canvas, shot(input), bitmap, scale === undefined ? {} : { scale });
  const gl = canvas.getContext('webgl2')!;
  try {
    return { pixels: readPixels(gl), layout };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** The image's pixels the shot does not show as they are, at most `most` of them listed. */
function changed(pixels: Pixels, content: readonly number[], at: (x: number, y: number) => number[], most = 5): string[] {
  const wrong: string[] = [];
  for (let y = 0; y < content[3]! && wrong.length < most; y++) {
    for (let x = 0; x < content[2]! && wrong.length < most; x++) {
      const want = at(x, y);
      const got = pixelAt(pixels, content[0]! + x, content[1]! + y);
      if (want.some((value, i) => value !== got[i])) wrong.push(`${x},${y}: ${got} instead of ${want}`);
    }
  }
  return wrong;
}

describe('a shot', () => {
  it('keeps every pixel of the image, on its background', async () => {
    const { bitmap, at } = await noise(50, 30);
    const { pixels, layout } = draw({ padding: 8, frame: { radius: 0, shadow: false }, background: { preset: 'solid', color: '#204060' } }, bitmap);
    expect([pixels.width, pixels.height]).toEqual([66, 46]);
    expect(changed(pixels, layout.layout.content, at)).toEqual([]);
    expect(pixelAt(pixels, 2, 2)).toEqual([0x20, 0x40, 0x60, 255]);
    bitmap.close();
  });

  it("keeps every pixel of a Retina shot, its window's title bar drawn at 2×", async () => {
    const { bitmap, at } = await noise(60, 40);
    const { pixels, layout } = draw({ scale: 2, padding: 10, frame: { style: 'mac-dark', radius: 0, shadow: false }, background: { preset: 'solid', color: '#000000' } }, bitmap);
    expect(layout.layout.titleBar).toBe(72);
    expect([pixels.width, pixels.height]).toEqual([100, 152]);
    expect(changed(pixels, layout.layout.content, at)).toEqual([]);
    // the title bar's colour above the image
    expect(pixelAt(pixels, 77, 30)).toEqual([0x2a, 0x2a, 0x2e, 255]);
    bitmap.close();
  });

  it("rounds the shot's corners and casts its shadow on nothing when transparent", async () => {
    const { bitmap } = await noise(200, 120);
    const { pixels, layout } = draw({ padding: 0, transparent: true, frame: { radius: 16 } }, bitmap);
    const [x, y, w, h] = layout.layout.window;
    // the canvas's corner: nothing
    expect(pixelAt(pixels, 0, 0)[3]).toBe(0);
    // the window's corner is rounded off; inside it, the image, opaque
    expect(pixelAt(pixels, x, y)[3]).toBeLessThan(128);
    expect(pixelAt(pixels, x + w / 2, y + h / 2)[3]).toBe(255);
    // the shadow under the window, fading to nothing at the canvas's edge
    expect(pixelAt(pixels, x + w / 2, y + h + 10)[3]).toBeGreaterThan(30);
    expect(pixelAt(pixels, x + w / 2, pixels.height - 1)[3]).toBeLessThanOrEqual(2);
    bitmap.close();
  });

  it("keeps the image's own transparency: the background shows through it", async () => {
    // the left half of the image transparent (a window's rounded corners, a cut-out)
    const { bitmap } = await noise(40, 20, (x) => (x < 20 ? 0 : 255));
    const { pixels, layout } = draw({ padding: 4, frame: { radius: 0, shadow: false }, background: { preset: 'solid', color: '#00ff00' } }, bitmap);
    const [x, y] = layout.layout.content;
    expect(pixelAt(pixels, x + 5, y + 10)).toEqual([0, 255, 0, 255]);
    bitmap.close();
  });
});
