// The motion kit: what every motion page can use without the network. It is served at
// cuttle-motion://kit/ from a folder that scripts/copy.mjs builds next to each bundle (the CLI's,
// the app's, the export check's):
//   motion.js            Cuttle's helpers (easing, tweens, text, code)
//   sound.js             Cuttle's sound kit for music pages (instruments, effects, harmony, the video's parts)
//   blank.html           the page a video's sounds render in when it has no music page
//   take-worker.js       reads the screen recording's frames for `cuttle.take.frame`, its masks painted (take.js)
//   three/               Three.js (three.module.js, three.core.js) and its addons (three/addons/)
//   lottie/              lottie-web: lottie.mjs (a module) and lottie.min.js (a script)
//   mediabunny/          mediabunny.min.mjs: reads video files for the take's frames
//   fonts/               Inter, JetBrains Mono and display faces (woff2, Latin; see KIT_FONTS)
//   templates/<name>/    the pages `cuttle motion new` copies into a project
//   licenses/            the licenses of what it bundles

/** The kit's origin in a motion page. */
export const KIT_ORIGIN = 'cuttle-motion://kit';

/** The folder of the kit next to a bundle. */
export const KIT_FOLDER = 'motion-kit';

/** Bare names a page may import (its import map): Three.js and its addons, Cuttle's helpers and sound kit, lottie-web. */
export const KIT_IMPORTS: Readonly<Record<string, string>> = {
  three: `${KIT_ORIGIN}/three/three.module.js`,
  'three/addons/': `${KIT_ORIGIN}/three/addons/`,
  cuttle: `${KIT_ORIGIN}/motion.js`,
  'cuttle/sound': `${KIT_ORIGIN}/sound.js`,
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
  { name: 'title', kind: 'scene', duration: 3.5, description: 'a kinetic title: the words rise out of a blur with a whoosh, an accent line draws under them' },
  { name: 'end-card', kind: 'scene', duration: 4, description: 'the end card: a logo or monogram that lands with a hit, a line, the URL in a pill that types itself (keys, a ding), a call to action' },
  { name: 'code-typing', kind: 'scene', duration: 6, description: 'a code editor that types a file with syntax colours, line by line, keys clattering' },
  { name: 'device-3d', kind: 'scene', duration: 5, description: 'a laptop or tablet in 3D whose screen plays the take: it turns in as the lid opens, then flies into the screen' },
  { name: 'lower-third', kind: 'overlay', duration: 4, description: 'a name and a role in a bar that wipes in (a swoosh) and out' },
  { name: 'click-callouts', kind: 'overlay', duration: 0, whole: true, description: 'a ring, a number and a pop at every click the video shows, on the click' },
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

/** A music page `cuttle music new` copies into `music/<name>/`: a starting point for the video's own music. */
export interface MusicTemplate {
  name: string;
  description: string;
}

/** The music templates (their folders in templates/ are `music-<name>`). */
export const MUSIC_TEMPLATES: readonly MusicTemplate[] = [
  { name: 'pulse', description: 'driving electronic: four on the floor where the video is busy, a pad where it breathes, risers and hits on the scene changes' },
  { name: 'drift', description: 'calm and wide, for a walkthrough with a voice: strings and a pad, a glassy arpeggio, a soft pulse, swells into the scene changes' },
  { name: 'lofi', description: 'laid back with swing: a dusty beat, an electric piano on seventh chords, a round bass, record crackle, a tick on each click' },
  { name: 'bright', description: 'upbeat and friendly for a launch: claps, an octave bass, a marimba, bells on the scene changes, a pop on each click' },
  { name: 'cinematic', description: 'a trailer: low strings and a drone, toms that grow with the energy, a ticking clock, braams, impacts and sub drops on the cuts' },
];

/** The built-in sounds of a project's `sounds` (kit/sound.js plays them; a test keeps the two lists the same). */
export const BUILT_IN_SOUNDS: readonly (readonly [name: string, description: string])[] = [
  ['whoosh', 'air rushing past, loudest on its moment, left to right'],
  ['swoosh-in', 'a short whoosh that lands on its moment'],
  ['riser', 'rising noise and tone for 2 s that end on its moment (a cut, a reveal)'],
  ['impact', 'a deep boom and a crack with a long tail'],
  ['downlifter', 'falling noise from its moment'],
  ['sub-drop', 'a falling sub you feel more than hear'],
  ['braam', 'a cinematic low brass hit'],
  ['reverse-cymbal', 'a cymbal swell that ends on its moment'],
  ['swell', 'a chord that swells up to its moment'],
  ['pop', 'a bubble pop (something appears)'],
  ['click', 'a UI click'],
  ['tick', 'a soft tick (a counter, a step)'],
  ['ding', 'a bell-like ding (a notification)'],
  ['chime', 'three bell notes up a chord'],
  ['success', 'two bright notes up: it worked'],
  ['error', 'two dull notes down: it did not'],
  ['type-burst', 'a burst of keys typed fast'],
  ['glitch', 'a digital stutter'],
];
