import type { Rect } from '@cuttle/project';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import type { Size } from '../layout';
import type { Sprite } from '../sprites';

const FRAGMENT = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_flipY;
void main() {
  vec2 uv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flipY));
  o_color = texture(u_tex, uv) * u_opacity;
}`;

/** Draws a premultiplied texture into a rect: label sprites and offscreen layers. */
export class SpritePass {
  private readonly shader: Shader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
  ) {
    this.shader = new Shader(gl, 'sprite', RECT_VERTEX, FRAGMENT);
  }

  /** `flipY` for render-target textures, whose row 0 is the bottom of the image. */
  draw(texture: WebGLTexture, rect: Rect, opacity: number, flipY = false): void {
    this.shader.use().texture('u_tex', 0, texture).float('u_opacity', opacity).float('u_flipY', flipY ? 1 : 0);
    drawRect(this.gl, this.shader, rect, this.output);
  }

  /** Draws a label sprite with its box's top-left corner at (`x`, `y`). */
  drawSprite(sprite: Sprite, x: number, y: number, opacity: number): void {
    this.draw(sprite.texture, [x - sprite.margin, y - sprite.margin, sprite.width, sprite.height], opacity);
  }

  dispose(): void {
    this.shader.dispose();
  }
}
