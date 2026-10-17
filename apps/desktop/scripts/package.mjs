// Packages the built app (apps/desktop/dist, from app:build:js) as an unpacked app folder in
// apps/desktop/build/Cuttle-<platform>-<arch>/: no installer, no signing. The native modules the
// recorder loads (koffi and uiohook-napi, with their prebuilt binaries for this platform) are
// copied next to the bundle and kept outside the asar archive. So is the app's own copy of the CLI
// (apps/cli/dist, from cli:build): the cuttle command the app installs runs it with the app as Node,
// which cannot load modules from inside the archive. The skill's files go in for the same install.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const build = join(desktop, 'build');
const stage = join(build, 'stage');
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const NATIVE = ['koffi', 'uiohook-napi'];

const cli = join(desktop, '..', 'cli', 'dist');
const skill = join(desktop, '..', '..', 'skill', 'cuttle');
if (!existsSync(join(desktop, 'dist', 'main', 'index.mjs'))) throw new Error('apps/desktop/dist is missing: run "pnpm app:build:js" first');
if (!existsSync(join(cli, 'cuttle.mjs'))) throw new Error('apps/cli/dist is missing: run "pnpm cli:build" first');
rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

/**
 * The real folder of package `name` as Node finds it from the folder `from` (node_modules there and
 * in every parent; a package's own exports may hide its package.json from require.resolve);
 * undefined when it is not installed (an optional dependency for another platform).
 */
function packageDir(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/** The native modules and everything they need at run time, flat: name → real folder. */
const modules = new Map();
const queue = NATIVE.map((name) => [name, desktop]);
while (queue.length > 0) {
  const [name, from] = queue.shift();
  if (modules.has(name)) continue;
  const dir = packageDir(name, from);
  if (!dir) {
    if (NATIVE.includes(name)) throw new Error(`${name} is not installed for apps/desktop`);
    continue;
  }
  modules.set(name, dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dependency, dir]);
}

const platform = `${process.platform}-${process.arch}`;
for (const [name, dir] of modules) {
  cpSync(dir, join(stage, 'node_modules', name), {
    recursive: true,
    dereference: true,
    // No nested node_modules (dependencies are flat beside it), no sources, no other platforms' binaries.
    filter: (source) => {
      const rel = source.slice(dir.length).replaceAll('\\', '/');
      if (/\/node_modules(\/|$)/.test(rel)) return false;
      const prebuild = /\/prebuilds\/([^/]+)/.exec(rel);
      return !prebuild || prebuild[1] === platform;
    },
  });
}

cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(cli, join(stage, 'cli'), { recursive: true });
cpSync(skill, join(stage, 'skill'), { recursive: true, filter: (source) => source === skill || source.endsWith('.md') });
cpSync(join(desktop, 'assets'), join(stage, 'assets'), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'cuttle',
      productName: 'Cuttle',
      version: manifest.version,
      description: manifest.description,
      type: 'module',
      main: 'dist/main/index.mjs',
      dependencies: Object.fromEntries([...modules.keys()].map((name) => [name, JSON.parse(readFileSync(join(modules.get(name), 'package.json'), 'utf8')).version])),
    },
    null,
    2,
  )}\n`,
);

const electronVersion = JSON.parse(readFileSync(createRequire(join(desktop, '..', '..', 'package.json')).resolve('electron/package.json'), 'utf8')).version;
const [out] = await packager({
  dir: stage,
  out: build,
  name: 'Cuttle',
  executableName: 'Cuttle',
  appVersion: manifest.version,
  electronVersion,
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  // the CLI and the native modules whole (with their package.json files), so Node resolves them
  asar: { unpack: '**/{*.node,*.dll}', unpackDir: `{cli,${[...modules.keys()].map((name) => `node_modules/${name}`).join(',')}}` },
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: 'Cuttle', ProductName: 'Cuttle', FileDescription: 'Cuttle' },
});
rmSync(stage, { recursive: true, force: true });
console.log(`packaged ${basename(out)}: ${out}`);
