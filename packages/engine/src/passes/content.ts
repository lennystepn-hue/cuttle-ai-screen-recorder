import type { Rect } from '@cuttle/project';
import type { Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import type { Size, WindowLayout } from '../layout';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_crop;
uniform vec4 u_window;
uniform float u_radius;
uniform vec3 u_matte;
void main() {
  // A small negative LOD bias keeps downscaled UI text crisp while trilinear filtering stops shimmer.
  vec4 texel = texture(u_tex, u_crop.xy + v_uv * u_crop.zw, -0.5);
  // Premultiplied: transparent parts of the image show the matte instead of black.
  vec3 color = texel.rgb + (1.0 - texel.a) * u_matte;
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(color * a, a);
}`;

/** The screen (cropped to the zoom) or a still image, drawn into the content rect and clipped to the window's rounded corners. */
export class ContentPass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'content', RECT_VERTEX, FRAGMENT);
  }

  /**
   * `crop` is in texture coordinates (see `uvRect`); the texture needs mipmaps. `matte` shows through
   * transparent parts of the image (screen frames are opaque; stills use white).
   */
  draw(texture: WebGLTexture, crop: Rect, layout: WindowLayout, matte: Rgb = [0, 0, 0]): void {
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_crop', crop)
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .vec3('u_matte', matte);
    drawRect(this.gl, this.shader, layout.content, this.output);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
