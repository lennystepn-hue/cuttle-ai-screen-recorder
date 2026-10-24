import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseEventsJsonl, parseTakeJson } from '@cuttle/project';
import { listDevices, record, takeShot } from '../src/index';

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

/**
 * Screenshots of the primary monitor, a region of it and the first window: each at its pixels, the
 * display's scale in its resolution. Reads only the PNGs' sizes and deletes them.
 */
it.runIf(process.env.MODE === 'real')('takes screenshots of the primary monitor, a region of it and a window', async () => {
  const devices = await listDevices({ media: false });
  const monitor = devices.monitors.find((candidate) => candidate.primary) ?? devices.monitors[0];
  if (!monitor) throw new Error('no monitor found');
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-real-shot-'));
  const size = (file: string) => {
    const bytes = readFileSync(file);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  };
  try {
    const whole = await takeShot({ source: { kind: 'monitor', index: monitor.index }, out: join(dir, 'monitor.png'), devices });
    expect(size(whole.file)).toEqual([monitor.bounds.width, monitor.bounds.height]);
    expect(whole.scale).toBe(monitor.scale);
    const region = await takeShot({ source: { kind: 'region', monitor: monitor.index, rect: [100, 100, 641, 361] }, out: join(dir, 'region.png'), devices });
    expect(size(region.file)).toEqual([641, 361]);
    const window = devices.windows[0];
    if (window) {
      const shot = await takeShot({ source: { kind: 'window', id: window.id }, out: join(dir, 'window.png'), devices });
      console.log(`window "${window.title}" ${window.bounds.width}×${window.bounds.height}: ${shot.width}×${shot.height}, warnings ${JSON.stringify(shot.warnings)}`);
      const [width, height] = size(shot.file);
      expect(Math.abs(width! - window.bounds.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(height! - window.bounds.height)).toBeLessThanOrEqual(2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

/**
 * A window take of a window that lies under the taskbar (fixtures/hidden-window.cjs, which no one
 * sees): the take shows the window's own colours, not the taskbar over it, and ends when the window
 * is closed. Windows with ffmpeg 8 or newer; reads one averaged pixel and deletes the takes.
 */
it.runIf(process.env.MODE === 'real' && process.platform === 'win32')('records a window by itself though the taskbar lies over it, and ends when it is closed', async () => {
  const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures', 'hidden-window.cjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: string[] = [];
  const line = () =>
    new Promise<string>((resolve, reject) => {
      if (lines.length > 0) return resolve(lines.shift()!);
      child.stdout.once('data', (chunk: Buffer) => {
        lines.push(...String(chunk).trim().split('\n'));
        resolve(lines.shift()!);
      });
      child.once('exit', (code) => reject(new Error(`the window's process ended (${code})`)));
    });
  const projectDir = mkdtempSync(join(tmpdir(), 'cuttle-real-window-'));
  try {
    const { id, bounds } = JSON.parse(await line()) as { id: number; bounds: { width: number; height: number } };
    expect((await listDevices({ media: false })).windows.map((window) => window.id)).toContain(id);
    const take = await record({ projectDir, source: { kind: 'window', id }, stop: { maxSeconds: 2 }, countdownSeconds: 0 }).done;
    console.log(`window ${id} ${bounds.width}×${bounds.height}: ${take.seconds} s, warnings ${JSON.stringify(take.warnings)}`);
    expect(take.warnings).toEqual([]);
    expect(take.screenSize).toEqual({ width: bounds.width - (bounds.width % 2), height: bounds.height - (bounds.height % 2) });
    // one second in, the whole picture averaged: one of the window's colours, not the dark taskbar
    const pixel = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', join(projectDir, take.screen), '-frames:v', '1', '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
    const rgb = [...pixel.subarray(0, 3)];
    console.log(`its colour at 1 s: ${rgb.join(', ')}`);
    expect(Math.max(...rgb)).toBeGreaterThan(150);
    expect(rgb.filter((channel) => channel < 90).length).toBe(2);
    // a frame every 1/30 s, though the window sends one only when it changes (10 times a second)
    const frames = Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' }).stdout);
    console.log(`${frames} frames in ${take.seconds} s`);
    expect(frames / take.seconds).toBeGreaterThan(27);

    const closing = record({
      projectDir,
      source: { kind: 'window', id },
      stop: { maxSeconds: 20 },
      countdownSeconds: 0,
      onEvent: (event) => {
        if (event.type === 'recording') setTimeout(() => child.stdin.write('close\n'), 1000);
      },
    }).done;
    const closed = await closing;
    expect(closed.stopReason).toBe('window');
    expect(closed.seconds).toBeLessThan(5);
  } finally {
    child.stdin.end();
    rmSync(projectDir, { recursive: true, force: true });
  }
}, 60_000);
