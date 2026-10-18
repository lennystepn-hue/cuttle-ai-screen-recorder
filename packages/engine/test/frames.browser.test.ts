import { parseProject, type CuttleProjectInput } from '@cuttle/project';
import { createTimeline } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { frameLayout } from '../src/view';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';

let assets: EngineAssets;
let screen: OffscreenCanvas;

beforeAll(async () => {
  assets = await loadEngineAssets();
  screen = (await fixtures()).screen;
});

const OUTPUT = { width: 640, height: 360 };
const SLATE = { preset: 'solid', color: '#3B4252' } as const;

function project(look: NonNullable<CuttleProjectInput['look']>, rest: Partial<CuttleProjectInput> = {}) {
  const parsed = parseProject({ version: 1, output: { ...OUTPUT, fps: 30 }, sources: { screen: 's.mp4' }, look: { background: SLATE, ...look }, scenes: [{ type: 'clip', from: 0, to: 10 }], ...rest });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

/** One frame of a clip of the fake screen, at 1 s. */
function render(look: NonNullable<CuttleProjectInput['look']>, options: { screenSize?: { width: number; height: number }; watermark?: ImageBitmap; rest?: Partial<CuttleProjectInput> } = {}): Pixels {
  const screenSize = options.screenSize ?? SCREEN;
  const p = project(look, options.rest);
  const state = createTimeline(p, { screenSize }).frameAt(1);
  const sources: FrameSources = { screens: new Map([[0, screen]]), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, p, { assets, screenSize, ...(options.watermark && { watermarkImage: options.watermark }) });
  const gl = canvas.getContext('webgl2')!;
  renderer.render(state, sources);
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return pixels;
}

const rgb = (pixels: Pixels, x: number, y: number) => pixelAt(pixels, Math.round(x), Math.round(y)).slice(0, 3);
const near = (actual: number[], hex: string, within = 6) => {
  const expected = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return actual.every((value, i) => Math.abs(value - expected[i]!) <= within);
};
/** The brightest channel in a rect of the picture. */
function brightest(pixels: Pixels, [x, y, w, h]: number[]): number {
  let most = 0;
  for (let row = Math.round(y!); row < y! + h!; row++) for (let column = Math.round(x!); column < x! + w!; column++) most = Math.max(most, ...rgb(pixels, column, row));
  return most;
}

describe('the window frames', () => {
  it('draw a dark browser: its bar and its dark address field', () => {
    const pixels = render({ frame: { style: 'browser-dark', title: '' } });
    const { layout } = frameLayout(OUTPUT, project({}).look, 'browser-dark', SCREEN.width / SCREEN.height);
    const [x, y, w] = layout.window;
    expect(near(rgb(pixels, x + w / 2, y + layout.titleBar / 2), '#1C1C20')).toBe(true);
    expect(near(rgb(pixels, x + w * 0.8, y + layout.titleBar / 2), '#2B2B30')).toBe(true);
  });

  it('draw Windows: its bar, its title on the left and the caption buttons on the right', () => {
    for (const [style, bar, glyph] of [['windows-dark', '#202020', true], ['windows-light', '#F3F3F3', false]] as const) {
      const pixels = render({ frame: { style, title: 'Notes' } });
      const { layout } = frameLayout(OUTPUT, project({}).look, style, SCREEN.width / SCREEN.height);
      const [x, y, w] = layout.window;
      const unit = OUTPUT.height / 1080;
      expect(near(rgb(pixels, x + w * 0.5, y + layout.titleBar / 2), bar), style).toBe(true);
      // the close glyph in the last 46 units, the title's ink in the first part
      const close: number[] = [x + w - 46 * unit, y, 46 * unit, layout.titleBar];
      const title: number[] = [x + 10 * unit, y, 80 * unit, layout.titleBar];
      if (glyph) {
        expect(brightest(pixels, close), style).toBeGreaterThan(120);
        expect(brightest(pixels, title), style).toBeGreaterThan(120);
      } else {
        const darkest = (rect: number[]) => 255 - brightest({ ...pixels, data: pixels.data.map((value, i) => (i % 4 === 3 ? value : 255 - value)) }, rect);
        expect(darkest(close), style).toBeLessThan(140);
        expect(darkest(title), style).toBeLessThan(140);
      }
    }
  });

  it('draw a terminal: a dark tab on the left of its bar, the prompt and the title in it', () => {
    const pixels = render({ frame: { style: 'terminal', title: 'zsh' } });
    const { layout } = frameLayout(OUTPUT, project({}).look, 'terminal', SCREEN.width / SCREEN.height);
    const [x, y, w] = layout.window;
    const unit = OUTPUT.height / 1080;
    expect(near(rgb(pixels, x + w * 0.6, y + layout.titleBar / 2), '#2B2B2B')).toBe(true);
    // the tab's corner: dark, under the bar's colour
    expect(near(rgb(pixels, x + 10 * unit, y + layout.titleBar - 2), '#0C0C0C', 10)).toBe(true);
    expect(brightest(pixels, [x + 14 * unit, y + 8 * unit, 60 * unit, layout.titleBar - 8 * unit])).toBeGreaterThan(150);
  });
});

describe('the devices', () => {
  const portrait = { width: 720, height: 1560 };

  for (const style of ['iphone', 'android'] as const) {
    it(`draw ${style === 'iphone' ? 'an iPhone' : 'an Android phone'} around the screen: the bezel, the screen inside it, the camera on its top`, () => {
      const pixels = render({ frame: { style } }, { screenSize: portrait });
      const { layout } = frameLayout(OUTPUT, project({}).look, style, portrait.width / portrait.height);
      const [cx, cy, cw, ch] = layout.content;
      const band = cx - layout.window[0];
      expect(band).toBeGreaterThanOrEqual(2);
      // the bezel, black, just left of the screen at its middle (inside the metal band)
      expect(brightest(pixels, [cx - Math.max(1, Math.round(band * 0.3)), cy + ch / 2, 1, 1]), 'bezel').toBeLessThan(40);
      // the camera: dark at the screen's top centre (a lens's glint in it), where the fake screen is not
      const camera = style === 'iphone' ? [cx + cw * 0.45, cy + cw * 0.06] : [cx + cw * 0.5, cy + cw * 0.044];
      expect(brightest(pixels, [camera[0]!, camera[1]!, 1, 1]), 'camera').toBeLessThan(70);
      // the screen's corners are round: a little way into the content's corner, the black bezel shows
      // (its very corner is the metal band's: the body's curve and the screen's share their centre)
      const into = layout.clipRadius * 0.2;
      expect(brightest(pixels, [cx + into, cy + into, 1, 1]), 'corner').toBeLessThan(40);
      // the content's middle is the screen's
      expect(brightest(pixels, [cx + cw / 2 - 2, cy + ch / 2 - 2, 4, 4]), 'screen').toBeGreaterThan(40);
    });
  }
});

describe('the watermark', () => {
  async function red(width: number, height: number): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#FF0000';
    g.fillRect(0, 0, width, height);
    return createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
  }

  it('draws its image in its corner at its opacity, over everything', async () => {
    const image = await red(200, 100);
    const pixels = render({ frame: { enabled: false }, watermark: { enabled: true, corner: 'bottom-right', size: 0.2, opacity: 0.5 } }, { watermark: image });
    // 72 px high, 144 wide, 40 units (13 px) from the edges
    const [r, g, b] = rgb(pixels, 640 - 13 - 72, 360 - 13 - 36);
    expect(r).toBeGreaterThan(g! + 60);
    expect(r).toBeGreaterThan(b! + 60);
    expect(r).toBeLessThan(250);
    // nothing in the other corners
    const top = rgb(pixels, 20, 20);
    expect(top[0]! - top[1]!).toBeLessThan(40);
  });

  it('draws its text, else the brand\'s name, when it has no image; nothing when it is off', () => {
    const corner = [640 - 13 - 120, 360 - 13 - 22, 120, 22];
    const look = { background: { preset: 'solid', color: '#000000' }, frame: { enabled: false } } as const;
    const fill = (pixels: Pixels) => {
      let lit = 0;
      for (let y = corner[1]!; y < corner[1]! + corner[3]!; y++) for (let x = corner[0]!; x < corner[0]! + corner[2]!; x++) if (rgb(pixels, x, y)[0]! > 120) lit++;
      return lit;
    };
    const text = render({ ...look, watermark: { enabled: true, text: 'cuttle.dev', size: 0.06 } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }] } });
    expect(fill(text)).toBeGreaterThan(30);
    const named = render({ ...look, watermark: { enabled: true, size: 0.06 } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }], theme: { name: 'Nimbus' } } });
    expect(fill(named)).toBeGreaterThan(20);
    const off = render({ ...look, watermark: { enabled: false, text: 'cuttle.dev' } }, { rest: { scenes: [{ type: 'card', title: ' ', duration: 5 }] } });
    expect(fill(off)).toBe(0);
  });
});
