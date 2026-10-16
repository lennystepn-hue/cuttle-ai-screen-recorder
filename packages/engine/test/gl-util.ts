export interface Pixels {
  width: number;
  height: number;
  /** RGBA8, rows top to bottom. */
  data: Uint8Array;
}

/** Reads the drawing buffer of `gl` and flips it so row 0 is the top of the image. */
export function readPixels(gl: WebGL2RenderingContext): Pixels {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const raw = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const data = new Uint8Array(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) data.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width, height, data };
}

export function pixelAt(pixels: Pixels, x: number, y: number): number[] {
  const i = (y * pixels.width + x) * 4;
  return [...pixels.data.subarray(i, i + 4)];
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
