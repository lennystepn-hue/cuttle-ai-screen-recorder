/// <reference path="./env.d.ts" />
// The heading fonts a theme names (`THEME_FONTS`), for a screenshot's headline and watermark: the
// motion pages' faces (Latin, bundled), each loaded the first time a shot asks for it.
import archivo from '@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2?url';
import fraunces from '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url';
import spaceGrotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url';
import bebasNeue from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import instrumentSerif from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import type { ThemeFont } from '@cuttle/project';

/** A heading font's file, the weights it covers, and the weight a headline's title takes in it. */
const FACES: Record<ThemeFont, { url: string; weights: string; title: number }[]> = {
  Archivo: [{ url: archivo, weights: '100 900', title: 700 }],
  Inter: [
    { url: inter400, weights: '400', title: 600 },
    { url: inter600, weights: '600', title: 600 },
  ],
  'Space Grotesk': [{ url: spaceGrotesk, weights: '300 700', title: 600 }],
  Fraunces: [{ url: fraunces, weights: '100 900', title: 600 }],
  'Instrument Serif': [{ url: instrumentSerif, weights: '400', title: 400 }],
  'Bebas Neue': [{ url: bebasNeue, weights: '400', title: 400 }],
};

/** The family a heading font is drawn with (its own name, so a page's fonts never stand in for it). */
export const headingFamily = (font: ThemeFont): string => `Cuttle Heading ${font}`;

/** The weight a headline's title takes in a font (its only one, for Bebas Neue and Instrument Serif). */
export const headingWeight = (font: ThemeFont): number => FACES[font][0]!.title;

const loaded = new Map<ThemeFont, Promise<void>>();
const ready = new Set<ThemeFont>();

/** Loads a heading font into the document, once; `drawShot` draws with it afterwards. */
export function loadHeadingFont(font: ThemeFont): Promise<void> {
  let loading = loaded.get(font);
  if (!loading) {
    loading = (async () => {
      for (const face of FACES[font]) {
        const loadedFace = await new FontFace(headingFamily(font), `url(${face.url})`, { weight: face.weights }).load();
        document.fonts.add(loadedFace);
      }
      ready.add(font);
    })().catch((error: unknown) => {
      loaded.delete(font);
      throw error;
    });
    loaded.set(font, loading);
  }
  return loading;
}

/** Whether a heading font is loaded (`loadHeadingFont` done). */
export const headingFontReady = (font: ThemeFont): boolean => ready.has(font);
