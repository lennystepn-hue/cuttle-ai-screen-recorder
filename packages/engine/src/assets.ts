/// <reference path="./env.d.ts" />
// The reference makes the `?url` imports typecheck in every package that imports the engine; they
// still need a bundler that understands `?url` (Vite).
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import { CURSOR_ART, CURSOR_TEXTURE_PX, type CursorImage } from './presets/cursors';

/** The family every engine text is drawn with (Inter 400 and 600, bundled). */
export const FONT_FAMILY = 'Cuttle Inter';

/** Everything the renderer needs that has to load asynchronously. Load once, share between renderers. */
export interface EngineAssets {
  cursors: ReadonlyMap<CursorImage, ImageBitmap>;
}

let fonts: Promise<void> | undefined;

function loadFonts(): Promise<void> {
  fonts ??= (async () => {
    for (const [weight, url] of [
      ['400', inter400],
      ['600', inter600],
    ] as const) {
      const face = new FontFace(FONT_FAMILY, `url(${url})`, { weight });
      await face.load();
      document.fonts.add(face);
    }
  })().catch((error: unknown) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}

/**
 * Rasterizes an SVG at `px` × `px`, premultiplied and not flipped (see `uploadTexture`).
 * Goes through an <img>: Chromium cannot decode SVG blobs with createImageBitmap directly.
 */
async function rasterizeSvg(svg: string, px: number): Promise<ImageBitmap> {
  const sized = svg.replace('<svg ', `<svg width="${px}" height="${px}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image, { premultiplyAlpha: 'premultiply' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads the fonts into the document and rasterizes the cursor art. Needs a window (not a worker). */
export async function loadEngineAssets(): Promise<EngineAssets> {
  await loadFonts();
  const images = Object.keys(CURSOR_ART) as CursorImage[];
  const bitmaps = await Promise.all(images.map((image) => rasterizeSvg(CURSOR_ART[image].svg, CURSOR_TEXTURE_PX)));
  return { cursors: new Map(images.map((image, i) => [image, bitmaps[i]!])) };
}
