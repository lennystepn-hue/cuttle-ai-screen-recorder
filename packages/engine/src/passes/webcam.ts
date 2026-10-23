import type { Look, Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { cameraPlace, unitFor, type CameraPlace, type Size } from '../layout';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform vec4 u_box;
uniform float u_radius;
uniform vec4 u_crop;
uniform float u_border;
uniform float u_shadow;
uniform float u_squircle;
uniform float u_mirror;
uniform float u_opacity;
// A superellipse (|x|^5 + |y|^5 = 1) over the box: the squircle, as the app's icon has it. Its value
// is scaled to px at the edge's middles (a little softer towards the corners, which coverage hides).
float sdSquircle(vec2 p, vec4 box) {
  vec2 half_ = box.zw * 0.5;
  vec2 q = abs(p - box.xy - half_) / half_;
  return (pow(pow(q.x, 5.0) + pow(q.y, 5.0), 0.2) - 1.0) * min(half_.x, half_.y);
}
float shape(vec2 p) {
  return u_squircle > 0.5 ? sdSquircle(p, u_box) : sdRoundRect(p, u_box, u_radius);
}
void main() {
  float d = shape(v_px);
  vec2 inBox = (v_px - u_box.xy) / u_box.zw;
  if (u_mirror > 0.5) inBox.x = 1.0 - inBox.x;
  vec3 camera = texture(u_tex, u_crop.xy + inBox * u_crop.zw).rgb;
  float outer = coverage(d);
  vec3 color = mix(vec3(1.0), camera, coverage(d + u_border));
  vec4 body = vec4(color * outer, outer);
  float shadow = u_shadow > 0.0 ? 0.4 * (1.0 - smoothstep(-u_shadow * 0.5, u_shadow, shape(v_px - vec2(0.0, u_shadow * 0.35)))) : 0.0;
  o_color = (body + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - body.a)) * u_opacity;
}`;

/** Border width and shadow size of the bubble, in units (its `rounded` corners: `ROUNDED_RADIUS` in the layout). */
export const WEBCAM_BUBBLE = { border: 4, shadow: 24 } as const;

/** The centred part of a camera frame with the `aspect` (width / height) of the box it fills (a square for the bubble), in texture coordinates. */
export function webcamCrop(camera: Size, aspect = 1): Rect {
  const own = camera.width / camera.height;
  if (own >= aspect) {
    const w = aspect / own;
    return [(1 - w) / 2, 0, w, 1];
  }
  const h = own / aspect;
  return [0, (1 - h) / 2, 1, h];
}

/** The webcam bubble in an output corner: centre-cropped, white border, soft shadow. Not affected by zoom. */
export class WebcamPass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'webcam', RECT_VERTEX, FRAGMENT);
  }

  /** The bubble as the look has it, or where a camera layout puts the camera (`cameraPlace`). */
  draw(texture: WebGLTexture, camera: Size, look: Look['webcam'], place: CameraPlace = cameraPlace(this.output, { ...look, enabled: true })): void {
    const u = unitFor(this.output);
    const { box, radius } = place;
    const shadow = look.shadow ? WEBCAM_BUBBLE.shadow * u * place.shadow : 0;
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .vec4('u_box', box)
      .float('u_radius', radius)
      .float('u_squircle', place.squircle ? 1 : 0)
      .float('u_mirror', look.mirror ? 1 : 0)
      .vec4('u_crop', webcamCrop(camera, box[2] / Math.max(1, box[3])))
      .float('u_border', look.border ? WEBCAM_BUBBLE.border * u * place.border : 0)
      .float('u_shadow', shadow)
      .float('u_opacity', place.opacity);
    const pad = Math.max(shadow * 1.5, 2);
    drawRect(this.gl, this.shader, [box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad], this.output);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
