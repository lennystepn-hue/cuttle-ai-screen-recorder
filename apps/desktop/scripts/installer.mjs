// Makes the installers and the update files from the packaged app (package.mjs's
// build/Cuttle-<platform>-<arch>) with electron-builder, into build/installers:
// - Windows: an NSIS installer, one click, for this user only (into %LOCALAPPDATA%\Programs\Cuttle,
//   where package.mjs's app has always gone), with Start menu and desktop shortcuts. Not signed.
// - macOS: a DMG and the zip the updates use, the app inside as package.mjs signed and notarized it.
// Beside them latest.yml (latest-mac.yml), which the app's updates read (electron-updater). With
// --publish they go to this version's GitHub release, a draft until someone publishes it (GH_TOKEN).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arch, Platform, build } from 'electron-builder';
import { RELEASES } from './releases.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(createRequire(join(desktop, '..', '..', 'package.json')).resolve('electron/package.json'), 'utf8')).version;
const mac = process.platform === 'darwin';
const packaged = join(desktop, 'build', `Cuttle-${process.platform}-${process.arch}`);
const publish = process.argv.includes('--publish');

const files = await build({
  projectDir: desktop,
  targets: mac ? Platform.MAC.createTarget(['dmg', 'zip'], Arch[process.arch]) : Platform.WINDOWS.createTarget(['nsis'], Arch[process.arch]),
  prepackaged: mac ? join(packaged, 'Cuttle.app') : packaged,
  publish: publish ? 'always' : 'never',
  config: {
    appId: 'app.cuttle.desktop',
    productName: 'Cuttle',
    executableName: 'Cuttle',
    copyright: 'Copyright © 2026 Lenny Enderle',
    electronVersion,
    // the name it installs under (%LOCALAPPDATA%\Programs\cuttle) and keeps its updates under (cuttle-updater)
    extraMetadata: { name: 'cuttle' },
    npmRebuild: false,
    directories: { output: join(desktop, 'build', 'installers') },
    artifactName: `Cuttle-\${version}-\${os}-\${arch}.\${ext}`,
    win: { icon: join(desktop, 'assets', 'icon.ico') },
    nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, shortcutName: 'Cuttle' },
    // package.mjs signed (and notarized) the app already
    mac: { identity: null, icon: join(desktop, 'assets', 'icon.icns'), category: 'public.app-category.video' },
    publish: [{ provider: 'github', ...RELEASES, releaseType: 'draft' }],
  },
});
console.log(`made Cuttle ${manifest.version}:\n${files.map((file) => `  ${file}`).join('\n')}`);
