// The Look tab's cursor and frame styles as small pictures the engine draws itself, so a swatch
// shows what the export shows. Drawn once per editor, when the Look tab first asks, one after the
// other on one offscreen canvas.
import { createRenderer, type EngineAssets, type FrameSources } from '@cuttle/engine';
import { CURSOR_STYLES, FRAME_STYLES, parseProject, type CursorStyle, type FrameStyle } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';

const SCREEN = { width: 1280, height: 800 };
const SWATCH = { width: 320, height: 180 };
/** The cursor rests here, on a calm part of the screen; its swatches zoom in on it so its art can be judged. */
const POINTER = { x: 1110, y: 300 };

/** A screen like an editor's, made of rects, for the swatches to frame and point at. */
function fakeScreen(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(SCREEN.width, SCREEN.height);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1E1E1E';
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = '#252526';
  g.fillRect(0, 0, 240, 800);
  const colors = ['#569CD6', '#CE9178', '#6A9955', '#DCDCAA', '#C586C0', '#9CDCFE'];
  for (let line = 0; line < 30; line++) {
    let x = 280 + (line % 4) * 32;
    for (let word = 0; word < 4; word++) {
      const width = 30 + ((line * 7 + word * 13) % 9) * 18;
      g.fillStyle = colors[(line + word) % colors.length]!;
      g.fillRect(x, 60 + line * 23, width, 12);
      x += width + 12;
    }
  }
  return canvas;
}

export type SwatchKey = `cursor:${CursorStyle}` | `frame:${FrameStyle}`;

/** One swatch: a one-clip project with the look to show, drawn at its first frame. */
function draw(canvas: OffscreenCanvas, assets: EngineAssets, screen: OffscreenCanvas, look: Record<string, unknown>, zoom?: number[]): Promise<Blob> {
  const parsed = parseProject({
    version: 1,
    output: { ...SWATCH, fps: 30 },
    sources: { screen: 'screen.mp4' },
    scenes: [{ type: 'clip', from: 0, to: 2 }],
    look: { background: { preset: 'solid', color: '#2B2B33' }, ...look },
    ...(zoom && { zooms: [{ at: 0, duration: 2, rect: zoom }] }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const cursor = createCursorTrack([{ t: 0, type: 'move', ...POINTER }]);
  const state = createTimeline(parsed.project, { screenSize: SCREEN, cursor }).frameAt(1);
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map() };
  for (const layer of state.layers) if (layer.kind === 'clip') sources.screens.set(layer.index, screen);
  const renderer = createRenderer(canvas, parsed.project, { assets, screenSize: SCREEN });
  try {
    renderer.render(state, sources);
  } finally {
    renderer.dispose();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

let drawn: Promise<Map<SwatchKey, string>> | undefined;

/** The swatches as object URLs, drawn on the first call (later calls share them). */
export function swatches(assets: EngineAssets): Promise<Map<SwatchKey, string>> {
  drawn ??= (async () => {
    const canvas = new OffscreenCanvas(SWATCH.width, SWATCH.height);
    const screen = fakeScreen();
    const urls = new Map<SwatchKey, string>();
    // frames: the whole window (the Look tab shows its top-left corner); cursors: close up, upper right
    for (const style of FRAME_STYLES) {
      const blob = await draw(canvas, assets, screen, { frame: { style, title: 'claude · ~/demo' }, cursor: { enabled: false } });
      urls.set(`frame:${style}`, URL.createObjectURL(blob));
    }
    for (const style of CURSOR_STYLES) {
      const blob = await draw(canvas, assets, screen, { frame: { enabled: false }, cursor: { style, clickEffect: 'none' } }, [POINTER.x - 56, POINTER.y - 16, 96, 60]);
      urls.set(`cursor:${style}`, URL.createObjectURL(blob));
    }
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    return urls;
  })().catch((error: unknown) => {
    drawn = undefined;
    throw error;
  });
  return drawn;
}
