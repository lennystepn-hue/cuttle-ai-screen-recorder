import type { Rect } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, type Size, type WindowLayout } from '../layout';
import { ADDRESS_FIELD, CAPTION_BUTTONS, TAB, TRAFFIC_LIGHT, TRAFFIC_LIGHTS, WINDOW_SHADOW, type DeviceChrome, type FrameChrome } from '../presets/frames';
import { windowTitleStyle } from '../presets/labels';
import type { SpriteCache } from '../sprites';
import type { SpritePass } from './sprite';

const SHADOW = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_blur;
uniform float u_offset;
uniform float u_opacity;
void main() {
  float d = sdRoundRect(v_px - vec2(0.0, u_offset), u_window, u_radius);
  o_color = vec4(0.0, 0.0, 0.0, u_opacity * (1.0 - smoothstep(-u_blur * 0.5, u_blur, d)));
}`;

const CHROME = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_titleBar;
uniform float u_line;
uniform vec3 u_barColor;
uniform vec3 u_lineColor;
uniform vec3 u_lights;      // inset, spacing, radius in px; radius 0 draws none
uniform vec3 u_light0;
uniform vec3 u_light1;
uniform vec3 u_light2;
uniform vec4 u_address;     // address field rect; width 0 draws none
uniform float u_addressRadius;
uniform vec3 u_addressColor;
uniform vec3 u_caption;     // button width, glyph size, stroke in px; width 0 draws none
uniform vec3 u_glyphColor;
uniform vec4 u_tab;         // a tab's rect (its bottom runs into the content); width 0 draws none
uniform float u_tabRadius;
uniform vec3 u_tabColor;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main() {
  float inside = coverage(sdRoundRect(v_px, u_window, u_radius));
  vec3 color = mix(u_barColor, u_lineColor, step(u_window.y + u_titleBar - u_line, v_px.y));
  if (u_address.z > 0.0) color = mix(color, u_addressColor, coverage(sdRoundRect(v_px, u_address, u_addressRadius)));
  if (u_tab.z > 0.0) {
    // rounded at the top only: the rect runs a radius below the bar, clipped at the bar's foot
    vec4 tab = vec4(u_tab.xy, u_tab.z, u_tab.w + u_tabRadius);
    float under = step(v_px.y, u_window.y + u_titleBar);
    color = mix(color, u_tabColor, coverage(sdRoundRect(v_px, tab, u_tabRadius)) * under);
  }
  if (u_lights.z > 0.0) {
    vec2 first = vec2(u_window.x + u_lights.x, u_window.y + u_titleBar * 0.5);
    color = mix(color, u_light0, coverage(length(v_px - first) - u_lights.z));
    color = mix(color, u_light1, coverage(length(v_px - first - vec2(u_lights.y, 0.0)) - u_lights.z));
    color = mix(color, u_light2, coverage(length(v_px - first - vec2(2.0 * u_lights.y, 0.0)) - u_lights.z));
  }
  if (u_caption.x > 0.0) {
    // Windows' minimise, maximise and close, right to left from the window's right edge
    float cy = u_window.y + u_titleBar * 0.5;
    float right = u_window.x + u_window.z;
    float g = u_caption.y * 0.5;
    float stroke = u_caption.z * 0.5;
    vec2 close = vec2(right - u_caption.x * 0.5, cy);
    vec2 maximise = close - vec2(u_caption.x, 0.0);
    vec2 minimise = maximise - vec2(u_caption.x, 0.0);
    float d = segment(v_px, minimise - vec2(g, 0.0), minimise + vec2(g, 0.0)) - stroke;
    d = min(d, abs(sdRoundRect(v_px, vec4(maximise - vec2(g), vec2(2.0 * g)), 0.0)) - stroke);
    d = min(d, segment(v_px, close - vec2(g), close + vec2(g)) - stroke);
    d = min(d, segment(v_px, close + vec2(-g, g), close + vec2(g, -g)) - stroke);
    color = mix(color, u_glyphColor, coverage(d));
  }
  o_color = vec4(color * inside, inside);
}`;

const DEVICE = `${FRAGMENT_PRELUDE}
uniform vec4 u_window;
uniform float u_radius;
uniform float u_edge;       // the metal band's width in px
uniform vec3 u_body;
uniform vec3 u_metal;
uniform vec4 u_buttons[4];  // side buttons: x, y (top), width, height; width 0 draws none
void main() {
  float body = sdRoundRect(v_px, u_window, u_radius);
  // the side buttons, behind the band: metal, a little lighter at their edge
  float buttons = 1e5;
  for (int i = 0; i < 4; i++) {
    if (u_buttons[i].z > 0.0) buttons = min(buttons, sdRoundRect(v_px, u_buttons[i], min(u_buttons[i].z, u_buttons[i].w) * 0.5));
  }
  // the band: metal catching the light from the top left, the body black inside it
  vec2 uv = (v_px - u_window.xy) / u_window.zw;
  vec3 metal = u_metal * (0.82 + 0.36 * (1.0 - (uv.x + uv.y) * 0.5));
  vec3 color = mix(u_body, metal, 1.0 - smoothstep(u_edge - 1.0, u_edge, -body));
  float a = max(coverage(body), coverage(buttons));
  color = mix(metal * 0.9, color, coverage(body));
  o_color = vec4(color * a, a);
}`;

const CAMERA = `${FRAGMENT_PRELUDE}
uniform vec4 u_shape;       // the island's or the dot's rect
void main() {
  float d = sdRoundRect(v_px, u_shape, min(u_shape.z, u_shape.w) * 0.5);
  float a = coverage(d);
  // a lens glint in the dot, or in the island's end towards the phone's right (its top, held across)
  float thin = min(u_shape.z, u_shape.w);
  vec2 lens = u_shape.z >= u_shape.w ? vec2(u_shape.x + u_shape.z - thin * 0.5, u_shape.y + thin * 0.5) : vec2(u_shape.x + thin * 0.5, u_shape.y + thin * 0.5);
  float glint = coverage(length(v_px - lens) - thin * 0.22) * 0.18;
  o_color = vec4(vec3(0.02 + glint) * a, a);
}`;

/**
 * A rect given as the phone is held upright (`short` wide, `long` high, from its top left), in a
 * window held either way: across, the phone is turned a quarter to the left (its top on the left).
 */
function held(window: Rect, [px, py, pw, ph]: Rect): Rect {
  const [x, y, w, h] = window;
  return w <= h ? [x + px, y + py, pw, ph] : [x + py, y + h - px - pw, ph, pw];
}

/** The side buttons of a device, as rects outside its body (upright: action and volume on the left, power on the right). */
function sideButtons(window: Rect, device: DeviceChrome): Rect[] {
  const short = Math.min(window[2], window[3]);
  const long = Math.max(window[2], window[3]);
  const depth = Math.max(2, Math.round(short * 0.012));
  const left = -depth + 1;
  const right = short - 1;
  const at = (top: number, length: number, side: number): Rect => held(window, [side, Math.round(long * top), depth, Math.round(long * length)]);
  return device.camera === 'island'
    ? [at(0.17, 0.045, left), at(0.25, 0.085, left), at(0.355, 0.085, left), at(0.28, 0.12, right)]
    : [at(0.2, 0.07, right), at(0.32, 0.15, right)];
}

/** The window's soft shadow, title bar (traffic lights, address field, caption buttons, a tab) and title; or a device's body, and its camera. */
export class WindowPass {
  private readonly shadow: Shader;
  private readonly chrome: Shader;
  private readonly device: Shader;
  private readonly camera: Shader;
  private readonly unit: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly sprites: SpriteCache,
    private readonly spritePass: SpritePass,
  ) {
    this.shadow = new Shader(gl, 'window shadow', RECT_VERTEX, SHADOW);
    this.chrome = new Shader(gl, 'window chrome', RECT_VERTEX, CHROME);
    this.device = new Shader(gl, 'device', RECT_VERTEX, DEVICE);
    this.camera = new Shader(gl, 'device camera', RECT_VERTEX, CAMERA);
    this.unit = unitFor(output);
  }

  /** Everything under the content: the shadow, then the title bar or the device's body. */
  draw(layout: WindowLayout, chrome: FrameChrome, shadow: boolean, title: string): void {
    const u = this.unit;
    const [x, y, w, h] = layout.window;
    if (shadow) {
      const blur = WINDOW_SHADOW.blur * u;
      const offset = WINDOW_SHADOW.offset * u;
      this.shadow
        .use()
        .vec4('u_window', layout.window)
        .float('u_radius', layout.radius)
        .float('u_blur', blur)
        .float('u_offset', offset)
        .float('u_opacity', WINDOW_SHADOW.opacity);
      drawRect(this.gl, this.shadow, [x - blur, y - blur + offset, w + 2 * blur, h + 2 * blur], this.output);
    }
    if (chrome.device) return this.drawDevice(layout, chrome.device);
    if (layout.titleBar === 0) return;

    const address: Rect = chrome.address
      ? (() => {
          const width = Math.round(Math.min(ADDRESS_FIELD.width * u, w * 0.5));
          const height = Math.round(ADDRESS_FIELD.height * u);
          return [x + Math.round((w - width) / 2), y + Math.round((layout.titleBar - height) / 2), width, height];
        })()
      : [0, 0, 0, 0];
    // the caption buttons take the right; a title or a tab on the left stays clear of them
    const buttons = chrome.captionButtons ? CAPTION_BUTTONS.width * 3 * u : 0;
    const text = chrome.tab ? `›_   ${title}`.trimEnd() : title;
    const maxWidth = chrome.address ? address[2] - 24 * u : chrome.captionButtons ? w - buttons - 2 * CAPTION_BUTTONS.titleInset * u - (chrome.tab ? 2 * TAB.pad * u : 0) : w * 0.6;
    const sprite = text === '' ? undefined : this.sprites.label(text, windowTitleStyle(chrome.title), u, Math.max(1, maxWidth));
    const tab: Rect = chrome.tab
      ? [x + Math.round(TAB.inset * u), y + Math.round(TAB.inset * u), Math.round((sprite?.box.width ?? 0) + 2 * TAB.pad * u), layout.titleBar - Math.round(TAB.inset * u)]
      : [0, 0, 0, 0];
    this.chrome
      .use()
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .float('u_titleBar', layout.titleBar)
      .float('u_line', Math.max(1, Math.round(u)))
      .vec3('u_barColor', hexToRgb(chrome.bar))
      .vec3('u_lineColor', hexToRgb(chrome.line))
      .vec3('u_lights', chrome.trafficLights ? [TRAFFIC_LIGHT.inset * u, TRAFFIC_LIGHT.spacing * u, TRAFFIC_LIGHT.radius * u] : [0, 0, 0])
      .vec3('u_light0', hexToRgb(TRAFFIC_LIGHTS[0]))
      .vec3('u_light1', hexToRgb(TRAFFIC_LIGHTS[1]))
      .vec3('u_light2', hexToRgb(TRAFFIC_LIGHTS[2]))
      .vec4('u_address', address)
      .float('u_addressRadius', ADDRESS_FIELD.radius * u)
      .vec3('u_addressColor', hexToRgb(chrome.address?.fill ?? '#FFFFFF'))
      .vec3('u_caption', chrome.captionButtons ? [CAPTION_BUTTONS.width * u, CAPTION_BUTTONS.glyph * u, Math.max(1, u)] : [0, 0, 0])
      .vec3('u_glyphColor', hexToRgb(chrome.title))
      .vec4('u_tab', tab)
      .float('u_tabRadius', TAB.radius * u)
      .vec3('u_tabColor', hexToRgb(chrome.tab?.fill ?? chrome.bar));
    drawRect(this.gl, this.chrome, [x, y, w, layout.titleBar], this.output);

    if (!sprite) return;
    const top = (area: Rect) => Math.round(area[1] + (area[3] - sprite.box.height) / 2);
    if (chrome.tab) return this.spritePass.drawSprite(sprite, Math.round(tab[0] + TAB.pad * u), top(tab), 1);
    if (chrome.captionButtons) return this.spritePass.drawSprite(sprite, Math.round(x + CAPTION_BUTTONS.titleInset * u), top([x, y, w, layout.titleBar]), 1);
    const area: Rect = chrome.address ? address : [x, y, w, layout.titleBar];
    this.spritePass.drawSprite(sprite, Math.round(area[0] + (area[2] - sprite.box.width) / 2), top(area), 1);
  }

  /** A device's body: its side buttons, its metal band and its black bezel (the screen comes on top). */
  private drawDevice(layout: WindowLayout, device: DeviceChrome): void {
    const [x, y, w, h] = layout.window;
    const buttons = sideButtons(layout.window, device);
    const shader = this.device
      .use()
      .vec4('u_window', layout.window)
      .float('u_radius', layout.radius)
      .float('u_edge', Math.max(1.5, Math.min(w, h) * 0.012))
      .vec3('u_body', hexToRgb(device.body))
      .vec3('u_metal', hexToRgb(device.edge));
    for (let i = 0; i < 4; i++) shader.vec4(`u_buttons[${i}]`, buttons[i] ?? [0, 0, 0, 0]);
    const reach = Math.max(2, Math.round(Math.min(w, h) * 0.012));
    drawRect(this.gl, shader, [x - reach, y - reach, w + 2 * reach, h + 2 * reach], this.output);
  }

  /** What sits over a device's screen: the Dynamic Island or the punch-hole camera, at its top centre (held across: its left). */
  drawOver(layout: WindowLayout, chrome: FrameChrome): void {
    const device = chrome.device;
    if (!device) return;
    const s = Math.min(layout.clip[2], layout.clip[3]);
    const upright: Rect = device.camera === 'island' ? [s * 0.35, s * 0.03, s * 0.3, s * 0.088] : [s * 0.484, s * 0.028, s * 0.032, s * 0.032];
    const shape = held(layout.clip, upright).map(Math.round) as Rect;
    this.camera.use().vec4('u_shape', shape);
    drawRect(this.gl, this.camera, shape, this.output);
  }

  dispose(): void {
    this.shadow.dispose();
    this.chrome.dispose();
    this.device.dispose();
    this.camera.dispose();
  }
}
