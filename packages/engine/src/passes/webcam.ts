import type { Look, Rect, WebcamBackground } from '@cuttle/project';
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
uniform sampler2D u_mask;
// what shows behind the person: 0 the room, 1 blurred, 2 a colour, 3 nothing (the person alone)
uniform float u_behind;
uniform vec3 u_fill;
uniform float u_blurLevel;
uniform vec2 u_blurReach;
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
  vec2 uv = u_crop.xy + inBox * u_crop.zw;
  vec3 camera = texture(u_tex, uv).rgb;
  if (u_behind > 0.5) {
    // the model's mask, a little soft at its edge (hair, fingers)
    float person = smoothstep(0.3, 0.7, texture(u_mask, uv).r);
    if (u_behind > 2.5) {
      // the person alone, inside the box: no shape, ring or shadow
      float alpha = person * coverage(sdRoundRect(v_px, u_box, 0.0)) * u_opacity;
      o_color = vec4(camera * alpha, alpha);
      return;
    }
    vec3 behind = u_fill;
    if (u_behind < 1.5) {
      // the room blurred: a coarse level of the camera's mipmaps, eight taps around the point
      behind = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982;
        behind += textureLod(u_tex, uv + vec2(cos(a), sin(a)) * u_blurReach, u_blurLevel).rgb;
      }
      behind /= 8.0;
    }
    camera = mix(behind, camera, person);
  }
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

/** What shows behind the person (`look.webcam.background` other than `keep`): where the person is, and the colour for `color`. */
export interface WebcamBehind {
  mode: Exclude<WebcamBackground, 'keep'>;
  mask: WebGLTexture;
  color: readonly [number, number, number];
}

const BEHIND_MODES: Record<WebcamBehind['mode'], number> = { blur: 1, color: 2, remove: 3 };

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
  draw(texture: WebGLTexture, camera: Size, look: Look['webcam'], place: CameraPlace = cameraPlace(this.output, { ...look, enabled: true }), behind?: WebcamBehind): void {
    const u = unitFor(this.output);
    const { box, radius } = place;
    const alone = behind?.mode === 'remove';
    const shadow = look.shadow && !alone ? WEBCAM_BUBBLE.shadow * u * place.shadow : 0;
    const crop = webcamCrop(camera, box[2] / Math.max(1, box[3]));
    // the blur: a coarse mip level, its taps a twentieth of what the box shows away, the same in px both ways
    const reach = 0.05 * Math.min(crop[2] * camera.width, crop[3] * camera.height);
    const blurLevel = Math.max(0, Math.log2(reach / 2));
    this.shader
      .use()
      .texture('u_tex', 0, texture)
      .texture('u_mask', 1, behind?.mask ?? texture)
      .float('u_behind', behind ? BEHIND_MODES[behind.mode] : 0)
      .vec3('u_fill', behind?.color ?? [0, 0, 0])
      .float('u_blurLevel', blurLevel)
      .vec2('u_blurReach', reach / Math.max(1, camera.width), reach / Math.max(1, camera.height))
      .vec4('u_box', box)
      .float('u_radius', radius)
      .float('u_squircle', place.squircle ? 1 : 0)
      .float('u_mirror', look.mirror ? 1 : 0)
      .vec4('u_crop', crop)
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
