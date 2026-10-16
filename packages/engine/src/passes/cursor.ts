import type { Look, Rect } from '@cuttle/project';
import type { CursorFrame } from '@cuttle/timeline';
import { hexToRgb, type Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
import { cursorSizePx, sourceToOutput, type Size, type WindowLayout } from '../layout';
import type { EngineAssets } from '../assets';
import { CURSOR_ART, CURSOR_GRID, cursorImageFor, type CursorImage } from '../presets/cursors';

const SPOTLIGHT = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_lightRadius;
uniform float u_soft;
uniform vec3 u_color;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  float light = 1.0 - smoothstep(u_lightRadius - u_soft, u_lightRadius + u_soft, length(v_px - u_center));
  float clip = coverage(sdRoundRect(v_px, u_window, u_radius));
  // Premultiplied: darkens outside the light, adds a faint tint inside it.
  o_color = vec4(u_color * 0.12 * light, 0.45 * (1.0 - light)) * clip;
}`;

const RIPPLE = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_ringRadius;
uniform float u_width;
uniform vec3 u_color;
uniform float u_alpha;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  float a = coverage(abs(length(v_px - u_center) - u_ringRadius) - u_width * 0.5) * u_alpha;
  o_color = vec4(u_color * a, a) * coverage(sdRoundRect(v_px, u_window, u_radius));
}`;

const SHAPE = `${FRAGMENT_PRELUDE}
uniform vec2 u_center;
uniform float u_shapeRadius;
uniform vec3 u_color;
uniform int u_kind;   // 0 dot, 1 ring
uniform vec4 u_window;
uniform float u_radius;
void main() {
  float d = length(v_px - u_center);
  float r = u_shapeRadius;
  if (u_kind == 0) {
    float shadow = 0.35 * (1.0 - smoothstep(r * 0.6, r * 1.6, length(v_px - u_center - vec2(0.0, r * 0.2))));
    float outer = coverage(d - r);
    vec3 color = mix(vec3(1.0), u_color, coverage(d - r * 0.75));
    vec4 body = vec4(color * outer, outer);
    o_color = body + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - body.a);
  } else {
    float ring = coverage(abs(d - r) - r * 0.11);
    float fill = coverage(d - r) * 0.18;
    vec4 stroke = vec4(u_color * ring, ring);
    o_color = stroke + vec4(u_color * fill, fill) * (1.0 - stroke.a);
  }
  o_color *= coverage(sdRoundRect(v_px, u_window, u_radius));
}`;

const IMAGE = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  o_color = texture(u_tex, v_uv) * coverage(sdRoundRect(v_px, u_window, u_radius));
}`;

/** Ripple growth and fade over its 0..1 progress, in cursor heights. */
export function rippleAt(progress: number): { radius: number; alpha: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { radius: 0.25 + 0.85 * (1 - (1 - p) ** 3), alpha: 0.9 * (1 - p) ** 2 };
}

/**
 * The pointer, its click ripples and the spotlight, clipped to the content and the window's rounded
 * corners. Hidden while off the captured area.
 */
export class CursorPass {
  private readonly spotlight: Shader;
  private readonly ripple: Shader;
  private readonly shape: Shader;
  private readonly image: Shader;
  private readonly images = new Map<CursorImage, WebGLTexture>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    assets: EngineAssets,
  ) {
    this.spotlight = new Shader(gl, 'cursor spotlight', RECT_VERTEX, SPOTLIGHT);
    this.ripple = new Shader(gl, 'cursor ripple', RECT_VERTEX, RIPPLE);
    this.shape = new Shader(gl, 'cursor shape', RECT_VERTEX, SHAPE);
    this.image = new Shader(gl, 'cursor image', RECT_VERTEX, IMAGE);
    for (const [image, bitmap] of assets.cursors) {
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, bitmap, true);
      this.images.set(image, texture);
    }
  }

  draw(cursor: CursorFrame, look: Look['cursor'], screen: Size, zoom: Rect, layout: WindowLayout): void {
    const onScreen = (x: number, y: number) => x >= 0 && y >= 0 && x < screen.width && y < screen.height;
    const size = cursorSizePx(screen, look.size, zoom, layout.content);
    const color = hexToRgb(look.color);
    const [x, y] = sourceToOutput(cursor.x, cursor.y, zoom, layout.content);
    withScissor(this.gl, this.output, layout.content, () => {
      if (look.style === 'spotlight' && onScreen(cursor.x, cursor.y)) this.drawSpotlight(x, y, size, color, layout);
      for (const click of cursor.clicks) {
        if (!onScreen(click.x, click.y)) continue;
        const [cx, cy] = sourceToOutput(click.x, click.y, zoom, layout.content);
        this.drawRipple(cx, cy, size, click.progress, color, layout);
      }
      if (onScreen(cursor.x, cursor.y)) this.drawPointer(x, y, size, look.style, cursor, color, layout);
    });
  }

  private drawSpotlight(x: number, y: number, size: number, color: Rgb, layout: WindowLayout): void {
    this.spotlight
      .use()
      .vec2('u_center', x, y)
      .float('u_lightRadius', 3.2 * size)
      .float('u_soft', size)
      .vec3('u_color', color)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.spotlight, layout.content, this.output);
  }

  private drawRipple(x: number, y: number, size: number, progress: number, color: Rgb, layout: WindowLayout): void {
    const { radius, alpha } = rippleAt(progress);
    const ringRadius = radius * size;
    const width = Math.max(1.5, 0.1 * size);
    const extent = ringRadius + width + 1;
    this.ripple
      .use()
      .vec2('u_center', x, y)
      .float('u_ringRadius', ringRadius)
      .float('u_width', width)
      .vec3('u_color', color)
      .float('u_alpha', alpha)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.ripple, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }

  private drawPointer(
    x: number,
    y: number,
    size: number,
    style: Look['cursor']['style'],
    cursor: CursorFrame,
    color: Rgb,
    layout: WindowLayout,
  ): void {
    const image = cursorImageFor(style, cursor.shape);
    if (image) {
      const [hx, hy] = CURSOR_ART[image].hotspot;
      const texture = this.images.get(image);
      if (!texture) throw new Error(`cursor image ${image} was not loaded`);
      this.image.use().texture('u_tex', 0, texture).vec4('u_window', layout.window).float('u_radius', layout.radius);
      drawRect(this.gl, this.image, [x - (hx / CURSOR_GRID) * size, y - (hy / CURSOR_GRID) * size, size, size], this.output);
      return;
    }
    const kind = style === 'ring' ? 1 : 0;
    const radius = (style === 'ring' ? 0.45 : style === 'dot' ? 0.28 : 0.14) * size;
    const extent = radius * 1.8 + 1;
    this.shape
      .use()
      .vec2('u_center', x, y)
      .float('u_shapeRadius', radius)
      .vec3('u_color', color)
      .int('u_kind', kind)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius);
    drawRect(this.gl, this.shape, [x - extent, y - extent, 2 * extent, 2 * extent], this.output);
  }

  dispose(): void {
    this.spotlight.dispose();
    this.ripple.dispose();
    this.shape.dispose();
    this.image.dispose();
    for (const texture of this.images.values()) this.gl.deleteTexture(texture);
  }
}
