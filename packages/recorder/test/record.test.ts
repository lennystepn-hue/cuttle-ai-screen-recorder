import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const project = () => temp('cuttle-record-');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const test = { source: { kind: 'monitor', index: 0 }, countdownSeconds: 0, backend: 'test' } as const satisfies Partial<RecordOptions>;

/** ffprobe's view of a track: codec, size, colour tags, sample rate and duration. */
function probe(file: string) {
  const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer,sample_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const { streams, format } = JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
  return { ...streams[0], duration: Number(format.duration) };
}

const read = (projectDir: string, file: string) => readFileSync(join(projectDir, file), 'utf8');

describe.concurrent('record (test backend)', () => {
  it('records a 3 s take with every track', async () => {
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const recording = record({ ...test, projectDir, webcam: 'Test Camera', mic: 'Test Microphone', stop: { maxSeconds: 3 }, onEvent: (event) => events.push(event) });
    setTimeout(() => recording.marker('one second'), 1000);
    const take = await recording.done;

    expect(take).toEqual({
      dir: 'takes/1',
      screen: 'takes/1/screen.mp4',
      webcam: 'takes/1/webcam.mp4',
      mic: 'takes/1/mic.m4a',
      events: 'takes/1/events.jsonl',
      markers: 'takes/1/markers.json',
      screenSize: { width: 1280, height: 720 },
      seconds: expect.closeTo(3.2, 0),
      stopReason: 'max-seconds',
      warnings: [],
    });
    expect(probe(join(projectDir, take.screen))).toEqual({ codec_name: 'h264', width: 1280, height: 720, color_transfer: 'bt709', duration: expect.closeTo(take.seconds, 1) });
    expect(probe(join(projectDir, take.webcam!))).toMatchObject({ codec_name: 'h264', width: 640, height: 480, color_transfer: 'bt709' });
    expect(probe(join(projectDir, take.mic!))).toMatchObject({ codec_name: 'aac', sample_rate: '48000', duration: expect.closeTo(3, 0) });

    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    expect(Math.abs(trackOffset(takeFile.take, 'webcam')!)).toBeLessThan(0.2);
    expect(Math.abs(trackOffset(takeFile.take, 'mic')!)).toBeLessThan(0.2);

    const { events: input, issues } = parseEventsJsonl(read(projectDir, take.events));
    expect(issues).toEqual([]);
    expect(input.slice(0, 2)).toEqual([expect.objectContaining({ t: 0, type: 'move' }), { t: 0, type: 'shape', shape: 'arrow' }]);
    expect(new Set(input.map((event) => event.type))).toEqual(new Set(['move', 'shape', 'click', 'scroll', 'keys']));

    const markers = parseMarkersJson(read(projectDir, take.markers));
    expect(markers).toEqual({ ok: true, markers: [{ t: expect.closeTo(1, 0), kind: 'manual', label: 'one second' }] });
    expect(events.map((event) => event.type)).toEqual(['recording', 'marker', 'stopping']);
  });

  it('stops once untilFile exists', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'done.flag');
    setTimeout(() => writeFileSync(flag, ''), 1500);
    const take = await record({ ...test, projectDir, stop: { untilFile: flag, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('file');
    expect(take.seconds).toBeGreaterThan(1.2);
    expect(take.seconds).toBeLessThan(3);
  });

  it('stops shortly after the Claude session in that folder finishes its turn, with markers from its transcript', async () => {
    const projectDir = project();
    const config = temp('cuttle-claude-');
    const cwd = join(config, 'demo app');
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      const dir = claudeTranscriptDir(cwd);
      mkdirSync(dir, { recursive: true });
      const write = (session: string, value: object) => appendFileSync(join(dir, `${session}.jsonl`), `${JSON.stringify({ timestamp: new Date().toISOString(), ...value })}\n`);
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 20 } });
      await sleep(600);
      write('other', { type: 'assistant', message: { id: 'o1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      await sleep(400);
      write('demo', { type: 'user', message: { content: 'build it' } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
      write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
      await sleep(300);
      write('demo', { type: 'assistant', isSidechain: true, message: { id: 's1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a2', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      const markers = parseMarkersJson(read(projectDir, take.markers));
      if (!markers.ok) throw new Error(JSON.stringify(markers.issues));
      expect(markers.markers.map(({ kind, label }) => (label ? `${kind}:${label}` : kind))).toEqual(['prompt', 'tool:Bash', 'answer']);
      const answer = markers.markers[2]!.t;
      expect(take.seconds).toBeGreaterThan(answer + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(answer + CLAUDE_TAIL_SECONDS + 1);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });

  it('stops once the screen stood still for untilIdleSeconds after it changed', async () => {
    // The still test monitor moves for 1 s, then stands still.
    const take = await record({ ...test, projectDir: project(), source: { kind: 'monitor', index: 1 }, stop: { untilIdleSeconds: 1, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('idle');
    expect(take.seconds).toBeGreaterThan(1.8);
    expect(take.seconds).toBeLessThan(3);
    expect(take.screenSize).toEqual({ width: 640, height: 360 });
  });

  it('does not count a screen that has not changed yet as idle', async () => {
    // This strip at the top of the test pattern stays the same for the first 3 s.
    const take = await record({ ...test, projectDir: project(), source: { kind: 'region', rect: [540, 0, 200, 40], monitor: 0 }, stop: { untilIdleSeconds: 0.5, maxSeconds: 2 } }).done;
    expect(take.stopReason).toBe('max-seconds');
  });

  it('stops when asked and warns about a silent microphone', async () => {
    const projectDir = project();
    const warnings: string[] = [];
    const recording = record({ ...test, projectDir, mic: 'Silent Test Microphone', stop: {}, onEvent: (event) => event.type === 'warning' && warnings.push(event.message) });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
  });

  it('cancels without a take folder when stopped during the countdown', async () => {
    const projectDir = project();
    const countdown: number[] = [];
    const recording = record({ ...test, projectDir, countdownSeconds: 3, stop: {}, onEvent: (event) => event.type === 'countdown' && countdown.push(event.seconds) });
    setTimeout(() => void recording.stop().catch(() => {}), 500);
    await expect(recording.done).rejects.toMatchObject({ name: 'RecorderError', code: 'cancelled' });
    expect(countdown).toEqual([3]);
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  });

  it('fails when a track breaks off, and lets the other tracks finish their files', async () => {
    const projectDir = project();
    await expect(record({ ...test, projectDir, webcam: 'Failing Test Camera', stop: { maxSeconds: 20 } }).done).rejects.toMatchObject({
      code: 'capture',
      message: expect.stringContaining('the webcam capture stopped unexpectedly'),
    });
    expect(probe(join(projectDir, 'takes/1/screen.mp4')).duration).toBeGreaterThan(0.8);
  });

  it('captures a region and a window, with input relative to them, in numbered takes', async () => {
    const projectDir = project();
    const region = await record({ ...test, projectDir, source: { kind: 'region', rect: [100, 50, 401, 301], monitor: 0 }, stop: { maxSeconds: 1 } }).done;
    const window = await record({ ...test, projectDir, source: { kind: 'window', title: 'test window' }, stop: { maxSeconds: 1 } }).done;
    expect([region.dir, region.screenSize]).toEqual(['takes/1', { width: 400, height: 300 }]);
    expect([window.dir, window.screenSize]).toEqual(['takes/2', { width: 640, height: 360 }]);
    expect(probe(join(projectDir, window.screen))).toMatchObject({ width: 640, height: 360 });
    // The synthetic pointer circles (640, 360) on the desktop with a radius of 200; the window starts at (100, 60).
    const first = parseEventsJsonl(read(projectDir, window.events)).events[0]!;
    if (first.type !== 'move') throw new Error('expected a move');
    expect(Math.hypot(first.x + 100 - 640, first.y + 60 - 360)).toBeCloseTo(200, -1);
  });

  it('refuses options it cannot record with, before creating a take folder', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'exists.flag');
    writeFileSync(flag, '');
    const cases: [Partial<RecordOptions>, string][] = [
      [{ projectDir: join(projectDir, 'missing') }, 'invalid-options'],
      [{ stop: { maxSeconds: 0 } }, 'invalid-options'],
      [{ stop: { untilFile: flag } }, 'invalid-options'],
      [{ countdownSeconds: -1 }, 'invalid-options'],
      [{ mic: 'No Such Microphone' }, 'device-not-found'],
      [{ source: { kind: 'monitor', index: 7 } }, 'device-not-found'],
    ];
    for (const [options, code] of cases) {
      await expect(record({ ...test, projectDir, stop: {}, ...options }).done).rejects.toMatchObject({ code });
    }
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  });
});
