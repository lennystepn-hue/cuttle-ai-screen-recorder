import type { Look } from '@cuttle/project';
import { hexToRgb } from '../color';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect } from '../gl/rect';
import { Shader } from '../gl/shader';
import { createTexture, uploadTexture } from '../gl/texture';
import type { Size } from '../layout';
import { BACKGROUNDS } from '../presets/backgrounds';

/** Fills the whole output with the background preset. */
export class BackgroundPass {
  private readonly shader: Shader;
  private readonly image?: { texture: WebGLTexture; size: Size };

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly output: Size,
    private readonly background: Look['background'],
    image: ImageBitmap | undefined,
  ) {
    this.shader = new Shader(gl, `background ${background.preset}`, RECT_VERTEX, FRAGMENT_PRELUDE + BACKGROUNDS[background.preset]);
    if (background.preset === 'image') {
      if (!image) throw new Error('createRenderer: look.background.preset is "image" but no backgroundImage was given');
      const texture = createTexture(gl, true);
      uploadTexture(gl, texture, image, true);
      this.image = { texture, size: { width: image.width, height: image.height } };
    }
  }

  draw(t: number): void {
    const shader = this.shader.use().float('u_time', t);
    if (this.background.color) shader.vec3('u_color', hexToRgb(this.background.color));
    if (this.image) shader.texture('u_image', 0, this.image.texture).vec2('u_imageSize', this.image.size.width, this.image.size.height);
    drawRect(this.gl, shader, [0, 0, this.output.width, this.output.height], this.output);
  }

  dispose(): void {
    this.shader.dispose();
    if (this.image) this.gl.deleteTexture(this.image.texture);
  }
}
