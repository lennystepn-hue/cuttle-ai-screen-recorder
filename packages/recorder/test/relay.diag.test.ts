// A diagnostic for the relay test that hung on GitHub's Windows runner (not to be merged): the
// relay scenario again and again, each step timed; a step that takes over 8 s prints the take
// ffmpeg's last log lines and the processes' state, and the run goes on.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { ffmpegPath, spawnCapture, type Feeder } from '../src/ffmpeg';
import { relayInput } from '../src/window-capture';

process.env.CUTTLE_RELAY_DEBUG = '1';
const size = { width: 64, height: 36 };
const feeder = (rate: number): Feeder => ({
  command: ffmpegPath(),
  args: ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=64x36:r=${rate},realtime,format=bgra`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'],
  frameBytes: size.width * size.height * 4,
});
const out = (file: string) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', file];
const within = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise.then(() => 'done' as const), new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), ms))]);

describe.runIf(process.platform === 'win32')('the relay, again and again', () => {
  it('starts and stops every time', async () => {
    for (let k = 0; k < 40; k++) {
      const file = join(mkdtempSync(join(tmpdir(), 'cuttle-diag-')), 'out.mp4');
      const t0 = performance.now();
      const lines: string[] = [];
      const capture = spawnCapture('screen', ['-use_wallclock_as_timestamps', '1', ...relayInput(size), ...out(file)], feeder(2));
      capture.onLine((line) => lines.push(`${(performance.now() - t0).toFixed(0)} ms: ${line}`));
      const lap = (what: string) => console.error(`run ${k}: ${what} at ${(performance.now() - t0).toFixed(0)} ms`);
      const stuck = (what: string) => console.error(`run ${k}: STUCK ${what}; ffmpeg pid ${capture.pid}, feeder pid ${capture.feederPid}\n${lines.slice(-25).join('\n')}`);
      if ((await within(capture.started, 8000)) === 'late') {
        stuck('waiting for started');
        await within(capture.started, 20_000);
      }
      lap('started');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const stopping = capture.stop();
      if ((await within(stopping, 8000)) === 'late') {
        stuck('waiting for stop');
        await within(stopping, 20_000);
      }
      lap('stopped');
    }
  }, 900_000);
});
