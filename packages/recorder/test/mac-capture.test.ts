import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { captureHelper, captureHelperFor, helperArgs, helperInput } from '../src/mac-capture';
import { screenLatency } from '../src/sources';

/** The oldest macOS a Mach-O file runs on (its LC_BUILD_VERSION's minos), as "13.0". */
const minosOf = (file: string) => execFileSync('otool', ['-l', file], { encoding: 'utf8' }).match(/cmd LC_BUILD_VERSION[\s\S]*?minos (\S+)/)?.[1];
/** Below 0 when macOS `a` is older than `b`, 0 when they are the same. */
const compareVersions = (a: string, b: string) => {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) - (y![i] ?? 0);
  return 0;
};

const monitor = { index: 0, name: 'Built-in Display', bounds: { x: 0, y: 0, width: 2880, height: 1800 }, scale: 2, primary: true, displayId: 1 };

describe('the macOS capture helper', () => {
  it('captures the display by its id, cropped in its pixels, leaving out the given processes', () => {
    expect(helperArgs({ monitor }, false, [])).toEqual(['--display', '1', '--fps', '30']);
    expect(helperArgs({ monitor, crop: { x: 200, y: 240, width: 1400, height: 440 } }, true, [4242, 77])).toEqual([
      '--display', '1', '--fps', '30', '--crop', '200,240,1400,440', '--cursor', '--exclude-pid', '4242', '--exclude-pid', '77',
    ]);
  });

  it('feeds ffmpeg raw BGRA of the area on descriptor 3, not as a pipe (which would turn off its "q")', () => {
    expect(helperInput({ monitor })).toEqual(['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '2880x1800', '-framerate', '1000000', '-i', '/dev/fd/3']);
    expect(helperInput({ monitor, crop: { x: 2, y: 4, width: 640, height: 360 } })).toContain('640x360');
  });

  it('moves the screen start back by the measured capture latency on macOS only', () => {
    expect(screenLatency('macos', true)).toBe(0.037);
    expect(screenLatency('macos', false)).toBe(0.08);
    expect(screenLatency('windows', false)).toBe(0);
    expect(screenLatency('test', false)).toBe(0);
  });

  it.runIf(process.platform === 'darwin')('is built for the oldest macOS the app runs on, not for the SDK of the Mac that builds it', () => {
    const helper = captureHelper('');
    expect(helper, 'cuttle-capture is built (pnpm install)').toBeDefined();
    // the app's minimum is Electron's own (package.mjs takes its Info.plist as it is); `require('electron')`
    // fetches the binary where it is missing, as package.mjs does, and says where its executable is
    const executable = createRequire(join(import.meta.dirname, '..', '..', '..', 'package.json'))('electron') as string;
    const app = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', join(dirname(dirname(executable)), 'Info.plist')], { encoding: 'utf8' }).trim();
    const minos = minosOf(helper!);
    expect(minos).toBeDefined();
    expect(compareVersions(minos!, app), `cuttle-capture needs macOS ${minos}, the app runs on ${app}`).toBeLessThanOrEqual(0);
  });

  it('runs the system audio and a screenshot from copies of their own, beside the take\'s screen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-helper-'));
    try {
      const helper = join(dir, 'cuttle-capture');
      writeFileSync(helper, '');
      // without the copies (a helper of one's own, CUTTLE_CAPTURE_HELPER): the helper itself
      expect(captureHelperFor('audio', helper)).toBe(helper);
      writeFileSync(join(dir, 'cuttle-capture-audio'), '');
      writeFileSync(join(dir, 'cuttle-capture-shot'), '');
      expect(captureHelperFor('audio', helper)).toBe(join(dir, 'cuttle-capture-audio'));
      expect(captureHelperFor('shot', helper)).toBe(join(dir, 'cuttle-capture-shot'));
      // no helper at all (one of one's own that is not there): none for the sound either
      vi.stubEnv('CUTTLE_CAPTURE_HELPER', join(dir, 'missing'));
      expect(captureHelperFor('audio')).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'darwin')('is built with its copies, the same program under other names (macOS keeps one stream per path)', () => {
    const helper = captureHelper('');
    expect(helper, 'cuttle-capture is built (pnpm install)').toBeDefined();
    for (const role of ['audio', 'shot'] as const) {
      const copy = captureHelperFor(role, helper);
      expect(copy).toBe(`${helper}-${role}`);
      expect(readFileSync(copy!).equals(readFileSync(helper!)), `${copy} is the helper as built`).toBe(true);
    }
  });

  it('takes a window by itself, at its size', () => {
    expect(helperArgs({ monitor, crop: { x: 200, y: 240, width: 1400, height: 440 }, window: 7610 }, false, [4242])).toEqual([
      '--display', '1', '--window', '7610', '--size', '1400,440', '--fps', '30',
    ]);
  });
});
