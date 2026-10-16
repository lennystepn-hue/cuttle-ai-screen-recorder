import type { BackgroundPreset } from '@cuttle/project';

/**
 * Background presets: the body of a fragment shader that follows `FRAGMENT_PRELUDE` and fills the
 * whole output. Uniforms: `u_time` (output seconds, for a slow drift), `u_color` (solid) and
 * `u_image` / `u_imageSize` (image, covered and centred).
 */
export const BACKGROUNDS: Record<BackgroundPreset, string> = {
  'sunset-sky': `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float y = v_uv.y;
  vec3 top = vec3(0.106, 0.110, 0.290);
  vec3 middle = vec3(0.722, 0.337, 0.475);
  vec3 low = vec3(0.976, 0.659, 0.400);
  vec3 color = mix(top, middle, smoothstep(0.0, 0.65, y));
  color = mix(color, low, smoothstep(0.55, 1.0, y));
  vec2 sun = vec2(0.5 + 0.08 * sin(u_time * 0.05), 1.05);
  vec2 d = (v_uv - sun) * vec2(aspect, 1.0);
  color += vec3(1.0, 0.80, 0.58) * exp(-dot(d, d) * 5.0) * 0.5;
  float clouds = sin(y * 10.0 + sin(v_uv.x * aspect * 2.2 + u_time * 0.03) * 0.9);
  color += vec3(0.045, 0.020, 0.030) * clouds * smoothstep(0.25, 0.85, y);
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  aurora: `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float x = v_uv.x * aspect;
  float y = v_uv.y;
  vec3 color = mix(vec3(0.020, 0.031, 0.086), vec3(0.039, 0.067, 0.149), y);
  float t = u_time * 0.04;
  vec3 tints[3] = vec3[3](vec3(0.20, 0.95, 0.65), vec3(0.25, 0.60, 1.00), vec3(0.72, 0.36, 0.95));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float center = 0.32 + 0.13 * fi + 0.07 * sin(x * (1.3 + 0.45 * fi) + t * (1.0 + fi) + fi * 2.1);
    float k = (y - center) / (0.06 + 0.03 * fi);
    color += tints[i] * exp(-k * k) * 0.42;
  }
  o_color = vec4(dither(clamp(color, 0.0, 1.0)), 1.0);
}`,
  mesh: `
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float t = u_time * 0.05;
  vec2 points[4] = vec2[4](
    vec2(0.18 * aspect + 0.04 * sin(t), 0.22),
    vec2(0.82 * aspect, 0.18 + 0.05 * cos(t * 1.3)),
    vec2(0.25 * aspect, 0.85 + 0.04 * cos(t * 0.7)),
    vec2(0.78 * aspect + 0.05 * cos(t * 0.9), 0.80));
  vec3 colors[4] = vec3[4](
    vec3(0.486, 0.361, 1.000),
    vec3(1.000, 0.478, 0.714),
    vec3(0.298, 0.788, 0.941),
    vec3(1.000, 0.722, 0.420));
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = p - points[i];
    float w = 1.0 / (0.02 + pow(dot(d, d), 1.5));
    sum += colors[i] * w;
    total += w;
  }
  o_color = vec4(dither(sum / total), 1.0);
}`,
  solid: `
uniform vec3 u_color;
void main() {
  o_color = vec4(u_color, 1.0);
}`,
  image: `
uniform sampler2D u_image;
uniform vec2 u_imageSize;
void main() {
  float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
  vec2 shown = u_resolution / scale;
  vec2 origin = (u_imageSize - shown) * 0.5;
  o_color = vec4(texture(u_image, (origin + v_uv * shown) / u_imageSize).rgb, 1.0);
}`,
};
