import type { CardScene, CuttleProject, FrameStyle, Rect, StillScene } from '@cuttle/project';
import type { ActiveText, RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, sourceSize, uploadTexture } from './gl/texture';
import { placeBadge, placeOverlay, stillCrop, unitFor, uvRect, webcamRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
import { MaskPass } from './passes/masks';
import { SpritePass } from './passes/sprite';
import { WebcamPass } from './passes/webcam';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';
import { BADGE_STYLE, CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE, TEXT_LABELS } from './presets/labels';
import { SpriteCache } from './sprites';

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
}

export interface Renderer {
  /**
   * Draws `state` into the canvas. Throws when a visible clip or still has no image in `sources`, and
   * when the WebGL context was lost (create a new renderer after `webglcontextrestored`).
   */
  render(state: RenderState, sources: FrameSources): void;
  /** Frees every GL object; `render` throws afterwards. Leaves the canvas and its context alone. */
  dispose(): void;
}

export interface RendererOptions {
  /** From `loadEngineAssets()`. */
  assets: EngineAssets;
  /** Size of the screen track in source px, the same as for `createTimeline`. */
  screenSize: Size;
  /** Required when `look.background.preset` is `image`. */
  backgroundImage?: ImageBitmap;
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
    look.webcam.enabled && project.sources.webcam ? webcamRect(output, look.webcam.corner, look.webcam.size) : undefined;
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
  let uploadedStill: ImageBitmap | undefined;
  let layerTarget: RenderTarget | undefined;
  let disposed = false;

  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, screenAspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  /** `avoid`: rects the texts move clear of (the webcam bubble, the badge). */
  function drawTexts(texts: readonly ActiveText[], avoid: readonly Rect[]): void {
    for (const { overlay, opacity } of texts) {
      if (opacity <= 0) continue;
      const style = TEXT_LABELS[overlay.style];
      const sprite = sprites.label(overlay.text, style, unit, output.width * TEXT_MAX_WIDTH);
      const [x, y] = placeOverlay(output, sprite.box, overlay.position, style.align, avoid);
      spritePass.drawSprite(sprite, x, y, opacity);
    }
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    // A 0×0 source uploads nothing and leaves the old texture: black or a stale frame, no GL error thrown.
    if (!hasPixels(screen)) throw new Error(`render: the screen frame of scene ${layer.index} is empty (not decoded yet, or closed)`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
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

  function drawLayer(layer: SceneFrame, sources: FrameSources, t: number): void {
    const scene = project.scenes[layer.index];
    if (!scene) throw new Error(`render: the project has no scene ${layer.index}`);
    background.draw(t);
    if (scene.type === 'card') drawCard(scene);
    else if (scene.type === 'clip') drawClip(layer, sources);
    else drawStill(layer, scene, sources);
  }

  return {
    render(state, sources) {
      if (disposed) throw new Error('render: the renderer was disposed');
      // A lost context draws nothing and reports no error: fail loudly instead of exporting black frames.
      if (gl.isContextLost()) throw new Error('render: the WebGL context was lost');
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, output.width, output.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
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
      sprites.endFrame();
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
