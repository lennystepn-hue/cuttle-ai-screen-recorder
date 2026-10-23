// Packages the built app (apps/desktop/dist, from app:build:js) as an unpacked app folder in
// apps/desktop/build/Cuttle-<platform>-<arch>/: no installer, and on Windows no signing. On macOS
// it signs when CUTTLE_SIGN_IDENTITY names an identity ("Developer ID Application: …", or "-" for
// an ad-hoc signature that runs on this Mac only), with the hardened runtime and
// entitlements.mac.plist, and notarizes when CUTTLE_NOTARIZE_PROFILE names a notarytool keychain
// profile (xcrun notarytool store-credentials) or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and
// APPLE_TEAM_ID are set; a signed app is zipped beside its folder for handing out. The native modules the
// recorder loads (koffi and uiohook-napi, with their prebuilt binaries for this platform) are
// copied next to the bundle and kept outside the asar archive. So is the app's own copy of the CLI
// (apps/cli/dist, from cli:build): the cuttle command the app installs runs it with the app as Node,
// which cannot load modules from inside the archive. The skill's files go in for the same install.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { APP_UPDATE_YML } from './releases.mjs';

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
// the update feed, beside the app's archive in its resources folder (electron-updater looks there)
const updateFeed = join(build, 'app-update.yml');
writeFileSync(updateFeed, APP_UPDATE_YML);

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

/** macOS: signing and notarizing, from the environment (see the top); nothing when it names no identity. */
function macSigning() {
  const identity = process.env.CUTTLE_SIGN_IDENTITY;
  if (process.platform !== 'darwin' || !identity) return {};
  const entitlements = join(desktop, 'scripts', 'entitlements.mac.plist');
  const osxSign = {
    identity,
    // an ad-hoc signature is not in the keychain
    ...(identity === '-' && { identityValidation: false }),
    optionsForFile: () => ({ hardenedRuntime: true, entitlements }),
  };
  const { CUTTLE_NOTARIZE_PROFILE: keychainProfile, APPLE_ID: appleId, APPLE_APP_SPECIFIC_PASSWORD: appleIdPassword, APPLE_TEAM_ID: teamId } = process.env;
  const osxNotarize = keychainProfile ? { keychainProfile } : appleId && appleIdPassword && teamId ? { appleId, appleIdPassword, teamId } : undefined;
  if (osxNotarize && identity === '-') throw new Error('an ad-hoc signature cannot be notarized: set CUTTLE_SIGN_IDENTITY to a Developer ID Application identity');
  return { osxSign, ...(osxNotarize && { osxNotarize }) };
}
const signing = macSigning();

const electron = createRequire(join(desktop, '..', '..', 'package.json')).resolve('electron/package.json');
const electronVersion = JSON.parse(readFileSync(electron, 'utf8')).version;
if (process.platform === 'darwin') {
  // the capture helper (the CLI's copy, which the app takes) runs wherever the app does: on the macOS of
  // Electron's own Info.plist. 0.1.1's was built for the release runner's macOS 26. Before packaging,
  // so a release stops before it is signed and notarized. Electron's binary is not installed with the
  // package (the packager takes a copy of its own): `require('electron')` fetches it where it is missing,
  // and says where its executable is, in Electron.app/Contents/MacOS.
  const helper = join(cli, 'cuttle-capture');
  const executable = createRequire(join(desktop, '..', '..', 'package.json'))('electron');
  const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(dirname(dirname(executable)), 'Info.plist')], { encoding: 'utf8' }).trim();
  const minos = existsSync(helper) ? execFileSync('otool', ['-l', helper], { encoding: 'utf8' }).match(/cmd LC_BUILD_VERSION[\s\S]*?minos (\S+)/)?.[1] : undefined;
  const parts = (version) => version.split('.').map(Number);
  const newer = minos !== undefined && parts(minos).reduce((order, part, i) => order || part - (parts(app)[i] ?? 0), 0) > 0;
  if (newer) throw new Error(`cuttle-capture needs macOS ${minos}, the app runs on ${app}: build it for ${app} (packages/recorder/native/build-macos.mjs)`);
}
const [out] = await packager({
  dir: stage,
  out: build,
  name: 'Cuttle',
  executableName: 'Cuttle',
  appVersion: manifest.version,
  electronVersion,
  platform: process.platform,
  arch: process.arch,
  icon: join(desktop, 'assets', process.platform === 'win32' ? 'icon.ico' : process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
  extraResource: [updateFeed],
  // the CLI and the native modules whole (with their package.json files), so Node resolves them
  asar: { unpack: '**/{*.node,*.dll,cuttle-capture,cuttle-loopback.exe}', unpackDir: `{cli,${[...modules.keys()].map((name) => `node_modules/${name}`).join(',')}}` },
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: 'Cuttle', ProductName: 'Cuttle', FileDescription: 'Cuttle' },
  // macOS asks for the screen, the camera and the microphone on behalf of the app (ffmpeg runs as its child)
  appBundleId: 'app.cuttle.desktop',
  appCategoryType: 'public.app-category.video',
  darwinDarkModeSupport: true,
  extendInfo: {
    NSCameraUsageDescription: 'Cuttle records your webcam into a take when you choose a camera.',
    NSMicrophoneUsageDescription: 'Cuttle records your microphone into a take when you choose a mic.',
    NSScreenCaptureUsageDescription: 'Cuttle records the screen, a window or a region of it.',
  },
  ...signing,
});
rmSync(stage, { recursive: true, force: true });
console.log(`packaged ${basename(out)}: ${out}${signing.osxSign ? ` (signed${signing.osxNotarize ? ' and notarized' : ''})` : ''}`);
if (signing.osxSign) {
  // the signed app as one file to hand out: ditto keeps its signature and extended attributes
  const zip = join(build, `Cuttle-${manifest.version}-mac-${process.arch}.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(out, 'Cuttle.app'), zip]);
  console.log(`zipped ${zip}`);
}
