import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import type { RenderState } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';

let assets: EngineAssets;
let wallpaper: ImageBitmap;

beforeAll(async () => {
  assets = await loadEngineAssets();
  wallpaper = (await fixtures()).background;
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };

/** The background alone at `t`: a motion scene whose page has no frame yet shows nothing else. */
function background(look: NonNullable<CuttleProjectInput['look']>['background'], t = 1, size = { width: 160, height: 90 }): Pixels {
  const parsed = parseProject({ version: 1, output: size, sources: { screen: 's.mp4' }, look: { background: look }, scenes: [{ type: 'motion', src: 'a.html', duration: 10 }] });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, parsed.project, { assets, screenSize: SCREEN, backgroundImage: wallpaper });
  const state: RenderState = { t, layers: [{ index: 0, sceneIndex: 0, kind: 'motion', local: t, progress: t / 10, opacity: 1, masks: [], texts: [], overlays: [] }] };
  renderer.render(state, NO_SOURCES);
  const gl = canvas.getContext('webgl2')!;
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return pixels;
}

const rgb = (pixels: Pixels, x: number, y: number) => pixelAt(pixels, x, y).slice(0, 3);
const near = (actual: number[], expected: number[], within = 3) => actual.every((value, i) => Math.abs(value - expected[i]!) <= within);
/** The mean of each channel. */
function mean(pixels: Pixels): number[] {
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += pixels.data[i + c]!;
  return sum.map((value) => value / (pixels.width * pixels.height));
}
/** The hard edges of a picture: neighbouring pixels (side by side) that differ by more than 30 in a channel. */
function edges(pixels: Pixels): number {
  let count = 0;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 1; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4;
      if ([0, 1, 2].some((c) => Math.abs(pixels.data[i + c]! - pixels.data[i - 4 + c]!) > 30)) count++;
    }
  }
  return count;
}
const meanDifference = (a: Pixels, b: Pixels) => a.data.reduce((sum, value, i) => (i % 4 === 3 ? sum : sum + Math.abs(value - b.data[i]!)), 0) / (a.width * a.height * 3);

describe('the gradient', () => {
  it('runs from its first colour to its last in the direction CSS gives the angle', () => {
    const across = background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 90 });
    // (a pixel's centre is half a pixel into the gradient)
    expect(near(rgb(across, 0, 45), [255, 0, 0], 8)).toBe(true);
    expect(near(rgb(across, 159, 45), [0, 0, 255], 8)).toBe(true);
    const up = background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 0 });
    expect(near(rgb(up, 80, 89), [255, 0, 0], 12)).toBe(true);
    expect(near(rgb(up, 80, 0), [0, 0, 255], 12)).toBe(true);
    // the default, 135 degrees: from the top left corner to the bottom right one
    const corner = background({ preset: 'gradient', colors: ['#000000', '#FFFFFF'] });
    expect(near(rgb(corner, 0, 0), [0, 0, 0], 8)).toBe(true);
    expect(near(rgb(corner, 159, 89), [255, 255, 255], 8)).toBe(true);
  });

  it('mixes in Oklab: the middle of red and blue is a violet as light as its ends, not the dark purple of a mix in sRGB (128, 0, 128)', () => {
    const [r, g, b] = rgb(background({ preset: 'gradient', colors: ['#FF0000', '#0000FF'], angle: 90 }), 80, 45);
    expect(r! + g! + b!).toBeGreaterThan(330);
    expect(b).toBeGreaterThan(r!);
    expect(r).toBeGreaterThan(g!);
  });

  it('goes through every stop, and radial from the centre out', () => {
    const stops = background({ preset: 'gradient', colors: ['#FF0000', '#00FF00', '#0000FF'], angle: 90 });
    expect(near(rgb(stops, 80, 45), [0, 255, 0], 24)).toBe(true);
    const radial = background({ preset: 'gradient', colors: ['#FFFFFF', '#000000'], kind: 'radial' });
    expect(rgb(radial, 80, 45).every((value) => value > 245)).toBe(true);
    expect(near(rgb(radial, 0, 0), [0, 0, 0], 4)).toBe(true);
  });
});

describe('the coloured backgrounds', () => {
  it('draw mesh in colours of their own', () => {
    // the first point sits at the top left: red there
    const [r, g, b] = rgb(background({ preset: 'mesh', colors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'] }), 25, 18);
    expect(r).toBeGreaterThan(200);
    expect(Math.max(g!, b!)).toBeLessThan(110);
  });

  for (const preset of ['flow', 'bokeh', 'dots'] as const) {
    it(`draws ${preset} the same every time, quiet, dark enough for a window, in its palette`, () => {
      const look = { preset, colors: ['#401010', '#FF3030'] };
      const first = background(look, 4);
      expect(meanDifference(first, background(look, 4))).toBe(0);
      // it moves, slowly: half a second later only a little has changed
      const later = meanDifference(first, background(look, 4.5));
      expect(later).toBeGreaterThan(0);
      expect(later).toBeLessThan(4);
      const [r, g, b] = mean(first);
      expect(r).toBeGreaterThan(g! + 4);
      expect(r).toBeGreaterThan(b! + 4);
      expect((r! + g! + b!) / 3).toBeLessThan(110);
      // without colours of its own, its preset's
      expect(meanDifference(background({ preset }, 4), first)).toBeGreaterThan(2);
    });
  }
});

describe('the image', () => {
  it('softens and darkens the image as asked', () => {
    const sharp = background({ preset: 'image', image: 'bg.png' }, 1, { width: 320, height: 180 });
    const soft = background({ preset: 'image', image: 'bg.png', blur: 1 }, 1, { width: 320, height: 180 });
    expect(edges(sharp)).toBeGreaterThan(100);
    expect(edges(soft)).toBeLessThan(edges(sharp) * 0.1);
    // its colours stay: the mean of the picture barely moves
    expect(mean(soft).every((value, c) => Math.abs(value - mean(sharp)[c]!) < 12)).toBe(true);
    const dim = background({ preset: 'image', image: 'bg.png', dim: 0.5 }, 1, { width: 320, height: 180 });
    expect(mean(dim).every((value, c) => Math.abs(value - mean(sharp)[c]! * 0.5) < 2)).toBe(true);
  });
});
