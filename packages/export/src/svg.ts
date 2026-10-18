// An SVG as a bitmap for the engine (createImageBitmap reads no SVG from bytes): decoded by an
// image, drawn this many pixels on its longer side. Browser code: the export page and the editor.

/** How large an SVG without a size of its own (a logo's viewBox only) is drawn on its longer side. */
export const SVG_SIZE = 512;

/** Whether a path names an SVG. */
export const isSvg = (path: string): boolean => /\.svg$/i.test(path);

/** The SVG's bytes as a premultiplied bitmap, `SVG_SIZE` px on its longer side. */
export async function svgBitmap(bytes: Uint8Array<ArrayBuffer>): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || SVG_SIZE;
    const height = image.naturalHeight || SVG_SIZE;
    const scale = SVG_SIZE / Math.max(width, height);
    // drawn onto a canvas of that size first: a bitmap made from an SVG image of no size of its own comes out empty
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas, { premultiplyAlpha: 'premultiply' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
