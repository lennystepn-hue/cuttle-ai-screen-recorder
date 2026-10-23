import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchOf, openArgument } from '../src/main/launch';

describe('a launch', () => {
  const cwd = resolve('/work');

  it("opens the folder after --open, past the switches Chromium moves in front of a second launch's folder", () => {
    expect(openArgument(['Cuttle.exe', '--open', 'demo'], cwd)).toBe(resolve(cwd, 'demo'));
    // a second launch's argv as the running app gets it (macOS, Electron 44)
    expect(openArgument(['Cuttle', '--open', '--allow-file-access-from-files', '--enable-avfoundation', resolve('/Users/ada/demo')], cwd)).toBe(resolve('/Users/ada/demo'));
    expect(openArgument(['Cuttle', `--open=${resolve('/Users/ada/my demo')}`], cwd)).toBe(resolve('/Users/ada/my demo'));
    expect(openArgument(['Cuttle', '--open'], cwd)).toBeUndefined();
    expect(openArgument(['Cuttle', '--open='], cwd)).toBeUndefined();
    expect(openArgument(['Cuttle', '--settings'], cwd)).toBeUndefined();
  });

  it('asks for a project, the settings, or neither', () => {
    expect(launchOf(['Cuttle', '--open', 'demo'], cwd)).toEqual({ open: resolve(cwd, 'demo'), settings: false });
    expect(launchOf(['Cuttle', '--settings'], cwd)).toEqual({ open: undefined, settings: true });
  });
});
