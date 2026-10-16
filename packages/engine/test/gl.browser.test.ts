import { describe, expect, it } from 'vitest';
import { FRAGMENT_PRELUDE, RECT_VERTEX, drawRect, withScissor } from '../src/gl/rect';
import { Shader } from '../src/gl/shader';
import { createTexture, sourceSize, uploadTexture } from '../src/gl/texture';
import { pixelAt, readPixels } from './gl-util';

function context(width: number, height: number): WebGL2RenderingContext {
  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error('no WebGL2');
  gl.bindVertexArray(gl.createVertexArray());
  return gl;
}

const TEXTURED = `${FRAGMENT_PRELUDE}
uniform sampler2D u_tex;
void main() { o_color = texture(u_tex, v_uv); }`;

const SOLID = `${FRAGMENT_PRELUDE}
uniform vec3 u_color;
void main() { o_color = vec4(u_color, 1.0); }`;

describe('Shader', () => {
  it('names the shader and quotes the compiler log when compiling fails', () => {
    const gl = context(4, 4);
    expect(() => new Shader(gl, 'broken', RECT_VERTEX, `${FRAGMENT_PRELUDE}\nvoid main() { o_color = nope; }`)).toThrow(
      /shader broken \(fragment\) failed to compile: .*nope/s,
    );
  });
});

describe('drawRect', () => {
  it('draws a rect given in output px with the origin at the top-left', () => {
    const gl = context(8, 8);
    const shader = new Shader(gl, 'solid', RECT_VERTEX, SOLID).use();
    shader.vec3('u_color', [1, 0, 0]);
    drawRect(gl, shader, [0, 0, 4, 2], { width: 8, height: 8 });
    const pixels = readPixels(gl);
    expect(pixelAt(pixels, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(pixels, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(pixels, 4, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 0, 2)).toEqual([0, 0, 0, 255]);
  });

  it('keeps drawing inside the scissor rect', () => {
    const gl = context(8, 8);
    const shader = new Shader(gl, 'solid', RECT_VERTEX, SOLID).use();
    shader.vec3('u_color', [0, 1, 0]);
    withScissor(gl, { width: 8, height: 8 }, [2, 2, 2, 2], () => drawRect(gl, shader, [0, 0, 8, 8], { width: 8, height: 8 }));
    const pixels = readPixels(gl);
    expect(pixelAt(pixels, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(pixels, 1, 2)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 4, 4)).toEqual([0, 0, 0, 255]);
  });
});

describe('uploadTexture', () => {
  async function sources(): Promise<TexImageSource[]> {
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1); // top-left texel red
    return [canvas, await createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' })];
  }

  it('lands every source type with its top row at the top', async () => {
    for (const source of await sources()) {
      const gl = context(2, 2);
      const texture = createTexture(gl, false);
      uploadTexture(gl, texture, source, false);
      const shader = new Shader(gl, 'textured', RECT_VERTEX, TEXTURED).use().texture('u_tex', 0, texture);
      drawRect(gl, shader, [0, 0, 2, 2], { width: 2, height: 2 });
      const pixels = readPixels(gl);
      expect(pixelAt(pixels, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(pixels, 1, 1)).toEqual([0, 0, 255, 255]);
    }
  });

  it('reads the size of canvases and bitmaps', async () => {
    for (const source of await sources()) expect(sourceSize(source)).toEqual({ width: 2, height: 2 });
  });
});
