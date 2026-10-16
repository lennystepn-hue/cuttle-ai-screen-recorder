import type { Rect } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { unitFor, type Size, type WindowLayout } from '../layout';
import { ADDRESS_FIELD, TRAFFIC_LIGHT, TRAFFIC_LIGHTS, WINDOW_SHADOW, type FrameChrome } from '../presets/frames';
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
void main() {
  float inside = coverage(sdRoundRect(v_px, u_window, u_radius));
  vec3 color = mix(u_barColor, u_lineColor, step(u_window.y + u_titleBar - u_line, v_px.y));
  if (u_address.z > 0.0) color = mix(color, u_addressColor, coverage(sdRoundRect(v_px, u_address, u_addressRadius)));
  if (u_lights.z > 0.0) {
    vec2 first = vec2(u_window.x + u_lights.x, u_window.y + u_titleBar * 0.5);
    color = mix(color, u_light0, coverage(length(v_px - first) - u_lights.z));
    color = mix(color, u_light1, coverage(length(v_px - first - vec2(u_lights.y, 0.0)) - u_lights.z));
    color = mix(color, u_light2, coverage(length(v_px - first - vec2(2.0 * u_lights.y, 0.0)) - u_lights.z));
  }
  o_color = vec4(color * inside, inside);
}`;

/** The window's soft shadow, title bar, traffic lights, address field and title. */
export class WindowPass {
  private readonly shadow: Shader;
  private readonly chrome: Shader;
  private readonly unit: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly sprites: SpriteCache,
    private readonly spritePass: SpritePass,
  ) {
    this.shadow = new Shader(gl, 'window shadow', RECT_VERTEX, SHADOW);
    this.chrome = new Shader(gl, 'window chrome', RECT_VERTEX, CHROME);
    this.unit = unitFor(output);
  }

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
    if (layout.titleBar === 0) return;

    const address: Rect = chrome.address
      ? (() => {
          const width = Math.round(Math.min(ADDRESS_FIELD.width * u, w * 0.5));
          const height = Math.round(ADDRESS_FIELD.height * u);
          return [x + Math.round((w - width) / 2), y + Math.round((layout.titleBar - height) / 2), width, height];
        })()
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
      .vec3('u_addressColor', hexToRgb(chrome.address?.fill ?? '#FFFFFF'));
    drawRect(this.gl, this.chrome, [x, y, w, layout.titleBar], this.output);

    if (title === '') return;
    const area: Rect = chrome.address ? address : [x, y, w, layout.titleBar];
    const maxWidth = chrome.address ? area[2] - 24 * u : w * 0.6;
    const sprite = this.sprites.label(title, windowTitleStyle(chrome.title), u, maxWidth);
    this.spritePass.drawSprite(
      sprite,
      Math.round(area[0] + (area[2] - sprite.box.width) / 2),
      Math.round(area[1] + (area[3] - sprite.box.height) / 2),
      1,
    );
  }

  dispose(): void {
    this.shadow.dispose();
    this.chrome.dispose();
  }
}
