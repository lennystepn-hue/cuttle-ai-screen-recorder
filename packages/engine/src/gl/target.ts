import type { Size } from '../layout';
import { createTexture } from './texture';

/** An offscreen RGBA8 framebuffer the size of the output. Its row 0 is the bottom of the image, like the canvas. */
export interface RenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

export function createRenderTarget(gl: WebGL2RenderingContext, size: Size): RenderTarget {
  const texture = createTexture(gl, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`render target incomplete: 0x${status.toString(16)}`);
  return { framebuffer, texture };
}

export function deleteRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}
