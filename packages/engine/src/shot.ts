import { SHOT_MAX_SIDE, shotRatio, type Rect, type Shot } from '@cuttle/project';
import { createTexture, uploadTexture } from './gl/texture';
import { uvRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { SpritePass } from './passes/sprite';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, WINDOW_SHADOW } from './presets/frames';
import { SpriteCache } from './sprites';

/** Where a shot is drawn: the canvas, the window in it, and the scale everything is drawn at. */
export interface ShotLayout {
  output: Size;
  layout: WindowLayout;
  /** Output px per point: the frame, the padding and the shadow are drawn at it (the chrome's unit). */
  scale: number;
  /** The part of the image shown, in image px. */
  crop: Rect;
}

/** How far the window's shadow reaches past each side of it, in output px (`WindowPass`'s shadow). */
function shadowReach(unit: number): { side: number; top: number; bottom: number } {
  const blur = WINDOW_SHADOW.blur * unit;
  const offset = WINDOW_SHADOW.offset * unit;
  return { side: Math.ceil(blur), top: Math.ceil(Math.max(0, blur - offset)), bottom: Math.ceil(blur + offset) };
}

/** The window and the canvas at `scale` output px per point, the window at the canvas's top left margin. */
function framed(shot: Shot, crop: Rect, scale: number): { window: Size; layout: Omit<WindowLayout, 'window' | 'content' | 'clip'> & { band: number }; margins: { left: number; top: number; right: number; bottom: number } } {
  const chrome = FRAME_CHROME[shot.frame.style];
  // the image keeps its pixels at the shot's own scale
  const k = scale / shot.scale;
  const width = Math.max(1, Math.round(crop[2] * k));
  const height = Math.max(1, Math.round(crop[3] * k));
  let band = 0;
  let titleBar = 0;
  let radius: number;
  let clipRadius: number;
  let window: Size;
  if (chrome.device) {
    band = Math.round(chrome.device.bezel * Math.min(width, height));
    window = { width: width + 2 * band, height: height + 2 * band };
    radius = Math.min(chrome.device.radius * Math.min(window.width, window.height), window.width / 2, window.height / 2);
    clipRadius = Math.max(0, radius - band);
  } else {
    titleBar = Math.round(chrome.titleBar * scale);
    window = { width, height: height + titleBar };
    radius = Math.min(shot.frame.radius * scale, window.width / 2, window.height / 2);
    clipRadius = radius;
  }
  const padding = Math.round(shot.padding * scale);
  // on nothing, the canvas keeps the whole shadow: its edge would cut it
  const reach = shot.transparent && shot.frame.shadow ? shadowReach(scale) : { side: 0, top: 0, bottom: 0 };
  const margins = { left: Math.max(padding, reach.side), top: Math.max(padding, reach.top), right: Math.max(padding, reach.side), bottom: Math.max(padding, reach.bottom) };
  return { window, layout: { radius, titleBar, clipRadius, band }, margins };
}

/**
 * Where a shot of an `image` (px) goes at `scale` output px per point (default the shot's own: the
 * image pixel for pixel). `auto`: the framed shot and its padding; a ratio: the canvas grows to it,
 * the shot centred; pixels: the shot is fitted in, smaller when it must be, never larger. Whole pixels.
 */
export function shotLayout(shot: Shot, image: Size, scale = shot.scale): ShotLayout {
  if (!(scale > 0 && Number.isFinite(scale))) throw new Error('shotLayout: the scale must be a positive number');
  const crop: Rect = shot.crop
    ? (() => {
        const x = Math.min(Math.max(0, Math.round(shot.crop[0])), image.width - 1);
        const y = Math.min(Math.max(0, Math.round(shot.crop[1])), image.height - 1);
        return [x, y, Math.max(1, Math.min(Math.round(shot.crop[2]), image.width - x)), Math.max(1, Math.min(Math.round(shot.crop[3]), image.height - y))];
      })()
    : [0, 0, image.width, image.height];
  let at = scale;
  let parts = framed(shot, crop, at);
  const box = (p: typeof parts): Size => ({ width: p.window.width + p.margins.left + p.margins.right, height: p.window.height + p.margins.top + p.margins.bottom });
  let natural = box(parts);
  let output: Size;
  if (typeof shot.size === 'object') {
    output = { width: shot.size.width, height: shot.size.height };
    // too large: everything smaller, so it fits (the chrome too); rounding may want one step more
    for (let step = 0; step < 4 && (natural.width > output.width || natural.height > output.height); step++) {
      at *= Math.min(output.width / natural.width, output.height / natural.height) * (step === 0 ? 1 : 0.995);
      parts = framed(shot, crop, at);
      natural = box(parts);
    }
  } else {
    const ratio = shot.size === 'auto' ? undefined : shotRatio(shot.size);
    output = !ratio
      ? natural
      : natural.width / natural.height < ratio
        ? { width: Math.round(natural.height * ratio), height: natural.height }
        : { width: natural.width, height: Math.round(natural.width / ratio) };
  }
  if (output.width > SHOT_MAX_SIDE || output.height > SHOT_MAX_SIDE) {
    throw new Error(`the shot would be ${output.width}×${output.height} px, more than ${SHOT_MAX_SIDE} px on a side: draw it at a smaller scale`);
  }
  const { window, layout, margins } = parts;
  // the framed shot and its margins centred in the canvas
  const x = Math.round((output.width - natural.width) / 2) + margins.left;
  const y = Math.round((output.height - natural.height) / 2) + margins.top;
  const windowRect: Rect = [x, y, window.width, window.height];
  const content: Rect = [x + layout.band, y + layout.titleBar + layout.band, window.width - 2 * layout.band, window.height - layout.titleBar - 2 * layout.band];
  const device = FRAME_CHROME[shot.frame.style].device !== undefined;
  return {
    output,
    layout: { window: windowRect, content, radius: layout.radius, titleBar: layout.titleBar, clip: device ? content : windowRect, clipRadius: layout.clipRadius },
    scale: at,
    crop,
  };
}

export interface ShotOptions {
  /** Output px per point; default the shot's own scale (the image pixel for pixel). */
  scale?: number;
  /** Required when `shot.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
}

/**
 * Draws a shot into `canvas` (sized to it) with the video's passes: the background (or nothing when
 * transparent), the window's shadow and chrome, the image clipped to its corners. The image is
 * premultiplied and not flipped, as a still's (`loadImage`); its transparency is kept. Call it after
 * `loadEngineAssets()`, which loads the title's font. The canvas holds the shot afterwards (read it
 * with `convertToBlob`); every GL object is freed.
 */
export function drawShot(canvas: HTMLCanvasElement | OffscreenCanvas, shot: Shot, image: ImageBitmap, options: ShotOptions = {}): ShotLayout {
  if (!(image.width > 0 && image.height > 0)) throw new Error('drawShot: the image is empty or closed');
  const placed = shotLayout(shot, { width: image.width, height: image.height }, options.scale);
  const { output, layout, scale, crop } = placed;
  canvas.width = output.width;
  canvas.height = output.height;
  const gl = (canvas as OffscreenCanvas).getContext('webgl2', {
    alpha: shot.transparent,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('drawShot: WebGL2 is not available');
  if (gl.isContextLost()) throw new Error('drawShot: the WebGL context was lost');
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (Math.max(image.width, image.height) > maxTextureSize) {
    throw new Error(`drawShot: the image is ${image.width}×${image.height} px, more than this GPU's limit of ${maxTextureSize} px`);
  }
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const vao = gl.createVertexArray();
  const texture = createTexture(gl, true);
  try {
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, output.width, output.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, shot.transparent ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const sprites = own(new SpriteCache(gl));
    const spritePass = own(new SpritePass(gl, output));
    const chrome = FRAME_CHROME[shot.frame.style];
    if (!shot.transparent) own(new BackgroundPass(gl, output, shot.background, options.backgroundImage)).draw(0);
    const windowPass = own(new WindowPass(gl, output, sprites, spritePass, scale));
    windowPass.draw(layout, chrome, shot.frame.shadow, shot.frame.title);
    uploadTexture(gl, texture, image, true);
    own(new ContentPass(gl, output)).draw(texture, uvRect(crop, { width: image.width, height: image.height }), layout, null);
    windowPass.drawOver(layout, chrome);
    if (gl.isContextLost()) throw new Error('drawShot: the WebGL context was lost');
  } finally {
    for (const resource of owned) resource.dispose();
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
  }
  return placed;
}
