import { parseProject } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';
import type { EngineAssets } from '../src/assets';
import { createRenderer, type FrameSources } from '../src/renderer';
import { SCREEN, fixtures } from './fixtures';
import { readPixels, type Pixels } from './gl-util';
import type { Scenario } from './scenarios';

/** Renders one scenario through the real timeline and returns its pixels, top row first. */
export async function renderScenario(scenario: Scenario, assets: EngineAssets): Promise<Pixels> {
  const parsed = parseProject(scenario.project);
  if (!parsed.ok) throw new Error(`scenario ${scenario.name}: ${JSON.stringify(parsed.issues)}`);
  const project = parsed.project;
  const cursor = scenario.events ? createCursorTrack(scenario.events) : undefined;
  const state = createTimeline(project, { screenSize: SCREEN, cursor, ...(scenario.transcript && { transcript: scenario.transcript }) }).frameAt(scenario.t);

  const fake = await fixtures();
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  for (const layer of state.layers) {
    if (layer.kind === 'clip') {
      sources.screens.set(layer.index, fake.screen);
      if (scenario.webcam) sources.webcams.set(layer.index, fake.webcam);
    } else if (layer.kind === 'still') {
      sources.stills.set(layer.index, fake.page);
    }
  }

  const canvas = new OffscreenCanvas(1, 1);
  const renderer = createRenderer(canvas, project, {
    assets,
    screenSize: SCREEN,
    backgroundImage: project.look.background.preset === 'image' ? fake.background : undefined,
  });
  const gl = canvas.getContext('webgl2')!;
  try {
    renderer.render(state, sources);
    return readPixels(gl);
  } finally {
    renderer.dispose();
    // Browsers keep only ~16 live WebGL contexts; free this one now instead of waiting for GC.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
