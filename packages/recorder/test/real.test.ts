import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseEventsJsonl, parseTakeJson } from '@cuttle/project';
import { listDevices, record } from '../src/index';

/**
 * A real capture of the primary monitor (and the first microphone), then of a region of it. Runs only
 * with `pnpm recorder:real` (vitest --mode real); reads nothing but metadata and deletes the take.
 */
it.runIf(process.env.MODE === 'real')('records the primary monitor and a region of it', async () => {
  const devices = await listDevices();
  const monitor = devices.monitors.find((candidate) => candidate.primary) ?? devices.monitors[0];
  if (!monitor) throw new Error('no monitor found');
  const mic = devices.mics[0];
  const projectDir = mkdtempSync(join(tmpdir(), 'cuttle-real-'));
  const probe = (file: string) =>
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer:format=duration', '-of', 'json', join(projectDir, file)], { encoding: 'utf8' }).stdout;
  try {
    const take = await record({ projectDir, source: { kind: 'monitor', index: monitor.index }, ...(mic && { mic }), stop: { maxSeconds: 3 }, countdownSeconds: 0 }).done;
    console.log(`monitor ${monitor.index} ${monitor.bounds.width}×${monitor.bounds.height}, mic ${mic ?? 'none'}: ${take.seconds} s, warnings ${JSON.stringify(take.warnings)}`);
    expect(take.screenSize).toEqual({ width: monitor.bounds.width, height: monitor.bounds.height });
    expect(JSON.parse(probe(take.screen))).toMatchObject({ streams: [{ codec_name: 'h264', width: monitor.bounds.width, color_transfer: 'bt709' }] });
    if (take.mic) expect(JSON.parse(probe(take.mic))).toMatchObject({ streams: [{ codec_name: 'aac' }] });
    expect(parseTakeJson(readFileSync(join(projectDir, take.dir, 'take.json'), 'utf8')).ok).toBe(true);
    const events = parseEventsJsonl(readFileSync(join(projectDir, take.events), 'utf8'));
    expect(events.issues).toEqual([]);
    expect(events.events.slice(0, 2).map((event) => [event.t, event.type])).toEqual([[0, 'move'], [0, 'shape']]);

    const region = await record({ projectDir, source: { kind: 'region', rect: [100, 100, 640, 360], monitor: monitor.index }, stop: { maxSeconds: 1 }, countdownSeconds: 0 }).done;
    expect(JSON.parse(probe(region.screen))).toMatchObject({ streams: [{ width: 640, height: 360 }] });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);
