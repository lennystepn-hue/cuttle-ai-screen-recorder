// Builds cuttle-capture (macOS: the screen through ScreenCaptureKit, without Cuttle's own windows)
// from capture.swift with the Xcode command line tools, for the oldest macOS the app runs on, when it
// is missing or older than its source or this script, and copies it into the folders given: next to
// the bundles that run the recorder. Elsewhere, or without swiftc, it does nothing: the recorder
// then captures with avfoundation, where Cuttle's HUD shows in the take.
//   node packages/recorder/native/build-macos.mjs [<folder>...]
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./macos/', import.meta.url));
const source = join(here, 'capture.swift');
const binary = join(here, 'cuttle-capture');
/**
 * The oldest macOS the helper runs on: the app's (Electron's LSMinimumSystemVersion), which is also
 * what capture.swift needs (ScreenCaptureKit's capturesAudio). Without it swiftc builds for the SDK's
 * own macOS and links what only that one has (0.1.1: 26.0, with libswift_DarwinFoundation3); built
 * for it, an API that needs a newer macOS does not compile without #available.
 */
const MACOS = '13.0';
const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos${MACOS}`;

if (process.platform !== 'darwin') process.exit(0);

// this script too: a change to how it builds (the target) builds it again
const changed = Math.max(statSync(source).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs);
const stale = !existsSync(binary) || statSync(binary).mtimeMs < changed;
if (stale) {
  const swiftc = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (swiftc.status !== 0) {
    console.warn('cuttle-capture not built: no Swift compiler (xcode-select --install). Recording works, but Cuttle\'s HUD shows in takes.');
    process.exit(0);
  }
  // through xcrun, which also finds the macOS SDK
  const built = spawnSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', target, '-o', binary, source], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (built.status !== 0) {
    console.warn('cuttle-capture could not be built. Recording works, but Cuttle\'s HUD shows in takes.');
    process.exit(0);
  }
  console.log(`built ${binary}`);
}
for (const folder of process.argv.slice(2)) {
  const dir = resolve(folder);
  mkdirSync(dir, { recursive: true });
  copyFileSync(binary, join(dir, 'cuttle-capture'));
  chmodSync(join(dir, 'cuttle-capture'), 0o755);
}
