import type { Mask, Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../gl/rect';
import { Shader } from '../gl/shader';
import { maskRectToOutput, uvRect, type Size, type WindowLayout } from '../layout';

const FILL = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_mask;    // the mask rect in texture coordinates
uniform vec2 u_texel;   // one source pixel in texture coordinates
uniform vec4 u_window;
uniform float u_radius;

float median8(float v[8]) {
  for (int i = 0; i < 7; i++) {
    for (int j = 0; j < 7 - i; j++) {
      if (v[j] > v[j + 1]) {
        float t = v[j];
        v[j] = v[j + 1];
        v[j + 1] = t;
      }
    }
  }
  return 0.5 * (v[3] + v[4]);
}

void main() {
  // The colour around the mask: eight points 3 px outside its edges, median per channel,
  // so a few pixels of text touching the edge do not tint the fill.
  vec2 lo = u_mask.xy - 3.0 * u_texel;
  vec2 hi = u_mask.xy + u_mask.zw + 3.0 * u_texel;
  vec2 mid = 0.5 * (lo + hi);
  vec2 points[8] = vec2[8](lo, vec2(mid.x, lo.y), vec2(hi.x, lo.y), vec2(lo.x, mid.y),
                           vec2(hi.x, mid.y), vec2(lo.x, hi.y), vec2(mid.x, hi.y), hi);
  float r[8];
  float g[8];
  float b[8];
  for (int i = 0; i < 8; i++) {
    vec3 c = textureLod(u_tex, clamp(points[i], 0.5 * u_texel, 1.0 - 0.5 * u_texel), 0.0).rgb;
    r[i] = c.r;
    g[i] = c.g;
    b[i] = c.b;
  }
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(vec3(median8(r), median8(g), median8(b)) * a, a);
}`;

const BLUR = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_crop;     // the zoom crop in texture coordinates
uniform vec4 u_content;  // the content rect in output px
uniform vec2 u_texel;
uniform float u_lod;
uniform vec4 u_window;
uniform float u_radius;
void main() {
  vec2 uv = u_crop.xy + (v_px - u_content.xy) / u_content.zw * u_crop.zw;
  vec2 stride = u_texel * exp2(u_lod);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      float w = exp(-float(i * i + j * j) / 4.0);
      // One mip level coarser than the tap spacing, so neighbouring taps overlap into a smooth smear.
      sum += textureLod(u_tex, uv + vec2(float(i), float(j)) * stride, u_lod + 1.0).rgb * w;
      total += w;
    }
  }
  float a = coverage(sdRoundRect(v_px, u_window, u_radius));
  o_color = vec4(sum / total * a, a);
}`;

/**
 * Blur strength: one mip level per doubling. Taps are about 1/90 of the screen height apart, at
 * least 4 px, and at least a quarter of the mask's short side: no text under a mask is taller than
 * the mask, so the five taps across it always smear a whole glyph.
 */
export function blurLod(screen: Size, mask: Rect): number {
  return Math.max(2, Math.log2(screen.height / 90), Math.log2(Math.min(mask[2], mask[3]) / 4));
}

/** Masks over the screen: `fill` with the surrounding colour, `blur` with a heavy blur. Clipped to the content. */
export class MaskPass {
  private readonly fill: Shader;
  private readonly blur: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.fill = new Shader(gl, 'mask fill', RECT_VERTEX, FILL);
    this.blur = new Shader(gl, 'mask blur', RECT_VERTEX, BLUR);
  }

  /** `screen` must be the uploaded screen texture, with mipmaps. */
  draw(masks: readonly Mask[], screen: WebGLTexture, screenSize: Size, zoom: Rect, layout: WindowLayout): void {
    if (masks.length === 0) return;
    const texel: [number, number] = [1 / screenSize.width, 1 / screenSize.height];
    withScissor(this.gl, this.output, layout.content, () => {
      for (const mask of masks) {
        const rect = maskRectToOutput(mask.rect, zoom, layout.content);
        const shader = mask.style === 'fill' ? this.fill : this.blur;
        shader
          .use()
          .texture('u_tex', 0, screen)
          .vec2('u_texel', texel[0], texel[1])
          .vec4('u_window', layout.window)
          .float('u_radius', layout.radius);
        if (mask.style === 'fill') {
          shader.vec4('u_mask', uvRect(mask.rect, screenSize));
        } else {
          shader.vec4('u_crop', uvRect(zoom, screenSize)).vec4('u_content', layout.content).float('u_lod', blurLod(screenSize, mask.rect));
        }
        drawRect(this.gl, shader, rect, this.output);
      }
    });
  }

  dispose(): void {
    this.fill.dispose();
    this.blur.dispose();
  }
}
