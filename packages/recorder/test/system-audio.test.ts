import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DEVICES, type ScreenArea } from '../src/sources';
import { loopbackHelper, systemAudioMissing, systemFeeder, systemInput } from '../src/system-audio';

const monitor = { ...TEST_DEVICES.monitors[0]!, displayId: 7 };
const screen: ScreenArea = { monitor };
const window: ScreenArea = { monitor, crop: { x: 100, y: 60, width: 640, height: 360 }, window: 1001 };

afterEach(() => vi.unstubAllEnvs());

describe('systemFeeder', () => {
  it("macOS: the capture helper's sound of the display without Cuttle's processes, or of a window's app alone", () => {
    // any file that exists stands in for the helper
    vi.stubEnv('CUTTLE_CAPTURE_HELPER', process.execPath);
    expect(systemFeeder('macos', screen, [11, 12])).toEqual({
      command: process.execPath,
      args: ['audio', '--display', '7', '--exclude-pid', '11', '--exclude-pid', '12'],
      stream: true,
      stamps: true,
    });
    expect(systemFeeder('macos', window, [11])?.args).toEqual(['audio', '--display', '7', '--window', '1001']);
  });

  it('Windows: the loopback helper of the default output device', () => {
    vi.stubEnv('CUTTLE_LOOPBACK_HELPER', process.execPath);
    expect(systemFeeder('windows', window, [11])).toEqual({ command: process.execPath, args: [], stream: true, stamps: true });
  });

  it('none where the helper is missing, and says how to get it', () => {
    vi.stubEnv('CUTTLE_CAPTURE_HELPER', '/no/such/helper');
    vi.stubEnv('CUTTLE_LOOPBACK_HELPER', '/no/such/helper.exe');
    expect(systemFeeder('macos', screen, [])).toBeUndefined();
    expect(systemFeeder('windows', screen, [])).toBeUndefined();
    expect(systemFeeder('test', screen, [])).toBeUndefined();
    expect(systemAudioMissing('macos')).toContain("Xcode's command line tools");
    expect(systemAudioMissing('windows')).toContain('.NET Framework');
  });
});

describe('systemInput', () => {
  it("reads the helpers' 48 kHz stereo float samples from stdin, and the test backend's tone", () => {
    expect(systemInput('windows')).toEqual(['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0']);
    expect(systemInput('macos')).toEqual(systemInput('windows'));
    expect(systemInput('test')).toEqual(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000,arealtime']);
  });
});

// pnpm install builds the helper with .NET Framework's compiler; a machine without a sound device
// (a CI runner) has nothing to record, and the helper says so
describe.runIf(process.platform === 'win32')('cuttle-loopback (Windows)', () => {
  it('is built, and starts: its start stamp, or no output device', async () => {
    const helper = loopbackHelper();
    expect(helper).toBeDefined();
    const child = spawn(helper!, [], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let said = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (said += chunk));
    let bytes = 0;
    child.stdout.on('data', (chunk: Buffer) => (bytes += chunk.length));
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.once('close', resolve)),
      new Promise<'running'>((resolve) => setTimeout(() => resolve('running'), 1500)),
    ]);
    if (code === 'running') {
      child.kill();
      const start = /^start (\d+\.\d+)$/m.exec(said);
      expect(start).not.toBeNull();
      expect(Math.abs(Number(start![1]) - Date.now() / 1000)).toBeLessThan(5);
      // silence keeps time while nothing plays: about a second of 48 kHz stereo floats by now
      expect(bytes).toBeGreaterThan(48_000 * 8 * 0.5);
    } else {
      expect(code).toBe(2);
      expect(said).toContain('there is no sound output device to record');
    }
  }, 10_000);
});
