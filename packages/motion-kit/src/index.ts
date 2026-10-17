// The motion kit: what every motion page can use without the network. It is served at
// cuttle-motion://kit/ from a folder that scripts/copy.mjs builds next to each bundle (the CLI's,
// the app's, the export check's):
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
//   templates/<name>/    the pages `cuttle motion new` copies into a project
//   licenses/            the licenses of what it bundles

/** The kit's origin in a motion page. */
export const KIT_ORIGIN = 'cuttle-motion://kit';

/** The folder of the kit next to a bundle. */
export const KIT_FOLDER = 'motion-kit';

/** Bare names a page may import (its import map): Three.js and its addons, Cuttle's helpers, lottie-web. */
export const KIT_IMPORTS: Readonly<Record<string, string>> = {
  three: `${KIT_ORIGIN}/three/three.module.js`,
  'three/addons/': `${KIT_ORIGIN}/three/addons/`,
  cuttle: `${KIT_ORIGIN}/motion.js`,
  'lottie-web': `${KIT_ORIGIN}/lottie/lottie.mjs`,
};

/** A font face of the kit: `weight` and `stretch` are ranges for a variable font ("100 900", "62% 125%"). */
export interface KitFont {
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  stretch?: string;
  src: string;
}

const face = (family: string, file: string, weight: string, style: KitFont['style'] = 'normal', stretch?: string): KitFont => ({
  family,
  weight,
  style,
  ...(stretch && { stretch }),
  src: `${KIT_ORIGIN}/fonts/${file}`,
});

/**
 * The fonts every page has, without loading them itself:
 * - Inter (the theme's `--cuttle-font`) and JetBrains Mono (`--cuttle-mono`);
 * - for display type: Archivo (variable weight and width, from condensed 62% to expanded 125%),
 *   Space Grotesk, Bebas Neue (condensed capitals), Fraunces (a variable display serif) and
 *   Instrument Serif (an editorial serif, upright and italic).
 */
export const KIT_FONTS: readonly KitFont[] = [
  ...[300, 400, 500, 600, 700, 800, 900].map((weight) => face('Inter', `inter-latin-${weight}-normal.woff2`, String(weight))),
  ...[400, 500, 700].map((weight) => face('JetBrains Mono', `jetbrains-mono-latin-${weight}-normal.woff2`, String(weight))),
  face('Archivo', 'archivo-latin-wdth-normal.woff2', '100 900', 'normal', '62% 125%'),
  face('Archivo', 'archivo-latin-wdth-italic.woff2', '100 900', 'italic', '62% 125%'),
  face('Space Grotesk', 'space-grotesk-latin-wght-normal.woff2', '300 700'),
  face('Bebas Neue', 'bebas-neue-latin-400-normal.woff2', '400'),
  face('Fraunces', 'fraunces-latin-full-normal.woff2', '100 900'),
  face('Fraunces', 'fraunces-latin-full-italic.woff2', '100 900', 'italic'),
  face('Instrument Serif', 'instrument-serif-latin-400-normal.woff2', '400'),
  face('Instrument Serif', 'instrument-serif-latin-400-italic.woff2', '400', 'italic'),
];

/** A template `cuttle motion new` copies: a scene of its own, or an overlay over the clips. */
export interface MotionTemplate {
  name: string;
  kind: 'scene' | 'overlay';
  /** Seconds it lasts when added: a scene's output seconds, an overlay's source seconds. */
  duration: number;
  /** An overlay that belongs over the whole take (it follows the take itself). */
  whole?: boolean;
  description: string;
}

export const MOTION_TEMPLATES: readonly MotionTemplate[] = [
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram, a line, the URL in a pill that types itself, a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring and a number at every click the video shows, on the click' },
  { name: 'kinetic-captions', kind: 'overlay', duration: 0, whole: true, description: 'the spoken words, word by word, the current one in the accent colour' },
];

/** An import map for the kit's bare names, as the first element of a page (before any module). */
export function importMapTag(): string {
  return `<script type="importmap">${JSON.stringify({ imports: KIT_IMPORTS })}</script>`;
}

/** A page with the kit's import map first (after its doctype), before anything that could load a module. */
export function withImportMap(html: string): string {
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return `${doctype}${importMapTag()}${html.slice(doctype.length)}`;
}
