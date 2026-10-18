import type { BackgroundPreset } from '@cuttle/project';

/**
 * The palette of a coloured background: `u_colors` (`u_count` of them, 2 to 4, sRGB) and `u_base`
 * (a dark tone of them). `paletteColor(i)` is the i-th, wrapping around; `palette(t)` runs through
 * them from 0 to 1, mixed in Oklab (no muddy middle between two hues, as CSS's `in oklab`).
 */
const PALETTE = `
uniform vec3 u_colors[4];
uniform int u_count;
uniform vec3 u_base;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toOklab(vec3 c) {
  c = srgbToLinear(c);
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(lms, vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
vec3 fromOklab(vec3 c) {
  vec3 lms = vec3(
    c.x + 0.3963377774 * c.y + 0.2158037573 * c.z,
    c.x - 0.1055613458 * c.y - 0.0638541728 * c.z,
    c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  lms = lms * lms * lms;
  vec3 rgb = vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
  return linearToSrgb(clamp(rgb, 0.0, 1.0));
}
vec3 paletteColor(int i) {
  return u_colors[i % u_count];
}
vec3 palette(float t) {
  float at = clamp(t, 0.0, 1.0) * float(u_count - 1);
  int i = min(int(floor(at)), u_count - 2);
  return fromOklab(mix(toOklab(u_colors[i]), toOklab(u_colors[i + 1]), at - float(i)));
}
`;

/** Smooth value noise and three octaves of it, for the flow: large, soft shapes. */
const NOISE = `
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    // each octave turned against the last: no grid shows through
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(17.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}
`;

/** Darker towards the corners, a little: the eye stays on the window. */
const VIGNETTE = `
vec3 vignette(vec3 color, float amount) {
  vec2 d = v_uv - 0.5;
  return color * (1.0 - amount * dot(d, d) * 2.0);
}
`;

/**
 * Background presets: the body of a fragment shader that follows `FRAGMENT_PRELUDE` and fills the
 * whole output. Uniforms: `u_time` (output seconds, for a slow drift), `u_color` (solid),
 * `u_image` / `u_imageSize` / `u_blur` / `u_dim` (image, covered and centred), the palette
 * (`PALETTE`: gradient, mesh, flow, bokeh, dots) and `u_angle` / `u_radial` (gradient).
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
  mesh: `${PALETTE}
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
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = p - points[i];
    float w = 1.0 / (0.02 + pow(dot(d, d), 1.5));
    sum += paletteColor(i) * w;
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
uniform float u_blur;
uniform float u_dim;
void main() {
  float scale = max(u_resolution.x / u_imageSize.x, u_resolution.y / u_imageSize.y);
  vec2 shown = u_resolution / scale;
  vec2 origin = (u_imageSize - shown) * 0.5;
  vec2 uv = (origin + v_uv * shown) / u_imageSize;
  vec3 color;
  if (u_blur <= 0.0) {
    color = texture(u_image, uv).rgb;
  } else {
    // a disc of taps, on a level of the mipmap as coarse as the disc is wide: up to 16 % of the
    // output's short side at 1, in the image's own pixels
    float radius = u_blur * 0.16 * min(u_resolution.x, u_resolution.y) / scale;
    float lod = log2(max(radius / 4.0, 1.0));
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float r = radius * sqrt((fi + 0.5) / 24.0);
      float a = fi * 2.39996323;
      sum += textureLod(u_image, uv + vec2(cos(a), sin(a)) * r / u_imageSize, lod).rgb;
    }
    color = sum / 24.0;
  }
  // a sharp image as it is; a softened or darkened one dithered against banding
  o_color = vec4(u_blur > 0.0 || u_dim > 0.0 ? dither(color * (1.0 - u_dim)) : color, 1.0);
}`,
  gradient: `${PALETTE}
uniform float u_angle;
uniform float u_radial;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t;
  if (u_radial > 0.5) {
    // from the centre to the farthest corner
    t = length(p) / (0.5 * length(vec2(aspect, 1.0)));
  } else {
    // as CSS lays it out: 0 degrees to the top, 90 to the right, the corners on 0 and 1
    float a = radians(u_angle);
    vec2 direction = vec2(sin(a), -cos(a));
    float extent = 0.5 * (abs(aspect * direction.x) + abs(direction.y));
    t = dot(p, direction) / (2.0 * extent) + 0.5;
  }
  o_color = vec4(dither(palette(t)), 1.0);
}`,
  flow: `${PALETTE}${NOISE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = mat2(0.8, -0.6, 0.6, 0.8) * vec2(v_uv.x * aspect, v_uv.y) * 1.1;
  float t = u_time * 0.05;
  // noise warped by noise, large and slow: soft folds of the palette drifting past
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.8, 0.0)));
  float f = fbm(p + 1.6 * q + vec2(t * 0.3, -t * 0.2));
  vec3 color = palette(smoothstep(0.16, 0.84, f));
  color = mix(u_base, color, 0.9);
  o_color = vec4(dither(clamp(vignette(color, 0.6), 0.0, 1.0)), 1.0);
}`,
  bokeh: `${PALETTE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  vec3 color = mix(u_base * 1.6, u_base * 0.7, v_uv.y);
  // soft out-of-focus lights in the palette's colours, drifting up and sideways, slowly
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float x = hash12(vec2(fi, 1.7));
    float y = hash12(vec2(fi, 9.1));
    float size = 0.05 + 0.12 * hash12(vec2(fi, 4.3));
    float speed = 0.006 + 0.01 * hash12(vec2(fi, 7.7));
    vec2 center = vec2(
      (x + 0.04 * sin(u_time * 0.07 + fi * 1.3)) * aspect,
      fract(y - u_time * speed) * 1.4 - 0.2);
    float d = length(p - center);
    float disc = smoothstep(size, size * 0.86, d);
    float rim = smoothstep(size * 0.7, size * 0.95, d) * disc;
    vec3 tint = paletteColor(i);
    color += tint * (disc * (0.07 + 0.08 * hash12(vec2(fi, 2.9))) + rim * 0.05);
  }
  o_color = vec4(dither(clamp(vignette(color, 0.5), 0.0, 1.0)), 1.0);
}`,
  dots: `${PALETTE}${VIGNETTE}
uniform float u_time;
void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float unit = u_resolution.y / 1080.0;
  // two slow glows in the palette's colours
  vec2 a = vec2(aspect * (0.5 + 0.32 * sin(u_time * 0.06)), 0.42 + 0.22 * cos(u_time * 0.045));
  vec2 b = vec2(aspect * (0.5 + 0.36 * cos(u_time * 0.05 + 2.0)), 0.6 + 0.2 * sin(u_time * 0.038 + 1.0));
  vec3 glow = paletteColor(0) * exp(-dot(p - a, p - a) * 4.0) + paletteColor(1) * exp(-dot(p - b, p - b) * 5.0);
  vec3 color = u_base + glow * 0.32;
  // a fine grid of dots, brighter in the glow
  float spacing = 36.0 * unit;
  vec2 cell = (fract(v_px / spacing) - 0.5) * spacing;
  float spot = 1.0 - smoothstep(1.2 * unit, 2.4 * unit, length(cell));
  color += spot * (vec3(0.06) + glow * 0.55);
  o_color = vec4(dither(clamp(vignette(color, 0.7), 0.0, 1.0)), 1.0);
}`,
};
