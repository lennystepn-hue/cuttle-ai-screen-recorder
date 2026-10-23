import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findApp, installedPaths, launchOf } from '../src/commands/open';
import { runCommand } from '../src/mcp';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('cuttle open: which app', () => {
  const found = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, present: string[]) =>
    findApp({ platform, env, home: platform === 'win32' ? 'C:\\Users\\ada' : '/Users/ada', cliDir: '/src/cuttle/apps/cli/dist', exists: (path) => present.includes(path) });

  it('installs where Windows and macOS put it', () => {
    expect(installedPaths('win32', { LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' }, 'C:\\Users\\ada')).toEqual(['C:\\Users\\ada\\AppData\\Local\\Programs\\cuttle\\Cuttle.exe']);
    expect(installedPaths('darwin', {}, '/Users/ada')).toEqual(['/Applications/Cuttle.app', '/Users/ada/Applications/Cuttle.app']);
    expect(installedPaths('linux', {}, '/home/ada')).toEqual([]);
  });

  it('takes CUTTLE_APP, then the app whose shim runs the CLI, then the installed app, then the repository build', () => {
    const exe = 'C:\\Users\\ada\\AppData\\Local\\Programs\\cuttle\\Cuttle.exe';
    expect(found('win32', { LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' }, [exe])).toEqual({ kind: 'exe', path: exe });
    expect(found('darwin', {}, ['/Users/ada/Applications/Cuttle.app'])).toEqual({ kind: 'bundle', path: '/Users/ada/Applications/Cuttle.app' });
    // the packaged app's own shim names its executable, inside the bundle on macOS
    expect(found('darwin', { CUTTLE_ELECTRON: '/Volumes/Apps/Cuttle.app/Contents/MacOS/Cuttle' }, ['/Applications/Cuttle.app'])).toEqual({ kind: 'bundle', path: '/Volumes/Apps/Cuttle.app' });
    expect(found('darwin', { CUTTLE_APP: '/Users/ada/Builds/Cuttle.app', CUTTLE_ELECTRON: '/Applications/Cuttle.app/Contents/MacOS/Cuttle' }, [])).toEqual({ kind: 'bundle', path: '/Users/ada/Builds/Cuttle.app' });
    // a build's main script, run with the repository's Electron
    expect(found('win32', { CUTTLE_APP: 'D:\\cuttle\\apps\\desktop\\dist\\main\\index.mjs' }, [])).toEqual({ kind: 'repository', main: 'D:\\cuttle\\apps\\desktop\\dist\\main\\index.mjs' });
    // a CLI built in this repository, nothing installed
    const main = join('/src/cuttle/apps/cli/dist', '..', '..', 'desktop', 'dist', 'main', 'index.mjs');
    expect(found('darwin', {}, [main])).toEqual({ kind: 'repository', main });
    expect(found('darwin', {}, [])).toBeUndefined();
  });

  it('starts a bundle through Launch Services, a second time when it runs, and an executable with the folder', () => {
    expect(launchOf({ kind: 'bundle', path: '/Applications/Cuttle.app' }, '/Users/ada/demo')).toEqual({ command: 'open', args: ['-n', '-a', '/Applications/Cuttle.app', '--args', '--open', '/Users/ada/demo'] });
    expect(launchOf({ kind: 'exe', path: 'C:\\Cuttle.exe' }, 'C:\\demo')).toEqual({ command: 'C:\\Cuttle.exe', args: ['--open', 'C:\\demo'] });
    expect(launchOf({ kind: 'repository', main: '/src/main.mjs' }, '/demo', '/electron')).toEqual({ command: '/electron', args: ['/src/main.mjs', '--open', '/demo'] });
  });
});

describe('cuttle open', () => {
  const before = process.env.CUTTLE_APP;
  afterEach(() => {
    if (before === undefined) delete process.env.CUTTLE_APP;
    else process.env.CUTTLE_APP = before;
  });

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('says what is wrong: no project there, an app that is not', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cuttle-open-'));
    dirs.push(parent);
    const project = join(parent, 'demo');
    expect((await runCommand(['-C', project, 'open'])).code).not.toBe(0);
    expect((await runCommand(['init', project])).code).toBe(0);
    process.env.CUTTLE_APP = join(parent, process.platform === 'darwin' ? 'Missing.app' : 'Missing.exe');
    const missing = await runCommand(['-C', project, 'open']);
    expect(missing.code).toBe(2);
    expect(missing.result).toMatchObject({ error: { code: 'app-missing' } });
  });

  it.runIf(process.platform === 'linux')('refuses on Linux, where there is no app', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'cuttle-open-'));
    dirs.push(parent);
    expect((await runCommand(['init', join(parent, 'demo')])).code).toBe(0);
    expect((await runCommand(['-C', join(parent, 'demo'), 'open'])).result).toMatchObject({ error: { code: 'unsupported-platform' } });
  });
});
