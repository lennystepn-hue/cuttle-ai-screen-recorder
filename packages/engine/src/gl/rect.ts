import type { Rect } from '@cuttle/project';
import type { Size } from '../layout';
import type { Shader } from './shader';

/**
 * Every pass draws one rect given in output px (origin top-left, y down). The fragment shader
 * gets `v_px`, the output pixel centre, and `v_uv`, 0..1 across the rect from its top-left corner.
 */
export const RECT_VERTEX = `#version 300 es
uniform vec2 u_resolution;
uniform vec4 u_rect;
out vec2 v_px;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_uv = corner;
  v_px = u_rect.xy + corner * u_rect.zw;
  vec2 clip = v_px / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

/** Shared start of every fragment shader: inputs, a rounded-rect SDF, antialiased coverage and dithering. */
export const FRAGMENT_PRELUDE = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
in vec2 v_px;
in vec2 v_uv;
out vec4 o_color;

// Signed distance in px from p to a rounded rect (x, y, w, h); negative inside.
float sdRoundRect(vec2 p, vec4 rect, float radius) {
  vec2 halfSize = rect.zw * 0.5;
  vec2 q = abs(p - rect.xy - halfSize) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// 1 inside, 0 outside, a one-pixel ramp across the edge.
float coverage(float d) {
  return clamp(0.5 - d, 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Breaks up 8-bit banding in gradients; deterministic per pixel.
vec3 dither(vec3 color) {
  return color + (hash12(floor(v_px)) - 0.5) / 255.0;
}
`;

/** Draws `rect` (output px) with `shader`, which must already be in use with its other uniforms set. */
export function drawRect(gl: WebGL2RenderingContext, shader: Shader, rect: Rect, output: Size): void {
  shader.vec2('u_resolution', output.width, output.height).vec4('u_rect', rect);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Runs `draw` with drawing limited to `rect` (output px). */
export function withScissor(gl: WebGL2RenderingContext, output: Size, rect: Rect, draw: () => void): void {
  const x = Math.floor(rect[0]);
  const y = Math.floor(rect[1]);
  const right = Math.ceil(rect[0] + rect[2]);
  const bottom = Math.ceil(rect[1] + rect[3]);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, output.height - bottom, right - x, bottom - y);
  try {
    draw();
  } finally {
    gl.disable(gl.SCISSOR_TEST);
  }
}
