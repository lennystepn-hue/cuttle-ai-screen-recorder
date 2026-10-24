import type { Rect } from '@cuttle/project';
import type { Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { BLUR_SAMPLES, type Size, type WindowLayout } from '../layout';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_crop;
uniform vec4 u_from;    // the crop when the shutter opened (motion blur)
uniform int u_samples;  // the moments averaged from u_from to u_crop; 1: none
uniform vec4 u_window;
uniform float u_radius;
uniform vec3 u_matte;
uniform bool u_keepAlpha;
void main() {
  // A small negative LOD bias keeps downscaled UI text crisp while trilinear filtering stops shimmer.
  vec4 texel;
  if (u_samples <= 1) {
    texel = texture(u_tex, u_crop.xy + v_uv * u_crop.zw, -0.5);
  } else {
    // motion blur: the screen as each moment the shutter was open showed it, averaged
    texel = vec4(0.0);
    for (int i = 0; i < ${BLUR_SAMPLES}; i++) {
      if (i >= u_samples) break;
      vec4 crop = mix(u_from, u_crop, float(i) / float(u_samples - 1));
      texel += texture(u_tex, crop.xy + v_uv * crop.zw, -0.5);
    }
    texel /= float(u_samples);
  }
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  // Premultiplied: transparent parts of the image show the matte instead of black, or stay transparent.
  if (u_keepAlpha) {
    o_color = texel * a;
  } else {
    o_color = vec4((texel.rgb + (1.0 - texel.a) * u_matte) * a, a);
  }
}`;

/** The screen (cropped to the zoom) or a still image, drawn into the content rect and clipped to the window's rounded corners (a device's screen). */
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
   * transparent parts of the image (screen frames are opaque; stills use white); null keeps them
   * transparent (a shot). `blur`: the crop when the shutter opened and how many moments from there
   * to `crop` to average (`blurSamples`).
   */
  draw(texture: WebGLTexture, crop: Rect, layout: WindowLayout, matte: Rgb | null = [0, 0, 0], blur?: { from: Rect; samples: number }): void {
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_crop', crop)
      .vec4('u_from', blur?.from ?? crop)
      .int('u_samples', blur?.samples ?? 1)
      .vec4('u_window', layout.clip)
      .float('u_radius', layout.clipRadius)
      .vec3('u_matte', matte ?? [0, 0, 0])
      .int('u_keepAlpha', matte ? 0 : 1);
    drawRect(this.gl, this.shader, layout.content, this.output);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
