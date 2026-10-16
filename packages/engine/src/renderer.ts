import type { CardScene, CuttleProject, FrameStyle, Rect } from '@cuttle/project';
import type { RenderState, SceneFrame } from '@cuttle/timeline';
import type { EngineAssets } from './assets';
import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl/target';
import { createTexture, uploadTexture } from './gl/texture';
import { unitFor, uvRect, windowLayout, type Size, type WindowLayout } from './layout';
import { BackgroundPass } from './passes/background';
import { ContentPass } from './passes/content';
import { CursorPass } from './passes/cursor';
import { MaskPass } from './passes/masks';
import { SpritePass } from './passes/sprite';
import { WindowPass } from './passes/window';
import { FRAME_CHROME, type FrameChrome } from './presets/frames';
import { CARD_SUBTITLE_STYLE, CARD_TITLE_STYLE } from './presets/labels';
import { SpriteCache } from './sprites';

/**
 * Per-frame images, keyed by `SceneFrame.index`: during a crossfade two clip layers with
 * unrelated source times are visible at once.
 */
export interface FrameSources {
  /** Scene index → decoded screen frame at that layer's `sourceTime`. */
  screens: Map<number, TexImageSource>;
  /** Scene index → webcam frame at that layer's `sourceTime`. */
  webcams: Map<number, TexImageSource>;
  /** Scene index → image of a still scene; created with `premultiplyAlpha: 'premultiply'`, not flipped. */
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

/** Share of the output width that card titles may use. */
const CARD_MAX_WIDTH = 0.84;
/** Gap between a card's title and subtitle boxes, in units. */
const CARD_GAP = 12;

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
  const cursor = own(new CursorPass(gl, output, options.assets, spritePass));
  let layerTarget: RenderTarget | undefined;
  let disposed = false;

  function frame(style: FrameStyle | null): { chrome: FrameChrome | null; layout: WindowLayout } {
    const chrome = style ? FRAME_CHROME[style] : null;
    return { chrome, layout: windowLayout(output, screenAspect, chrome ? { titleBar: chrome.titleBar, radius: look.frame.radius } : null) };
  }

  function drawClip(layer: SceneFrame, sources: FrameSources): void {
    const { chrome, layout } = frame(look.frame.enabled ? look.frame.style : null);
    if (chrome) windowPass.draw(layout, chrome, look.frame.shadow, look.frame.title);
    const screen = sources.screens.get(layer.index);
    if (!screen) throw new Error(`render: no screen frame for scene ${layer.index}`);
    uploadTexture(gl, screenTexture, screen, true);
    const zoom = layer.zoom ?? full;
    content.draw(screenTexture, uvRect(zoom, screenSize), layout);
    masks.draw(layer.masks, screenTexture, screenSize, zoom, layout);
    if (layer.cursor) cursor.draw(layer.cursor, look.cursor, screenSize, zoom, layout);
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
    else throw new Error(`render: ${scene.type} scenes are not supported yet`);
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
    },
  };
}
