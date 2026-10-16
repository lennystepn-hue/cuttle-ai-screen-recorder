import { BACKGROUND_PRESETS, parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { pixelAt, readPixels } from './gl-util';

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
