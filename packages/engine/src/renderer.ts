import type { CardScene, CuttleProject, FrameStyle, Rect, Scene, StillScene, TextOverlay } from '@cuttle/project';
import type { ActiveCaption, ActiveText, KeyBadge, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { CAPTION_LOOKS, drawCaption } from './captions';
import { drawKeys } from './keys';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadPixels, uploadTexture } from './gl/texture';
import { blurSamples, placeBadge, placeOverlay, stillCrop, unitFor, uvRect, watermarkRect, webcamRect, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
import { MaskPass } from './passes/masks';
import { SpritePass } from './passes/sprite';
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import type { FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS, watermarkStyle } from './presets/labels';
import { SpriteCache } from './sprites';
import { frameLayout } from './view';

/** A motion page's frame: premultiplied RGBA, top row first (drawn over the whole output). */
export interface MotionPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Per-frame images, keyed by `SceneFrame.index`: during a crossfade two clip layers with
 * unrelated source times are visible at once.
 */
export interface FrameSources {
  /** Scene index → decoded screen frame at that layer's `sourceTime`. */
  screens: Map<number, TexImageSource>;
  /** Scene index → webcam frame at that layer's `sourceTime`; a scene without one (or with an empty one) shows no bubble. */
  webcams: Map<number, TexImageSource>;
  /**
   * Scene index → image of a still scene; created with `premultiplyAlpha: 'premultiply'`, not flipped,
   * and no larger than `MAX_TEXTURE_SIZE` on either side (render throws otherwise).
   */
  stills: Map<number, ImageBitmap>;
  /** Scene index → the frame of a motion scene; a scene without one shows the background alone (its page is not drawn yet). */
  motion: Map<number, MotionPixels>;
  /** `ActiveOverlay.key` → the frame of a motion overlay; one without a frame is left out. */
  overlays: Map<string, MotionPixels>;
  /**
   * `ActiveTransition.key` → the frame a transition page drew from the two layers (`layerPixels`); it
   * takes the place of their crossfade. Without one, the layers crossfade (its page is not drawn yet).
   */
  transitions?: Map<string, MotionPixels>;
}

export interface Renderer {
  /**
   * Draws `state` into the canvas. Throws when a visible clip or still has no image in `sources`, and
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /**
   * The two layers of a frame between two scenes, each drawn whole: what a transition page is given
   * (premultiplied RGBA at the output's size, top row first, opaque). Throws like `render`, and when
   * the frame has one layer. Leaves the canvas as it was.
   */
  layerPixels(state: RenderState, sources: FrameSources): [MotionPixels, MotionPixels];
  /** The text overlays the last `render` drew, where they are in the output (for picking one with the pointer). */
  drawnTexts(): readonly DrawnText[];
  /**
   * The scenes of a newer version of the project whose look and output are the same (an edit): the
   * layers' indices point into these from now on. Another look or output needs a new renderer.
   */
  setScenes(scenes: readonly Scene[]): void;
  /** Frees every GL object; `render` throws afterwards. Leaves the canvas and its context alone. */
  dispose(): void;
}

/** A text overlay as drawn: the overlay, and its box in output pixels. */
export interface DrawnText {
  overlay: TextOverlay;
  rect: Rect;
}

export interface RendererOptions {
  /** From `loadEngineAssets()`. */
  assets: EngineAssets;
  /** Size of the screen track in source px, the same as for `createTimeline`. */
  screenSize: Size;
  /** Required when `look.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
  /** The watermark's image (its own, else the brand's logo); without it a watermark shows its text. */
  watermarkImage?: ImageBitmap;
}

function hasPixels(source: TexImageSource): boolean {
  const { width, height } = sourceSize(source);
  return width > 0 && height > 0;
}

/** What transparent parts of a still image show: white, like a blank page. */
const STILL_MATTE: [number, number, number] = [1, 1, 1];

/** Share of the output width that card titles may use. */
const CARD_MAX_WIDTH = 0.84;
/** Gap between a card's title and subtitle boxes, in units. */
const CARD_GAP = 12;
/** Share of the output width that text overlays may use. */
const TEXT_MAX_WIDTH = 0.8;
/** Share of the content width that the speed badge may use. */
const BADGE_MAX_WIDTH = 0.5;
/** A shortcut's badge rises this far (units) into its place as it comes in, over these seconds. */
const KEY_RISE = 10;
const KEY_RISE_SECONDS = 0.2;

/**
 * A WebGL2 compositor for `cuttle.json` frames. Sizes the canvas to `project.output`. Layers are
 * drawn back to front: the first one opaque, each later one through an offscreen target blended
 * with its opacity, which turns the timeline's crossfade pair into A·(1−m) + B·m.
 */
export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, project: CuttleProject, options: RendererOptions): Renderer {
  const output: Size = { width: project.output.width, height: project.output.height };
  const { screenSize } = options;
  if (!(Number.isFinite(screenSize.width) && screenSize.width > 0 && Number.isFinite(screenSize.height) && screenSize.height > 0)) {
    throw new Error('createRenderer: screenSize must have a positive, finite width and height');
  }
  canvas.width = output.width;
  canvas.height = output.height;
  // HTMLCanvasElement.getContext has the same signature for 'webgl2'.
  const context = (canvas as OffscreenCanvas).getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!context) throw new Error('createRenderer: WebGL2 is not available');
  const gl: WebGL2RenderingContext = context;
  const look = project.look;
  const unit = unitFor(output);
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  // Texts and the badge keep clear of the webcam bubble. Taken from the look and the project's
  // sources, not from whether a webcam frame arrived, so they do not jump when the webcam track ends.
  const webcamArea =
    look.webcam.enabled && project.sources.webcam ? webcamRect(output, look.webcam) : undefined;
  const full: Rect = [0, 0, screenSize.width, screenSize.height];
  const screenAspect = screenSize.width / screenSize.height;

  // GL resources: everything created through own() and texture() is freed by dispose().
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const textures: WebGLTexture[] = [];
  const texture = (mipmaps: boolean): WebGLTexture => {
    const created = createTexture(gl, mipmaps);
    textures.push(created);
    return created;
  };
  const vao = gl.createVertexArray();
  const sprites = own(new SpriteCache(gl));
  const spritePass = own(new SpritePass(gl, output));
  const background = own(new BackgroundPass(gl, output, look.background, options.backgroundImage));
  const windowPass = own(new WindowPass(gl, output, sprites, spritePass));
  const content = own(new ContentPass(gl, output));
  const screenTexture = texture(true);
  const masks = own(new MaskPass(gl, output));
  const cursor = own(new CursorPass(gl, output, options.assets));
  const webcam = own(new WebcamPass(gl, output));
  const webcamTexture = texture(true);
  const stillTexture = texture(true);
  const motionTexture = texture(false);
  const fullFrame: Rect = [0, 0, output.width, output.height];
  let uploadedStill: ImageBitmap | undefined;
  // the watermark: an image uploaded once, else its text (its own, else the brand's name)
  const watermark = look.watermark.enabled ? look.watermark : undefined;
  const watermarkText = watermark && !options.watermarkImage ? (watermark.text ?? project.theme.name ?? '').trim() : '';
  let watermarkTexture: WebGLTexture | undefined;
  if (watermark && options.watermarkImage && options.watermarkImage.width > 0) {
    watermarkTexture = texture(true);
    uploadTexture(gl, watermarkTexture, options.watermarkImage, true);
  }
  let layerTarget: RenderTarget | undefined;
  let disposed = false;
  let drawn: DrawnText[] = [];
  let scenes: readonly Scene[] = project.scenes;

  /** The window for a frame style; `aspect` is the content's (a clip's crop, else the screen's). */
  function frame(style: FrameStyle | null, aspect = screenAspect): { chrome: FrameChrome | null; layout: WindowLayout } {
    return frameLayout(output, look, style, aspect);
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
  function drawTexts(texts: readonly ActiveText[], avoid: readonly Rect[]): void {
    for (const { overlay, opacity } of texts) {
      if (opacity <= 0) continue;
      const style = TEXT_LABELS[overlay.style];
      const sprite = sprites.label(overlay.text, style, unit, output.width * TEXT_MAX_WIDTH);
      const [x, y] = placeOverlay(output, sprite.box, overlay.position, style.align, avoid);
      spritePass.drawSprite(sprite, x, y, opacity);
      drawn.push({ overlay, rect: [x, y, sprite.box.width, sprite.box.height] });
    }
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null, layer.aspect);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    // A 0×0 source uploads nothing and leaves the old texture: black or a stale frame, no GL error thrown.
    if (!hasPixels(screen)) throw new Error(`render: the screen frame of scene ${layer.index} is empty (not decoded yet, or closed)`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    // motion blur: the screen smears along the zoom's way while the shutter was open, the masks
    // cover every place they had meanwhile, the pointer smears along its own way
    const from = layer.motion?.zoom;
    const samples = from ? blurSamples(from, zoom, layout.content) : 1;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout, undefined, samples > 1 && from ? { from: uvRect(from, screenSize), samples } : undefined);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout, samples > 1 ? from : undefined);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout, layer.motion);
    // a device's camera over its screen
    if (chrome) windowPass.drawOver(layout, chrome);
    // An empty webcam frame counts as missing: no bubble, as when the webcam track is shorter.
    const camera = look.webcam.enabled ? sources.webcams.get(layer.index) : undefined;
    if (camera && hasPixels(camera)) {
      uploadTexture(gl, webcamTexture, camera, true);
      webcam.draw(webcamTexture, sourceSize(camera), look.webcam);
    }
    // The badge is placed first so the texts can move clear of it; it is drawn on top of them.
    const badge = layer.badge ? sprites.label(layer.badge, BADGE_STYLE, unit, layout.content[2] * BADGE_MAX_WIDTH) : undefined;
    const badgeRect = badge ? placeBadge(layout.content, badge.box, unit, webcamArea) : undefined;
    drawTexts(layer.texts, [webcamArea, badgeRect].filter((rect): rect is Rect => rect !== undefined));
    if (badge && badgeRect) spritePass.drawSprite(badge, badgeRect[0], badgeRect[1], 1);
    // motion overlays: over the finished clip, zooms, masks and the cursor (captions come last)
    for (const overlay of layer.overlays) {
      const pixels = sources.overlays.get(overlay.key);
      if (pixels) drawMotion(pixels, `overlay ${overlay.index}`);
    }
  }

  /** A motion page's frame over the whole output, with its transparency. */
  function drawMotion(pixels: MotionPixels, what: string): void {
    if (!(pixels.width > 0 && pixels.height > 0) || pixels.data.byteLength !== pixels.width * pixels.height * 4) {
      throw new Error(`render: the frame of motion ${what} is ${pixels.width}×${pixels.height} px with ${pixels.data.byteLength} bytes`);
    }
    if (Math.max(pixels.width, pixels.height) > maxTextureSize) {
      throw new Error(`render: the frame of motion ${what} is ${pixels.width}×${pixels.height} px, more than this GPU's limit of ${maxTextureSize} px`);
    }
    uploadPixels(gl, motionTexture, pixels);
    spritePass.draw(motionTexture, fullFrame, 1);
  }

  function drawStill(layer: SceneFrame, scene: StillScene, sources: FrameSources): void {
    const { chrome, layout } = frame(scene.frame);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, '');
    const image = sources.stills.get(layer.index);
    if (!image) throw new Error(`render: no image for still scene ${layer.index}`);
    // WebGL only flags these with an error code and keeps the old texture: black or a stale image.
    if (!(image.width > 0 && image.height > 0)) throw new Error(`render: the image of still scene ${layer.index} is empty or closed`);
    if (Math.max(image.width, image.height) > maxTextureSize) {
      throw new Error(
        `render: the image of still scene ${layer.index} is ${image.width}×${image.height} px, more than this GPU's limit of ${maxTextureSize} px`,
      );
    }
    if (image !== uploadedStill) {
      uploadTexture(gl, stillTexture, image, true);
      uploadedStill = image;
    }
    const size = { width: image.width, height: image.height };
    const crop = stillCrop(size, { width: layout.content[2], height: layout.content[3] }, scene.motion, layer.progress);
    content.draw(stillTexture, uvRect(crop, size), layout, STILL_MATTE);
    if (chrome) windowPass.drawOver(layout, chrome);
  }

  function drawCard(scene: CardScene): void {
    const maxWidth = output.width * CARD_MAX_WIDTH;
    const title = sprites.label(scene.title, CARD_TITLE_STYLE, unit, maxWidth);
    const subtitle = scene.subtitle ? sprites.label(scene.subtitle, CARD_SUBTITLE_STYLE, unit, maxWidth) : undefined;
    const gap = Math.round(CARD_GAP * unit);
    let y = Math.round((output.height - title.box.height - (subtitle ? gap + subtitle.box.height : 0)) / 2);
    spritePass.drawSprite(title, Math.round((output.width - title.box.width) / 2), y, 1);
    if (subtitle) {
      y += title.box.height + gap;
      spritePass.drawSprite(subtitle, Math.round((output.width - subtitle.box.width) / 2), y, 1);
    }
  }

  /** The caption over the whole frame (also over a crossfade), clear of the webcam bubble; where it went. */
  function drawCaptionOver(caption: ActiveCaption): Rect {
    const { style, color, size, position } = project.captions;
    const lines = caption.cue.lines.map((line) => line.map((word) => word.text));
    const maxWidth = Math.round(output.width * CAPTION_LOOKS[style].maxWidth);
    const key = JSON.stringify(['caption', lines, caption.current, style, color, unit, size, maxWidth]);
    const sprite = sprites.drawn(key, () => drawCaption(lines, caption.current, style, color, unit, size, maxWidth));
    const placed = placeOverlay(output, sprite.box, position, 'center', webcamArea ? [webcamArea] : []);
    spritePass.drawSprite(sprite, placed[0], placed[1], 1);
    return placed;
  }

  /** The shortcut's badge over the whole frame, clear of the webcam bubble and the caption; it rises as it comes in. */
  function drawKeysOver(badge: KeyBadge, caption: Rect | undefined): void {
    const { position, size } = look.keys;
    const sprite = sprites.drawn(JSON.stringify(['keys', badge.keys, badge.count, unit, size]), () => drawKeys(badge.keys, badge.count, unit, size));
    const [x, y] = placeOverlay(output, sprite.box, position, 'center', [webcamArea, caption].filter((rect): rect is Rect => rect !== undefined));
    const rise = Math.round((1 - Math.min(1, badge.age / KEY_RISE_SECONDS)) * KEY_RISE * unit) * (position === 'top' ? -1 : 1);
    spritePass.drawSprite(sprite, x, y + rise, badge.opacity);
  }

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = scenes[layer.sceneIndex];
    if (!scene) throw new Error(`render: the project has no scene ${layer.sceneIndex}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else if (scene.type === 'still') drawStill(layer, scene, sources);
    else {
      const pixels = sources.motion.get(layer.index);
      if (pixels) drawMotion(pixels, `scene ${layer.sceneIndex}`);
    }
  }

  function begin(what: string): void {
    if (disposed) throw new Error(`${what}: the renderer was disposed`);
    // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
    if (gl.isContextLost()) throw new Error(`${what}: the WebGL context was lost`);
    drawn = [];
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, output.width, output.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
  }

/** The watermark over everything, last, in its corner. */
  function drawWatermark(): void {
    if (!watermark) return;
    const image = options.watermarkImage;
    if (watermarkTexture && image) {
      spritePass.draw(watermarkTexture, watermarkRect(output, watermark, image.width / image.height, webcamArea), watermark.opacity);
      return;
    }
    if (watermarkText === '') return;
    const height = Math.round(watermark.size * Math.min(output.width, output.height));
    const sprite = sprites.label(watermarkText, watermarkStyle(height, unit), unit, output.width * 0.5);
    const [x, y] = watermarkRect(output, watermark, sprite.box.width / sprite.box.height, webcamArea);
    spritePass.drawSprite(sprite, x, y, watermark.opacity);
  }

  /** One layer drawn whole into the offscreen target and read back, top row first. */
  function readLayer(layer: SceneFrame, sources: FrameSources, t: number): MotionPixels {
    layerTarget ??= createRenderTarget(gl, output);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layerTarget.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawLayer(layer, sources, t);
    const { width, height } = output;
    const bottomUp = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const data = new Uint8Array(bottomUp.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) data.set(bottomUp.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return { width, height, data };
  }

  return {
    render(state, sources) {
      begin('render');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // a transition page's frame takes the place of the two layers' crossfade
      const between = state.transition ? sources.transitions?.get(state.transition.key) : undefined;
      if (between) {
        background.draw(state.t);
        drawMotion(between, `transition into scene ${state.transition!.sceneIndex}`);
        const caption = state.caption ? drawCaptionOver(state.caption) : undefined;
        if (state.keys) drawKeysOver(state.keys, caption);
        drawWatermark();
        sprites.endFrame();
        return;
      }
      const [first, ...rest] = state.layers;
      if (first) drawLayer(first, sources, state.t);
      for (const layer of rest) {
        if (layer.opacity <= 0) continue;
        layerTarget ??= createRenderTarget(gl, output);
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerTarget.framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawLayer(layer, sources, state.t);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        spritePass.draw(layerTarget.texture, [0, 0, output.width, output.height], layer.opacity, true);
      }
      const caption = state.caption ? drawCaptionOver(state.caption) : undefined;
      if (state.keys) drawKeysOver(state.keys, caption);
      drawWatermark();
      sprites.endFrame();
    },
    layerPixels(state, sources) {
      begin('layerPixels');
      const [outgoing, incoming] = state.layers;
      if (!outgoing || !incoming) throw new Error('layerPixels: the frame shows one scene, not two');
      const pixels: [MotionPixels, MotionPixels] = [readLayer(outgoing, sources, state.t), readLayer(incoming, sources, state.t)];
      sprites.endFrame();
      return pixels;
    },
    drawnTexts: () => drawn,
    setScenes(next) {
      scenes = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resource of owned) resource.dispose();
      for (const created of textures) gl.deleteTexture(created);
      if (layerTarget) deleteRenderTarget(gl, layerTarget);
      gl.deleteVertexArray(vao);
      uploadedStill = undefined;
    },
  };
}
