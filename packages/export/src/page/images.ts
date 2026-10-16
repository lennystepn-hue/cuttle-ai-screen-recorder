import { host, PageError } from './host';

/**
 * Decodes a PNG or JPEG for the engine: premultiplied, not flipped, and scaled down to fit
 * `maxSize` on its longer side (the GPU's MAX_TEXTURE_SIZE) when it is larger.
 */
export async function loadImage(path: string, maxSize: number, what: string): Promise<ImageBitmap> {
  const blob = new Blob([(await host().readFile(path)) as Uint8Array<ArrayBuffer>]);
  const options: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, options);
  } catch (error) {
    throw new PageError('invalid-media', `${what} is not an image this build can decode (${(error as Error).message}): ${path}`);
  }
  const longer = Math.max(bitmap.width, bitmap.height);
  if (longer <= maxSize) return bitmap;
  const scale = maxSize / longer;
  const width = Math.max(1, Math.floor(bitmap.width * scale));
  const height = Math.max(1, Math.floor(bitmap.height * scale));
  bitmap.close();
  return createImageBitmap(blob, { ...options, resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
}
