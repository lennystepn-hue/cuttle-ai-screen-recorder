import { backgroundColors, darkTone, type Look } from '@cuttle/project';
import { hexToRgb, type Rgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
import type { Size } from '../layout';
import { BACKGROUNDS } from '../presets/backgrounds';

/** Fills the whole output with the background preset. */
export class BackgroundPass {
  private readonly shader: Shader;
  private readonly image?: { texture: WebGLTexture; size: Size };
  /** The palette of a coloured background, and a dark tone of it. */
  private readonly colors: Rgb[];
  private readonly base?: Rgb;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly background: Look['background'],
    image: ImageBitmap | undefined,
  ) {
    this.shader = new Shader(gl, `background ${background.preset}`, RECT_VERTEX, FRAGMENT_PRELUDE + BACKGROUNDS[background.preset]);
    if (background.preset === 'image') {
      if (!image) throw new Error('createRenderer: look.background.preset is "image" but no backgroundImage was given');
      // mipmapped: a blurred image reads coarser levels
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, image, true);
      this.image = { texture, size: { width: image.width, height: image.height } };
    }
    const colors = backgroundColors(background);
    this.colors = colors.map(hexToRgb);
    if (colors.length > 0) this.base = hexToRgb(darkTone(colors, 0.8));
  }

  draw(t: number): void {
    const { background } = this;
    const shader = this.shader.use().float('u_time', t);
    if (background.color) shader.vec3('u_color', hexToRgb(background.color));
    if (this.image) {
      shader
        .texture('u_image', 0, this.image.texture)
        .vec2('u_imageSize', this.image.size.width, this.image.size.height)
        .float('u_blur', background.blur ?? 0)
        .float('u_dim', background.dim ?? 0);
    }
    if (this.colors.length > 0) {
      this.colors.forEach((color, i) => shader.vec3(`u_colors[${i}]`, color));
      shader.int('u_count', this.colors.length).vec3('u_base', this.base!);
      shader.float('u_angle', background.angle ?? 135).float('u_radial', background.kind === 'radial' ? 1 : 0);
    }
    drawRect(this.gl, shader, [0, 0, this.output.width, this.output.height], this.output);
  }

  dispose(): void {
    this.shader.dispose();
    if (this.image) this.gl.deleteTexture(this.image.texture);
  }
}
