// The Look tab's cursor and frame styles as small pictures the engine draws itself, so a swatch
// shows what the export shows. Each is drawn when the Look tab first asks for it, one after the
// other on one offscreen canvas (freed once none is waiting), and kept; the dot, ring and spotlight
// are drawn in the cursor's colour, and again when it changes.
import { createRenderer, type EngineAssets, type FrameSources } from '@cuttle/engine';
import { parseProject, type CursorShape, type CursorStyle, type FrameStyle, type InputEvent, type Rect } from '@cuttle/project';
import { createCursorTrack, createTimeline } from '@cuttle/timeline';

/** A picture's size in px: the tiles show it at about a third, so it stays sharp on a 2× screen. */
const TILE = { width: 320, height: 180 };

export type SwatchKey = `cursor:${CursorStyle}` | `frame:${FrameStyle}`;

/** The styles drawn in the cursor's colour. */
const COLOURED = new Set<SwatchKey>(['cursor:dot', 'cursor:ring', 'cursor:spotlight']);
export const isColoured = (key: SwatchKey) => COLOURED.has(key);

/**
 * A screen like an editor's, made of rects: a side bar, lines of code, and on the right a calm
 * panel for the cursor to rest on.
 */
function editorScreen(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  const side = Math.round(width * 0.19);
  const panel = width > height ? Math.round(width * 0.75) : width;
  g.fillStyle = '#1E1E1E';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#252526';
  g.fillRect(0, 0, side, height);
  g.fillRect(panel, 0, width - panel, height);
  const colors = ['#569CD6', '#CE9178', '#6A9955', '#DCDCAA', '#C586C0', '#9CDCFE'];
  g.save();
  g.beginPath();
  g.rect(side, 0, panel - side - 24, height);
  g.clip();
  for (let line = 0; line * 23 + 60 < height; line++) {
    let x = side + 40 + (line % 4) * 32;
    for (let word = 0; word < 4; word++) {
      const w = 30 + ((line * 7 + word * 13) % 9) * 18;
      g.fillStyle = colors[(line + word) % colors.length]!;
      g.fillRect(x, 60 + line * 23, w, 12);
      x += w + 12;
    }
  }
  g.restore();
  return canvas;
}

/**
 * Frames: a narrow window in a square output, so its whole title bar (controls, title, address
 * field) shows large; the picture is the band from just above the window down into its content.
 */
const FRAME_OUTPUT = { width: 1080, height: 1080 };
const FRAME_SCREEN = { width: 560, height: 1280 };
/** The band shown, in the output's px: the window (about 400 px wide) starts 64 px down, centred. */
const FRAME_BAND: Rect = [300, 34, 480, 270];

/** Cursors: the screen fills the picture; a zoom this wide (source px) makes the art about 130 px. */
const CURSOR_SCREEN = { width: 1280, height: 720 };
const CURSOR_ZOOM = 52;
/** Where the cursor rests: on the calm panel; the spotlight's on the code, so its dimming shows. */
const REST = { x: 1120, y: 300 };
const ON_CODE = { x: 560, y: 220 };
/** From the hotspot to the middle of the art, in source px at size 1 (the art's 32 grid, scaled). */
const ART_MIDDLE: Partial<Record<CursorShape | 'arrow', [number, number]>> = { arrow: [5.6, 8.4], pointer: [1.5, 8.2], text: [0, 0] };

type Shot = { output: { width: number; height: number }; screen: OffscreenCanvas; look: Record<string, unknown>; zoom?: Rect; at: { x: number; y: number }; shape?: CursorShape };

/** One frame of a one-clip project with the look to show, drawn on `gl`. */
function render(gl: OffscreenCanvas, assets: EngineAssets, shot: Shot): void {
  const screenSize = { width: shot.screen.width, height: shot.screen.height };
  const parsed = parseProject({
    version: 1,
    output: { ...shot.output, fps: 30 },
    sources: { screen: 'screen.mp4' },
    scenes: [{ type: 'clip', from: 0, to: 2 }],
    look: { background: { preset: 'solid', color: '#2B2B33' }, ...shot.look },
    ...(shot.zoom && { zooms: [{ at: 0, duration: 2, rect: shot.zoom }] }),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const events: InputEvent[] = [{ t: 0, type: 'move', ...shot.at }];
  if (shot.shape) events.push({ t: 0, type: 'shape', shape: shot.shape });
  const state = createTimeline(parsed.project, { screenSize, cursor: createCursorTrack(events) }).frameAt(1);
  const sources: FrameSources = { screens: new Map(), webcams: new Map(), stills: new Map(), motion: new Map(), overlays: new Map() };
  for (const layer of state.layers) if (layer.kind === 'clip') sources.screens.set(layer.index, shot.screen);
  const renderer = createRenderer(gl, parsed.project, { assets, screenSize });
  try {
    renderer.render(state, sources);
  } finally {
    renderer.dispose();
  }
}

/** A zoom of `width` source px, in the picture's shape, with the art's middle in its middle. */
function zoomOn(at: { x: number; y: number }, middle: [number, number] = [0, 0], width = CURSOR_ZOOM): Rect {
  const height = (width * TILE.height) / TILE.width;
  return [at.x + middle[0] - width / 2, at.y + middle[1] - height / 2, width, height];
}

/** Draws one swatch's picture on `tile` (2D), rendering on `gl`. */
function paint(key: SwatchKey, color: string, gl: OffscreenCanvas, tile: OffscreenCanvasRenderingContext2D, assets: EngineAssets): void {
  const [kind, style] = key.split(':') as ['frame' | 'cursor', string];
  if (kind === 'frame') {
    const screen = editorScreen(FRAME_SCREEN.width, FRAME_SCREEN.height);
    render(gl, assets, { output: FRAME_OUTPUT, screen, look: { frame: { style, title: 'claude · ~/demo' }, cursor: { enabled: false } }, at: { x: 0, y: 0 } });
    tile.drawImage(gl, ...FRAME_BAND, 0, 0, TILE.width, TILE.height);
    return;
  }
  const screen = editorScreen(CURSOR_SCREEN.width, CURSOR_SCREEN.height);
  const look = (cursorStyle: string) => ({ frame: { enabled: false }, cursor: { style: cursorStyle, clickEffect: 'none', smoothing: 0, ...(color && { color }) } });
  if (style === 'system') {
    // it follows the app's pointer: the arrow, the hand and the text beam side by side, a bit smaller
    const third = TILE.width / 3;
    (['arrow', 'pointer', 'text'] as const).forEach((shape, i) => {
      render(gl, assets, { output: TILE, screen, look: look(style), zoom: zoomOn(REST, ART_MIDDLE[shape], CURSOR_ZOOM * 1.3), at: REST, shape });
      tile.drawImage(gl, third, 0, third, TILE.height, i * third, 0, third, TILE.height);
    });
    return;
  }
  // the spotlight from further away, so the dimmed screen around its light shows
  const zoom = style === 'spotlight' ? zoomOn(ON_CODE, [0, 0], CURSOR_ZOOM * 12) : zoomOn(REST, style.startsWith('arrow') ? ART_MIDDLE.arrow : [0, 0]);
  render(gl, assets, { output: TILE, screen, look: look(style), zoom, at: style === 'spotlight' ? ON_CODE : REST });
  tile.drawImage(gl, 0, 0, TILE.width, TILE.height);
}

// one canvas for the engine, shared by the swatches waiting in line, freed when the line is empty
let gl: OffscreenCanvas | undefined;
let line: Promise<unknown> = Promise.resolve();
let waiting = 0;

function drawn(key: SwatchKey, color: string, assets: EngineAssets): Promise<string> {
  waiting++;
  const job = line.then(async () => {
    const tile = new OffscreenCanvas(TILE.width, TILE.height);
    try {
      gl ??= new OffscreenCanvas(1, 1);
      const g = tile.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      paint(key, color, gl, g, assets);
    } finally {
      if (--waiting === 0) {
        // one context fewer for the page (browsers keep about 16)
        gl?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
        gl = undefined;
      }
    }
    return URL.createObjectURL(await tile.convertToBlob({ type: 'image/png' }));
  });
  line = job.catch(() => {});
  return job;
}

/** The pictures asked for so far, by key and, for the coloured ones, colour (one colour kept each). */
const pictures = new Map<SwatchKey, { color: string; url: Promise<string> }>();

/**
 * A style's picture as an object URL: drawn on the first ask, then kept; a coloured one is drawn
 * again for another colour. A failure is said in the log and tried again on the next ask.
 */
export function swatch(assets: EngineAssets, key: SwatchKey, color: string): Promise<string> {
  const tint = isColoured(key) ? color.toLowerCase() : '';
  const known = pictures.get(key);
  if (known?.color === tint) return known.url;
  const url = drawn(key, tint, assets);
  pictures.set(key, { color: tint, url });
  url.then(
    // the old colour's picture is not needed any more
    () => void known?.url.then((old) => URL.revokeObjectURL(old), () => {}),
    (error: unknown) => {
      if (pictures.get(key)?.url === url) pictures.delete(key);
      console.warn(`the Look tab’s ${key} picture could not be drawn:`, error);
    },
  );
  return url;
}
