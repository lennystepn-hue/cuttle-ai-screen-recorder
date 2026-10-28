// Shaders in a motion page, on the video's clock: import { shader, GLSL } from 'cuttle/shader';
//
//   shader(`vec4 effect(vec2 uv) { return vec4(mix(bg, accent, fbm(uv * 3.0 + time * 0.1)), 1.0); }`);
//
// A canvas fills the page and runs `effect` for every pixel of every frame. `uv` runs from 0,0 at
// the top left to 1,1 at the bottom right. These are there, beside the library below:
//   time        seconds into the item          progress   0 to 1 through it
//   resolution  the page's size in px          aspect     its width over its height
//   accent, fg, bg                             the theme's colours (vec3, 0 to 1)
//   fromColor(uv), toColor(uv)                 a transition's two frames (transparent elsewhere)
// and the uniforms you give (`uniforms: { strength: 0.5, tint: '#d97757', at: [0.3, 0.6] }`: a number
// is a float, a list of 2 to 4 numbers a vec2 to vec4, a colour a vec3, true and false 1.0 and 0.0),
// which `set(name, value)` changes for the frames after.

/**
 * The library every effect has, also for shaders of your own (Three.js' ShaderMaterial): hashes and
 * noise, fractal noise, curl, film grain, a vignette, halftone dots, ordered dithering, a colour
 * grade, easing, rotation and brightness.
 */
export const GLSL = `
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  return float((q.x ^ q.y) * 1597334673u) / 4294967295.0;
}
float hash(vec3 p) {
  uvec3 q = uvec3(ivec3(floor(p))) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return float((q.x ^ q.y ^ q.z) * 1597334673u) / 4294967295.0;
}
/* value noise, 0 to 1 */
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
/* gradient noise, smoother than value noise, 0 to 1 */
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define CUTTLE_G(o) dot(vec2(cos(6.2831853 * hash(i + o)), sin(6.2831853 * hash(i + o))), f - o)
  float n = mix(mix(CUTTLE_G(vec2(0, 0)), CUTTLE_G(vec2(1, 0)), u.x), mix(CUTTLE_G(vec2(0, 1)), CUTTLE_G(vec2(1, 1)), u.x), u.y);
  #undef CUTTLE_G
  return clamp(0.5 + 0.7071 * n, 0.0, 1.0);
}
/* fractal noise: five octaves, 0 to 1 */
float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { sum += amp * gnoise(p); p = p * 2.03 + vec2(17.1, 9.7); amp *= 0.5; }
  return sum / 0.96875;
}
float fbm(vec3 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { sum += amp * noise(p); p = p * 2.03 + vec3(17.1, 9.7, 3.3); amp *= 0.5; }
  return sum / 0.96875;
}
/* a flow without sources or sinks (smoke, liquid): the curl of gradient noise */
vec2 curl(vec2 p) {
  float e = 0.01;
  return vec2(gnoise(p + vec2(0, e)) - gnoise(p - vec2(0, e)), gnoise(p - vec2(e, 0)) - gnoise(p + vec2(e, 0))) / (2.0 * e);
}
/* film grain at this pixel, -0.5 to 0.5, new 24 times a second */
float grain(vec2 uv, float t) { return hash(vec3(uv * resolution, floor(t * 24.0))) - 0.5; }
/* darker towards the corners: 1 in the middle, 1 - amount in the corners */
float vignette(vec2 uv, float amount) { return 1.0 - amount * smoothstep(0.35, 0.95, length((uv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5)); }
/* halftone: how much of this pixel a dot covers on a grid of cells px, for a value of 0 (none) to 1 (all) */
float halftone(vec2 uv, float cells, float value, float angle) {
  vec2 p = uv * resolution;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p / cells;
  float r = sqrt(clamp(value, 0.0, 1.0)) * 0.7071;
  float d = length(fract(p) - 0.5);
  return 1.0 - smoothstep(r - 1.0 / cells, r + 1.0 / cells, d);
}
/* an ordered dither's threshold at this pixel, 0 to 1 (4×4 Bayer) */
float bayer(vec2 uv) {
  ivec2 p = ivec2(mod(floor(uv * resolution), 4.0));
  int i = p.x + p.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
/* a grade: contrast and saturation around 1, lift (+ brightens the shadows), tint mixed in by its amount */
vec3 grade(vec3 c, float contrast, float saturation, float lift) {
  c = (c - 0.5) * contrast + 0.5;
  c = mix(vec3(luma(c)), c, saturation);
  return clamp(c + lift * (1.0 - c), 0.0, 1.0);
}
mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float inOutCubic(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
float inOutQuart(float x) { return x < 0.5 ? 8.0 * x * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 4.0) / 2.0; }
float outExpo(float x) { return x >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * x); }
float inExpo(float x) { return x <= 0.0 ? 0.0 : pow(2.0, 10.0 * x - 10.0); }
`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform float time;
uniform float progress;
uniform vec2 resolution;
uniform float aspect;
uniform vec3 accent;
uniform vec3 fg;
uniform vec3 bg;
uniform sampler2D cuttleFrom;
uniform sampler2D cuttleTo;
out vec4 cuttleColor;
vec4 fromColor(vec2 uv) { return texture(cuttleFrom, clamp(uv, 0.0, 1.0)); }
vec4 toColor(vec2 uv) { return texture(cuttleTo, clamp(uv, 0.0, 1.0)); }
`;

const VERTEX = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/** A CSS colour as 0–1 RGB (a colour a canvas understands; black otherwise). */
function rgb(color) {
  const g = new OffscreenCanvas(1, 1).getContext('2d');
  g.fillStyle = '#000';
  g.fillStyle = String(color);
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return [r / 255, gr / 255, b / 255];
}

/** A uniform's GLSL type and its value as numbers. */
function typed(value) {
  if (typeof value === 'boolean') return ['float', [value ? 1 : 0]];
  if (typeof value === 'number') return ['float', [value]];
  if (typeof value === 'string') return ['vec3', rgb(value)];
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4) return [`vec${value.length}`, value.map(Number)];
  throw new Error(`a shader uniform is a number, a list of 2 to 4 numbers, a colour or true or false (got ${JSON.stringify(value)})`);
}

/**
 * Draws `source` (GLSL with `vec4 effect(vec2 uv)`) over the whole page every frame, on a canvas of
 * its own (or `canvas`). Answers the canvas, its WebGL2 context and `set(name, value)`.
 */
export function shader(source, { uniforms = {}, canvas } = {}) {
  const page = globalThis.cuttle;
  const { width, height } = page.size;
  const target = canvas ?? document.body.appendChild(Object.assign(document.createElement('canvas'), { width, height }));
  if (!canvas) target.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  const gl = target.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error('no WebGL2 for the shader');
  const values = { ...uniforms };
  const types = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typed(value)[0]]));
  const declared = Object.entries(types).map(([name, type]) => `uniform ${type} ${name};`).join('\n');
  const prefix = `${HEAD}${GLSL}\n${declared}\n`;
  const fragment = `${prefix}${source}\nvoid main() { vec2 uv = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution; cuttleColor = effect(uv); }`;
  const compile = (type, text) => {
    const part = gl.createShader(type);
    gl.shaderSource(part, text);
    gl.compileShader(part);
    if (gl.getShaderParameter(part, gl.COMPILE_STATUS)) return part;
    // the effect's own line numbers, not the library's
    const offset = prefix.split('\n').length - 1;
    const log = String(gl.getShaderInfoLog(part)).replace(/ERROR: 0:(\d+)/g, (_, line) => `ERROR: line ${Math.max(1, Number(line) - offset)}`);
    throw new Error(`the shader does not compile: ${log.trim()}`);
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`the shader does not link: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  const at = (name) => gl.getUniformLocation(program, name);

  // a transition's two frames, top row first (uv 0 at the top), transparent where there is none
  const textures = [0, 1].map((unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
    return texture;
  });
  gl.uniform1i(at('cuttleFrom'), 0);
  gl.uniform1i(at('cuttleTo'), 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const theme = page.theme ?? {};
  for (const [name, variable, fallback] of [['accent', '--cuttle-accent', '#d97757'], ['fg', '--cuttle-fg', '#ffffff'], ['bg', '--cuttle-bg', '#0c0c0e']]) gl.uniform3fv(at(name), rgb(theme[variable] ?? fallback));

  const shown = [null, null];
  const draw = () => {
    gl.viewport(0, 0, target.width, target.height);
    gl.uniform1f(at('time'), page.time);
    gl.uniform1f(at('progress'), page.progress);
    gl.uniform2f(at('resolution'), target.width, target.height);
    gl.uniform1f(at('aspect'), target.width / target.height);
    for (const [unit, frame] of [page.from, page.to].entries()) {
      if (!frame || frame === shown[unit]) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      shown[unit] = frame;
    }
    for (const [name, value] of Object.entries(values)) {
      const [type, numbers] = typed(value);
      if (type !== types[name]) continue;
      gl[`uniform${numbers.length}fv`](at(name), numbers);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  page.onFrame(draw);
  return { canvas: target, gl, set: (name, value) => void (values[name] = value) };
}
