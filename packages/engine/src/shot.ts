import { SHOT_MAX_SIDE, shotRatio, type Rect, type Shot, type ThemeFont } from '@cuttle/project';
import { headingFamily, headingFontReady, headingWeight } from './fonts';
import { createTexture, uploadTexture } from './gl/texture';
import { uvRect, watermarkRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { MaskPass } from './passes/masks';
import { SpritePass } from './passes/sprite';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, WINDOW_SHADOW } from './presets/frames';
import { watermarkStyle, type LabelStyle } from './presets/labels';
import { SpriteCache } from './sprites';

/** A headline's type in points at the least: the title, the line under it, the gap between them and the room to the shot. */
const HEADLINE = { title: 40, subtitle: 20, gap: 8, space: 28 } as const;
/** The title's height as a share of the shot's width: a large shot's headline grows with it (all of its type alike). */
const HEADLINE_SHARE = 0.06;

/** A headline's type in points for a shot `width` points wide. */
type HeadlineType = { -readonly [K in keyof typeof HEADLINE]: number };
function headlineType(width: number): HeadlineType {
  const grow = Math.max(1, (width * HEADLINE_SHARE) / HEADLINE.title);
  return { title: HEADLINE.title * grow, subtitle: HEADLINE.subtitle * grow, gap: HEADLINE.gap * grow, space: HEADLINE.space * grow };
}

/** A headline's text styles in a colour: the title in the shot's font, the line under it in Inter, a little quieter. */
function headlineStyles(color: string, font: ThemeFont, type: HeadlineType): { title: LabelStyle; subtitle: LabelStyle } {
  const base = { padX: 0, padY: 0, radius: 0, align: 'center' as const };
  return {
    title: { ...base, size: type.title, weight: headingWeight(font), family: headingFamily(font), color },
    subtitle: { ...base, size: type.subtitle, weight: 400, color: `${color}cc` },
  };
}

/** A box of a label's height at `unit` px a point (as `drawLabel` makes it: 1.3 em, no padding). */
const lineHeight = (points: number, unit: number) => Math.round(Math.max(1, Math.round(points * unit)) * 1.3);

/** Where a shot is drawn: the canvas, the window in it, and the scale everything is drawn at. */
export interface ShotLayout {
  output: Size;
  layout: WindowLayout;
  /** Output px per point: the frame, the padding and the shadow are drawn at it (the chrome's unit). */
  scale: number;
  /** The part of the image shown, in image px. */
  crop: Rect;
  /** The headline's lines: the top of each (output px), how wide they may be, and its type (points). */
  headline?: { title: number; subtitle?: number; maxWidth: number; type: HeadlineType };
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

/** The headline's height at `unit` px a point, its room to the shot included; 0 without one. */
function headlineBand(shot: Shot, type: HeadlineType, unit: number): number {
  if (!shot.headline) return 0;
  const subtitle = shot.headline.subtitle ? Math.round(type.gap * unit) + lineHeight(type.subtitle, unit) : 0;
  return lineHeight(type.title, unit) + subtitle + Math.round(type.space * unit);
}

/** The side a headline goes on: away from an edge the shot bleeds past. */
function headlineSide(shot: Shot): 'above' | 'below' {
  const position = shot.headline?.position ?? 'above';
  if (shot.bleed > 0 && shot.align === 'top') return 'below';
  if (shot.bleed > 0 && shot.align === 'bottom') return 'above';
  return position;
}

/**
 * Where a shot of an `image` (px) goes at `scale` output px per point (default the shot's own: the
 * image pixel for pixel), with its headline. `auto`: the framed shot and its padding; a ratio: the
 * canvas grows to it; pixels: the shot is fitted in, smaller when it must be, never larger. In a
 * canvas larger than it the shot sits as `align` says, and `bleed` of it reaches past that edge.
 * Whole pixels.
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
  const type = headlineType(crop[2] / shot.scale);
  let at = scale;
  let parts = framed(shot, crop, at);
  const bleeds = shot.bleed > 0 && shot.align !== 'center';
  /** What of the window shows (a bleed cuts it at its edge), and the margins without the one it bleeds past. */
  const shown = (p: typeof parts) => {
    const cut = (length: number) => Math.round(length * (1 - shot.bleed));
    const width = bleeds && (shot.align === 'left' || shot.align === 'right') ? cut(p.window.width) : p.window.width;
    const height = bleeds && (shot.align === 'top' || shot.align === 'bottom') ? cut(p.window.height) : p.window.height;
    const margins = { ...p.margins, ...(bleeds && { [shot.align]: 0 }) } as typeof p.margins;
    return { width, height, margins };
  };
  const box = (p: typeof parts, unit: number): Size => {
    const { width, height, margins } = shown(p);
    return { width: width + margins.left + margins.right, height: height + headlineBand(shot, type, unit) + margins.top + margins.bottom };
  };
  let natural = box(parts, at);
  let output: Size;
  if (typeof shot.size === 'object') {
    output = { width: shot.size.width, height: shot.size.height };
    // too large: everything smaller, so it fits (the chrome too); rounding may want one step more
    for (let step = 0; step < 4 && (natural.width > output.width || natural.height > output.height); step++) {
      at *= Math.min(output.width / natural.width, output.height / natural.height) * (step === 0 ? 1 : 0.995);
      parts = framed(shot, crop, at);
      natural = box(parts, at);
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
  const { window, layout } = parts;
  const { margins } = shown(parts);
  // the framed shot, its headline and its margins where `align` puts them in the canvas
  const slack = { x: output.width - natural.width, y: output.height - natural.height };
  const left = shot.align === 'left' ? 0 : shot.align === 'right' ? slack.x : Math.round(slack.x / 2);
  const top = shot.align === 'top' ? 0 : shot.align === 'bottom' ? slack.y : Math.round(slack.y / 2);
  const band = headlineBand(shot, type, at);
  const above = shot.headline !== undefined && headlineSide(shot) === 'above';
  // a bleed moves the window past its edge by what is cut of it
  const x = left + margins.left - (bleeds && shot.align === 'left' ? window.width - shown(parts).width : 0);
  const y = top + margins.top + (above ? band : 0) - (bleeds && shot.align === 'top' ? window.height - shown(parts).height : 0);
  const windowRect: Rect = [x, y, window.width, window.height];
  const headline = shot.headline
    ? (() => {
        const space = Math.round(type.space * at);
        const titleTop = above ? top + margins.top : y + window.height + space;
        const subtitle = shot.headline.subtitle ? titleTop + lineHeight(type.title, at) + Math.round(type.gap * at) : undefined;
        return { title: titleTop, ...(subtitle !== undefined && { subtitle }), maxWidth: Math.max(1, output.width - 2 * Math.round(shot.padding * at)), type };
      })()
    : undefined;
  const content: Rect = [x + layout.band, y + layout.titleBar + layout.band, window.width - 2 * layout.band, window.height - layout.titleBar - 2 * layout.band];
  const device = FRAME_CHROME[shot.frame.style].device !== undefined;
  return {
    output,
    layout: { window: windowRect, content, radius: layout.radius, titleBar: layout.titleBar, clip: device ? content : windowRect, clipRadius: layout.clipRadius },
    scale: at,
    crop,
    ...(headline && { headline }),
  };
}

export interface ShotOptions {
  /** Output px per point; default the shot's own scale (the image pixel for pixel). */
  scale?: number;
  /** Required when `shot.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
  /** The watermark's image (`shot.watermark.image`); without it the watermark shows its text. */
  watermarkImage?: ImageBitmap;
}

/**
 * Draws a shot into `canvas` (sized to it) with the video's passes: the background (or nothing when
 * transparent), the window's shadow and chrome, the image clipped to its corners. The image is
 * premultiplied and not flipped, as a still's (`loadImage`); its transparency is kept. Call it after
 * `loadEngineAssets()` and `loadHeadingFont(shot.font)`, which load the fonts its texts are set in. The
 * canvas holds the shot afterwards (read it with `convertToBlob`); every GL object is freed.
 */
export function drawShot(canvas: HTMLCanvasElement | OffscreenCanvas, shot: Shot, image: ImageBitmap, options: ShotOptions = {}): ShotLayout {
  if (!(image.width > 0 && image.height > 0)) throw new Error('drawShot: the image is empty or closed');
  // a font not loaded yet would be drawn in another without a word
  const setsText = shot.headline !== undefined || (shot.watermark?.text !== undefined && !options.watermarkImage);
  if (setsText && !headingFontReady(shot.font)) throw new Error(`drawShot: the font ${shot.font} is not loaded (await loadHeadingFont first)`);
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
    const size = { width: image.width, height: image.height };
    own(new ContentPass(gl, output)).draw(texture, uvRect(crop, size), layout, null);
    own(new MaskPass(gl, output)).draw(shot.masks, texture, size, crop, layout);
    windowPass.drawOver(layout, chrome);
    // the headline on the background, centred
    if (shot.headline && placed.headline) {
      const styles = headlineStyles(shot.headline.color ?? (shot.transparent ? '#16161A' : '#FFFFFF'), shot.font, placed.headline.type);
      const lines: [string | undefined, LabelStyle, number | undefined][] = [
        [shot.headline.title, styles.title, placed.headline.title],
        [shot.headline.subtitle, styles.subtitle, placed.headline.subtitle],
      ];
      for (const [text, style, top] of lines) {
        if (!text || top === undefined) continue;
        const sprite = sprites.label(text, style, scale, placed.headline.maxWidth);
        spritePass.drawSprite(sprite, Math.round((output.width - sprite.box.width) / 2), top, 1);
      }
    }
    // the watermark in its corner, last: a logo, else its text
    const watermark = shot.watermark;
    if (watermark && options.watermarkImage && options.watermarkImage.width > 0) {
      const logo = createTexture(gl, true);
      try {
        uploadTexture(gl, logo, options.watermarkImage, true);
        spritePass.draw(logo, watermarkRect(output, watermark, options.watermarkImage.width / options.watermarkImage.height), watermark.opacity);
      } finally {
        gl.deleteTexture(logo);
      }
    } else if (watermark?.text) {
      const unit = Math.min(output.width, output.height) / 1080;
      const height = Math.round(watermark.size * Math.min(output.width, output.height));
      const sprite = sprites.label(watermark.text, { ...watermarkStyle(height, unit), weight: headingWeight(shot.font), family: headingFamily(shot.font) }, unit, output.width * 0.5);
      const [wx, wy] = watermarkRect(output, watermark, sprite.box.width / sprite.box.height);
      spritePass.drawSprite(sprite, wx, wy, watermark.opacity);
    }
    if (gl.isContextLost()) throw new Error('drawShot: the WebGL context was lost');
  } finally {
    for (const resource of owned) resource.dispose();
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
  }
  return placed;
}
