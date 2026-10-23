import type { Size } from '../layout';

/** A 2D texture with linear filtering and clamped edges; with `mipmaps`, minification is trilinear. */
export function createTexture(gl: WebGL2RenderingContext, mipmaps: boolean): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * Uploads `source` with its top row at v = 0 (no flip) and premultiplied alpha. WebGL ignores
 * both pixel-store flags for an ImageBitmap, so bitmaps must be created unflipped and with
 * `premultiplyAlpha: 'premultiply'`; that way every source type lands the same way.
 */
export function uploadTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, source: TexImageSource, mipmaps: boolean): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
}

/** Uploads RGBA bytes that are premultiplied already, top row first, as they are. */
export function uploadPixels(gl: WebGL2RenderingContext, texture: WebGLTexture, pixels: { width: number; height: number; data: Uint8Array }): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixels.width, pixels.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);
}

/** Uploads one byte a pixel (a mask), top row first, into the red channel. */
export function uploadMask(gl: WebGL2RenderingContext, texture: WebGLTexture, mask: { width: number; height: number; data: Uint8Array }): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
}

/** Pixel size of anything `texImage2D` accepts. */
export function sourceSize(source: TexImageSource): Size {
  if ('displayWidth' in source) return { width: source.displayWidth, height: source.displayHeight }; // VideoFrame
  if ('videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight };
  if ('naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}
