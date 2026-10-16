import { BACKGROUND_PRESETS, parseProject, type CuttleProject, type CuttleProjectInput, type MaskStyle, type Rect } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { maskRectToOutput, windowLayout } from '../src/layout';
import { FRAME_CHROME } from '../src/presets/frames';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels, type Pixels } from './gl-util';

let assets: EngineAssets;

beforeAll(async () => {
  assets = await loadEngineAssets();
});

function parse(input: Partial<CuttleProjectInput>): CuttleProject {
  const result = parseProject({ version: 1, output: { width: 64, height: 36 }, sources: { screen: 's.mp4' }, ...input });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

const CARDS = parse({
  look: { background: { preset: 'solid', color: '#204060' } },
  scenes: [
    { type: 'card', title: 'A', duration: 1 },
    { type: 'card', title: 'B', duration: 1 },
  ],
});

const NO_SOURCES: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };

function layer(index: number, opacity: number, kind: SceneFrame['kind'] = 'card'): SceneFrame {
  return { index, kind, local: 0, progress: 0, opacity, masks: [], texts: [] };
}

function render(project: CuttleProject, state: RenderState, sources = NO_SOURCES) {
  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, project, { assets, screenSize: SCREEN });
  renderer.render(state, sources);
  const gl = canvas.getContext('webgl2')!;
  const pixels = readPixels(gl);
  renderer.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { canvas, pixels };
}

describe('createRenderer', () => {
  it('sizes the canvas to the project output', () => {
    const { canvas } = render(CARDS, { t: 0, layers: [] });
    expect([canvas.width, canvas.height]).toEqual([64, 36]);
  });

  it('draws black without layers', () => {
    expect(pixelAt(render(CARDS, { t: 0, layers: [] }).pixels, 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it('draws the solid background colour exactly', () => {
    expect(pixelAt(render(CARDS, { t: 0, layers: [layer(0, 1)] }).pixels, 1, 1)).toEqual([32, 64, 96, 255]);
  });

  it('compiles every background preset', async () => {
    const { background } = await fixtures();
    for (const preset of BACKGROUND_PRESETS) {
      const project = parse({ look: { background: { preset, color: '#000000', image: 'bg.png' } } });
      createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN, backgroundImage: background }).dispose();
    }
  });

  it('needs the background image for the image preset', () => {
    const project = parse({ look: { background: { preset: 'image', image: 'bg.png' } } });
    expect(() => createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN })).toThrow(
      'createRenderer: look.background.preset is "image" but no backgroundImage was given',
    );
  });

  it('rejects an empty screen size', () => {
    expect(() => createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: { width: 0, height: 10 } })).toThrow(
      'createRenderer: screenSize must have a positive, finite width and height',
    );
  });
});

describe('render', () => {
  it('names the scene whose screen frame is missing', () => {
    const project = parse({ scenes: [{ type: 'clip', from: 0, to: 1 }] });
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'clip')] })).toThrow('render: no screen frame for scene 0');
  });

  it('crossfades: a top layer at opacity 0 changes nothing, at 1 it replaces the bottom one', () => {
    const a = render(CARDS, { t: 0, layers: [layer(0, 1)] }).pixels.data;
    const b = render(CARDS, { t: 0, layers: [layer(1, 1)] }).pixels.data;
    expect(a).not.toEqual(b);
    expect(render(CARDS, { t: 0, layers: [layer(0, 1), layer(1, 0)] }).pixels.data).toEqual(a);
    expect(render(CARDS, { t: 0, layers: [layer(0, 0), layer(1, 1)] }).pixels.data).toEqual(b);
  });

  it('throws after dispose', () => {
    const renderer = createRenderer(new OffscreenCanvas(1, 1), CARDS, { assets, screenSize: SCREEN });
    renderer.dispose();
    expect(() => renderer.render({ t: 0, layers: [] }, NO_SOURCES)).toThrow('render: the renderer was disposed');
  });

  it('throws when the WebGL context was lost instead of drawing empty frames', () => {
    const canvas = new OffscreenCanvas(1, 1);
    const renderer = createRenderer(canvas, CARDS, { assets, screenSize: SCREEN });
    canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    expect(() => renderer.render({ t: 0, layers: [layer(0, 1)] }, NO_SOURCES)).toThrow('render: the WebGL context was lost');
    renderer.dispose();
  });
});

describe('masks hide what is under them', () => {
  const OUTPUT = { width: 960, height: 540 };
  /** About 4.6 output px per source px: bilinear magnification spreads every texel well past its edge. */
  const STRONG_ZOOM: Rect = [560, 360, 160, 100];
  const SMALL: Rect = [600, 400, 80, 20];
  /** A line of large text: 8 % of the screen height. */
  const LARGE: Rect = [400, 300, 480, 64];
  /** Blurred detail keeps at most 10 % of the hidden contrast (white on #1E1E1E); the plan's first blur kept 16 %, readable. */
  const BLUR_TOLERANCE = Math.floor(0.1 * (255 - 0x1e));

  /** A dark screen; inside `secret`, white bars stand in for text and touch all four edges of it. */
  function screen(secret?: Rect, period = 3, offset = 0, bar = 2): OffscreenCanvas {
    const canvas = new OffscreenCanvas(SCREEN.width, SCREEN.height);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#1E1E1E';
    g.fillRect(0, 0, SCREEN.width, SCREEN.height);
    if (secret) {
      const [x, y, w, h] = secret;
      g.fillStyle = '#FFFFFF';
      for (let left = x + offset; left < x + w; left += period) g.fillRect(left, y, Math.min(bar, x + w - left), h);
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
    }
    return canvas;
  }

  function renderMask(style: MaskStyle, mask: Rect, source: OffscreenCanvas, zoom?: Rect) {
    const project = parse({ output: OUTPUT, scenes: [{ type: 'clip', from: 0, to: 1 }], masks: [{ from: 0, to: 1, rect: mask, style }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), zoom, masks: project.masks };
    const pixels = render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, source]]), webcams: new Map(), stills: new Map() }).pixels;
    const { content } = windowLayout(OUTPUT, SCREEN.width / SCREEN.height, { titleBar: FRAME_CHROME['mac-dark'].titleBar, radius: 14 });
    return { pixels, rect: maskRectToOutput(mask, zoom ?? [0, 0, SCREEN.width, SCREEN.height], content) };
  }

  /** The largest colour difference between `a` and `b`, inside or outside `rect`. */
  function maxDifference(a: Pixels, b: Pixels, rect: Rect, where: 'inside' | 'outside'): number {
    let max = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const inside = x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
        if (inside !== (where === 'inside')) continue;
        const i = (y * a.width + x) * 4;
        for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a.data[i + c]! - b.data[i + c]!));
      }
    }
    return max;
  }

  it('fill: nothing of the hidden content shows anywhere, even under a strong zoom', () => {
    const shown = renderMask('fill', SMALL, screen(SMALL), STRONG_ZOOM);
    const empty = renderMask('fill', SMALL, screen(), STRONG_ZOOM);
    expect(maxDifference(shown.pixels, empty.pixels, shown.rect, 'inside')).toBe(0);
    expect(maxDifference(shown.pixels, empty.pixels, shown.rect, 'outside')).toBe(0);
  });

  it('blur: nothing of the hidden content shows outside the mask, even under a strong zoom', () => {
    const shown = renderMask('blur', SMALL, screen(SMALL), STRONG_ZOOM);
    const empty = renderMask('blur', SMALL, screen(), STRONG_ZOOM);
    expect(maxDifference(shown.pixels, empty.pixels, shown.rect, 'outside')).toBe(0);
  });

  it('blur: two different large texts with the same amount of ink look the same', () => {
    const a = renderMask('blur', LARGE, screen(LARGE, 24, 0, 8));
    const b = renderMask('blur', LARGE, screen(LARGE, 24, 12, 8));
    expect(maxDifference(a.pixels, b.pixels, a.rect, 'inside')).toBeLessThanOrEqual(BLUR_TOLERANCE);
  });
});
