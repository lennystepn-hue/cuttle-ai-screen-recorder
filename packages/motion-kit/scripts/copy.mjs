// Builds the motion kit's folder for a bundle (see src/index.ts for what is where):
//   node packages/motion-kit/scripts/copy.mjs <folder>
// The folder is replaced. Everything comes from this package: its own kit/ and templates/, and the
// files of its dependencies (Three.js, lottie-web, the fonts) with their licenses.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
copy(join(modules, 'three', 'build', 'three.module.js'), 'three/three.module.js');
copy(join(modules, 'three', 'build', 'three.core.js'), 'three/three.core.js');
copy(join(modules, 'three', 'examples', 'jsm'), 'three/addons');
copy(join(modules, 'three', 'LICENSE'), 'licenses/three.js.txt');
copy(join(modules, 'lottie-web', 'build', 'player', 'esm', 'lottie.min.js'), 'lottie/lottie.mjs');
copy(join(modules, 'lottie-web', 'build', 'player', 'lottie.min.js'), 'lottie/lottie.min.js');
copy(join(modules, 'lottie-web', 'LICENSE.md'), 'licenses/lottie-web.txt');

// the Latin faces KIT_FONTS (src/index.ts) names, each family with its licence
const FONTS = [
  ['@fontsource/inter', /^inter-latin-\d+-normal\.woff2$/],
  ['@fontsource/jetbrains-mono', /^jetbrains-mono-latin-\d+-normal\.woff2$/],
  ['@fontsource-variable/archivo', /^archivo-latin-wdth-(normal|italic)\.woff2$/],
  ['@fontsource-variable/space-grotesk', /^space-grotesk-latin-wght-normal\.woff2$/],
  ['@fontsource/bebas-neue', /^bebas-neue-latin-400-normal\.woff2$/],
  ['@fontsource-variable/fraunces', /^fraunces-latin-full-(normal|italic)\.woff2$/],
  ['@fontsource/instrument-serif', /^instrument-serif-latin-400-(normal|italic)\.woff2$/],
];
for (const [pkg, pattern] of FONTS) {
  const files = join(modules, pkg, 'files');
  for (const name of readdirSync(files)) if (pattern.test(name)) copy(join(files, name), `fonts/${name}`);
  copy(join(modules, pkg, 'LICENSE'), `licenses/${pkg.split('/')[1]}.txt`);
}
console.log(`motion kit in ${target}`);
