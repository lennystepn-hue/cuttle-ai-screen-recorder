import { BACKGROUND_PRESETS, parseProject, type CuttleProject, type CuttleProjectInput, type CursorStyle, type MaskStyle, type Rect } from '@cuttle/project';
import type { CursorFrame, RenderState, SceneFrame } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { maskRectToOutput, windowLayout } from '../src/layout';
import { FRAME_CHROME } from '../src/presets/frames';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fakeScreen, fixtures } from './fixtures';
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

  it('refuses an empty screen frame and shows no bubble for an empty webcam frame, instead of drawing black', async () => {
    const project = parse({ look: { webcam: { enabled: true } }, scenes: [{ type: 'clip', from: 0, to: 1 }] });
    const closed = new VideoFrame(await createImageBitmap(new ImageData(2, 2)), { timestamp: 0 });
    closed.close(); // what a decoder hands over by mistake: displayWidth and displayHeight are 0
    const frame = (screen: TexImageSource, webcam?: TexImageSource): FrameSources => ({
      screens: new Map([[0, screen]]),
      webcams: new Map(webcam ? [[0, webcam]] : []),
      stills: new Map(),
    });
    const state: RenderState = { t: 0, layers: [layer(0, 1, 'clip')] };
    expect(() => render(project, state, frame(closed))).toThrow('render: the screen frame of scene 0 is empty (not decoded yet, or closed)');
    const screen = fakeScreen();
    expect(render(project, state, frame(screen, closed)).pixels.data).toEqual(render(project, state, frame(screen)).pixels.data);
  });

  it('names the still scene whose image is missing', () => {
    const project = parse({ scenes: [{ type: 'still', image: 'p.png', duration: 1 }] });
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] })).toThrow('render: no image for still scene 0');
  });

  it('shows the transparent parts of a still on white, like a blank page', async () => {
    const project = parse({ scenes: [{ type: 'still', image: 'p.png', duration: 1 }] });
    const still = async (rgba: [number, number, number, number]) => {
      const data = new ImageData(16, 10);
      for (let i = 0; i < data.data.length; i += 4) data.data.set(rgba, i);
      const image = await createImageBitmap(data, { premultiplyAlpha: 'premultiply' });
      const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]) };
      return pixelAt(render(project, { t: 0, layers: [layer(0, 1, 'still')] }, sources).pixels, 32, 18);
    };
    expect(await still([0, 0, 0, 0])).toEqual([255, 255, 255, 255]);
    // half-transparent red over white is pink: (255, 127, 127); a straight-alpha mix would give red 191
    const [r, g, b] = await still([255, 0, 0, 128]);
    expect(r).toBe(255);
    expect(Math.abs(g! - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - 127)).toBeLessThanOrEqual(1);
  });

  it('refuses a still image that is closed or bigger than the GPU can hold, instead of drawing black', async () => {
    const project = parse({ scenes: [{ type: 'still', image: 'p.png', duration: 1 }] });
    const probe = new OffscreenCanvas(1, 1).getContext('webgl2')!;
    const max = probe.getParameter(probe.MAX_TEXTURE_SIZE) as number;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    const still = (image: ImageBitmap): FrameSources => ({ screens: new Map(), webcams: new Map(), stills: new Map([[0, image]]) });
    const tall = await createImageBitmap(new ImageData(1, max + 1));
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] }, still(tall))).toThrow(
      `render: the image of still scene 0 is 1×${max + 1} px, more than this GPU's limit of ${max} px`,
    );
    const closed = await createImageBitmap(new ImageData(2, 2));
    closed.close();
    expect(() => render(project, { t: 0, layers: [layer(0, 1, 'still')] }, still(closed))).toThrow(
      'render: the image of still scene 0 is empty or closed',
    );
  });

  it('crossfades: a top layer at opacity 0 changes nothing, at 1 it replaces the bottom one', () => {
    const a = render(CARDS, { t: 0, layers: [layer(0, 1)] }).pixels.data;
    const b = render(CARDS, { t: 0, layers: [layer(1, 1)] }).pixels.data;
    expect(a).not.toEqual(b);
    expect(render(CARDS, { t: 0, layers: [layer(0, 1), layer(1, 0)] }).pixels.data).toEqual(a);
    expect(render(CARDS, { t: 0, layers: [layer(0, 0), layer(1, 1)] }).pixels.data).toEqual(b);
  });

  it('draws the scenes it was given last: a card where the project it was made with had a clip', () => {
    const clipFirst = parse({ look: { background: { preset: 'solid', color: '#204060' } }, scenes: [{ type: 'clip', from: 0, to: 1 }, ...CARDS.scenes] });
    const renderer = createRenderer(new OffscreenCanvas(1, 1), clipFirst, { assets, screenSize: SCREEN });
    const state: RenderState = { t: 0, layers: [layer(0, 1)] };
    expect(() => renderer.render(state, NO_SOURCES)).toThrow('render: no screen frame for scene 0');
    renderer.setScenes(CARDS.scenes);
    expect(() => renderer.render(state, NO_SOURCES)).not.toThrow();
    renderer.dispose();
  });

  it('reports where it drew each text, for picking one with the pointer', () => {
    const project = parse({ scenes: [{ type: 'clip', from: 0, to: 1 }], texts: [{ id: 't1', at: 0, duration: 1, text: 'Hello', position: 'bottom' }] });
    const renderer = createRenderer(new OffscreenCanvas(1, 1), project, { assets, screenSize: SCREEN });
    renderer.render({ t: 0, layers: [{ ...layer(0, 1, 'clip'), texts: [{ overlay: project.texts[0]!, opacity: 1 }] }] }, { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]) });
    const [drawn] = renderer.drawnTexts();
    expect(drawn?.overlay.id).toBe('t1');
    // inside the output, in its lower half (a bottom caption)
    const [x, y, width, height] = drawn!.rect;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(64);
    expect(y).toBeGreaterThan(18);
    expect(y + height).toBeLessThanOrEqual(36);
    // a frame without texts reports none
    renderer.render({ t: 0, layers: [layer(0, 1, 'clip')] }, { ...NO_SOURCES, screens: new Map([[0, fakeScreen()]]) });
    expect(renderer.drawnTexts()).toEqual([]);
    renderer.dispose();
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

describe('the cursor', () => {
  const OUTPUT = { width: 960, height: 540 };
  /** look.frame.radius in units: 20 output px at 960×540. */
  const RADIUS = 40;

  function renderCursor(style: CursorStyle, cursor?: CursorFrame): Pixels {
    const project = parse({ output: OUTPUT, look: { frame: { radius: RADIUS }, cursor: { style, size: 2 } }, scenes: [{ type: 'clip', from: 0, to: 1 }] });
    const frame: SceneFrame = { ...layer(0, 1, 'clip'), cursor };
    return render(project, { t: 0, layers: [frame] }, { screens: new Map([[0, fakeScreen()]]), webcams: new Map(), stills: new Map() }).pixels;
  }

  /** Pixels that differ between `a` and `b`; with `outsideWindow`, only those the window's rounded rect leaves out. */
  function changed(a: Pixels, b: Pixels, outsideWindow = false): number {
    const { window, radius } = windowLayout(OUTPUT, SCREEN.width / SCREEN.height, { titleBar: FRAME_CHROME['mac-dark'].titleBar, radius: RADIUS });
    let count = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (outsideWindow) {
          // sdRoundRect from the shaders at the pixel centre; at d >= 0.5 the window covers nothing.
          const qx = Math.abs(x + 0.5 - window[0] - window[2] / 2) - window[2] / 2 + radius;
          const qy = Math.abs(y + 0.5 - window[1] - window[3] / 2) - window[3] / 2 + radius;
          const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
          if (d < 0.5) continue;
        }
        const i = (y * a.width + x) * 4;
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) count++;
      }
    }
    return count;
  }

  it('stays inside the window, also at its rounded corners', () => {
    // Pointer and a fresh click at the screen's bottom-right corner, where the tray and the clock are.
    const corner: CursorFrame = { x: 1270, y: 788, shape: 'arrow', clicks: [{ x: 1266, y: 786, progress: 0.3 }] };
    for (const style of ['system', 'dot', 'ring'] as const) {
      const without = renderCursor(style);
      const withCursor = renderCursor(style, corner);
      expect(changed(without, withCursor), style).toBeGreaterThan(0);
      expect(changed(without, withCursor, true), style).toBe(0);
    }
  });

  it('is not drawn while off the captured area, nor are its clicks', () => {
    const off: CursorFrame = { x: -10, y: 400, shape: 'arrow', clicks: [{ x: 1300, y: 400, progress: 0.3 }] };
    for (const style of ['system', 'spotlight'] as const) {
      expect(changed(renderCursor(style), renderCursor(style, off)), style).toBe(0);
    }
  });
});
