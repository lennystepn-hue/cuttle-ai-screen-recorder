// Builds the motion kit's folder for a bundle (see src/index.ts for what is where):
//   node packages/motion-kit/scripts/copy.mjs <folder>
// The folder is replaced. Everything comes from this package: its own kit/ and templates/, and the
// files of its dependencies (Three.js, lottie-web, mediabunny, the fonts) with their licenses.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) throw new Error('usage: copy.mjs <folder>');
const target = resolve(out);
const root = fileURLToPath(new URL('..', import.meta.url));
const modules = join(root, 'node_modules');
const copy = (from, to) => cpSync(from, join(target, to), { recursive: true, dereference: true });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
copy(join(root, 'kit'), '.');
copy(join(root, 'templates'), 'templates');
copy(join(root, 'looks'), 'looks');
copy(join(modules, 'three', 'build', 'three.module.js'), 'three/three.module.js');
copy(join(modules, 'three', 'build', 'three.core.js'), 'three/three.core.js');
copy(join(modules, 'three', 'examples', 'jsm'), 'three/addons');
copy(join(modules, 'three', 'LICENSE'), 'licenses/three.js.txt');
copy(join(modules, 'lottie-web', 'build', 'player', 'esm', 'lottie.min.js'), 'lottie/lottie.mjs');
copy(join(modules, 'lottie-web', 'build', 'player', 'lottie.min.js'), 'lottie/lottie.min.js');
copy(join(modules, 'lottie-web', 'LICENSE.md'), 'licenses/lottie-web.txt');
// the take's frames are read with it (take-worker.js), unchanged: its licence is the MPL 2.0
copy(join(modules, 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs'), 'mediabunny/mediabunny.min.mjs');
copy(join(modules, 'mediabunny', 'LICENSE'), 'licenses/mediabunny.txt');
copy(join(modules, 'animejs', 'dist', 'bundles', 'anime.esm.min.js'), 'anime/anime.esm.min.js');
copy(join(modules, 'animejs', 'LICENSE.md'), 'licenses/animejs.txt');
// Lucide's icons as one module of their shapes (icons.js imports it) and their words for `cuttle motion icons`
const lucide = join(modules, 'lucide-static');
mkdirSync(join(target, 'icons'), { recursive: true });
writeFileSync(join(target, 'icons', 'icons.js'), `export default ${JSON.stringify(JSON.parse(readFileSync(join(lucide, 'icon-nodes.json'), 'utf8')))};\n`);
writeFileSync(join(target, 'icons', 'tags.json'), JSON.stringify(JSON.parse(readFileSync(join(lucide, 'tags.json'), 'utf8'))));
copy(join(lucide, 'LICENSE'), 'licenses/lucide.txt');

// the Latin faces KIT_FONTS (src/index.ts) names, each family with its licence
const FONTS = [
  ['@fontsource/inter', /^inter-latin-\d+-normal\.woff2$/],
  ['@fontsource/jetbrains-mono', /^jetbrains-mono-latin-\d+-normal\.woff2$/],
  ['@fontsource-variable/archivo', /^archivo-latin-wdth-(normal|italic)\.woff2$/],
  ['@fontsource-variable/space-grotesk', /^space-grotesk-latin-wght-normal\.woff2$/],
  ['@fontsource/bebas-neue', /^bebas-neue-latin-400-normal\.woff2$/],
  ['@fontsource-variable/fraunces', /^fraunces-latin-full-(normal|italic)\.woff2$/],
  ['@fontsource/instrument-serif', /^instrument-serif-latin-400-(normal|italic)\.woff2$/],
  ['@fontsource-variable/syne', /^syne-latin-wght-normal\.woff2$/],
  ['@fontsource-variable/unbounded', /^unbounded-latin-wght-normal\.woff2$/],
  ['@fontsource/anton', /^anton-latin-400-normal\.woff2$/],
  ['@fontsource-variable/bricolage-grotesque', /^bricolage-grotesque-latin-standard-normal\.woff2$/],
  ['@fontsource-variable/big-shoulders-display', /^big-shoulders-display-latin-wght-normal\.woff2$/],
  ['@fontsource/dm-serif-display', /^dm-serif-display-latin-400-(normal|italic)\.woff2$/],
  ['@fontsource-variable/playfair-display', /^playfair-display-latin-wght-(normal|italic)\.woff2$/],
  ['@fontsource/space-mono', /^space-mono-latin-(400|700)-(normal|italic)\.woff2$/],
  ['@fontsource/rubik-mono-one', /^rubik-mono-one-latin-400-normal\.woff2$/],
  ['@fontsource-variable/caveat', /^caveat-latin-wght-normal\.woff2$/],
];
for (const [pkg, pattern] of FONTS) {
  const files = join(modules, pkg, 'files');
  for (const name of readdirSync(files)) if (pattern.test(name)) copy(join(files, name), `fonts/${name}`);
  copy(join(modules, pkg, 'LICENSE'), `licenses/${pkg.split('/')[1]}.txt`);
}
console.log(`motion kit in ${target}`);
