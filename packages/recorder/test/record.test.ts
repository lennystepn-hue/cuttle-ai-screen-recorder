import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseTakeJson, trackOffset } from '@cuttle/project';
import { CLAUDE_TAIL_SECONDS, claudeTranscriptDir, record, type RecordOptions, type RecorderEvent } from '../src/index';
import { inDeadZone } from '../src/record';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const project = () => temp('cuttle-record-');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Each test records in real time, and several run at once. */
const SLOW = 20_000;
const test = { source: { kind: 'monitor', index: 0 }, countdownSeconds: 0, backend: 'test' } as const satisfies Partial<RecordOptions>;

/** ffprobe's view of a track: codec, size, colour tags, sample rate and duration. */
function probe(file: string) {
  const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,color_transfer,sample_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const { streams, format } = JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
  return { ...streams[0], duration: Number(format.duration) };
}

const read = (projectDir: string, file: string) => readFileSync(join(projectDir, file), 'utf8');

function markersOf(projectDir: string, file: string) {
  const markers = parseMarkersJson(read(projectDir, file));
  if (!markers.ok) throw new Error(JSON.stringify(markers.issues));
  return markers.markers;
}

describe.concurrent('record (test backend)', () => {
  it('records a 3 s take with every track', async () => {
    const projectDir = project();
    const events: RecorderEvent[] = [];
    let markedAt = 0;
    const recording = record({
      ...test,
      projectDir,
      webcam: 'Test Camera',
      mic: 'Test Microphone',
      stop: { maxSeconds: 3 },
      onEvent: (event) => {
        events.push(event);
        // From the recording event on, the screen has started: a marker before it would be dropped.
        if (event.type === 'recording') {
          setTimeout(() => {
            markedAt = Date.now() / 1000;
            recording.marker('one second');
          }, 1000);
        }
      },
    });
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

    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' }]);
    expect(events.map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'stopping']);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
  }, SLOW);

  it('stops once untilFile exists', async () => {
    const projectDir = project();
    const flag = join(projectDir, 'done.flag');
    setTimeout(() => writeFileSync(flag, ''), 1500);
    const take = await record({ ...test, projectDir, stop: { untilFile: flag, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('file');
    expect(take.seconds).toBeGreaterThan(1);
    expect(take.seconds).toBeLessThan(3);
  }, SLOW);

  it('stops once the screen stood still and the input rested for untilIdleSeconds', async () => {
    // The still test monitor moves for 1 s, then stands still; the synthetic input rests from 1.5 s.
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'monitor', index: 1 }, stop: { untilIdleSeconds: 1, maxSeconds: 20 } }).done;
    expect(take.stopReason).toBe('idle');
    // At least 1 s of movement and 1 s of rest. The input is timed from record(), the screen from its
    // first frame: on a loaded machine the screen starts later, so the rest begins earlier in its
    // seconds. events.jsonl holds the input in screen seconds: the take ends a second after the last.
    expect(take.seconds).toBeGreaterThan(1.95);
    expect(take.seconds).toBeLessThan(5);
    const lastInput = Math.max(...parseEventsJsonl(read(projectDir, take.events)).events.filter((event) => event.type !== 'shape').map((event) => event.t));
    expect(take.seconds).toBeGreaterThan(lastInput + 1 - 0.05);
    expect(take.screenSize).toEqual({ width: 640, height: 360 });
  }, SLOW);

  it('does not count a screen that has not changed yet as idle', async () => {
    // This strip at the top of the test pattern stays the same for the first 3 s.
    const take = await record({ ...test, projectDir: project(), source: { kind: 'region', rect: [540, 0, 200, 40], monitor: 0 }, stop: { untilIdleSeconds: 0.5, maxSeconds: 2 } }).done;
    expect(take.stopReason).toBe('max-seconds');
  }, SLOW);

  it('stops when asked and warns about a silent microphone', async () => {
    const projectDir = project();
    const warnings: string[] = [];
    const recording = record({ ...test, projectDir, mic: 'Silent Test Microphone', stop: {}, onEvent: (event) => event.type === 'warning' && warnings.push(event.message) });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
  }, SLOW);

  it('turns a throwing onEvent into a warning instead of a failed take', async () => {
    const recording = record({
      ...test,
      projectDir: project(),
      stop: { maxSeconds: 1.5 },
      onEvent: (event) => {
        if (event.type === 'recording') setTimeout(() => recording.marker(), 300);
        if (event.type === 'marker') throw new Error('listener bug');
      },
    });
    const take = await recording.done;
    expect(take.stopReason).toBe('max-seconds');
    expect(take.warnings).toEqual(['onEvent failed on "marker": listener bug']);
  }, SLOW);

  it('cancels without a take folder when stopped during the countdown', async () => {
    const projectDir = project();
    const countdown: number[] = [];
    const recording = record({ ...test, projectDir, countdownSeconds: 3, stop: {}, onEvent: (event) => event.type === 'countdown' && countdown.push(event.seconds) });
    setTimeout(() => void recording.stop().catch(() => {}), 500);
    await expect(recording.done).rejects.toMatchObject({ name: 'RecorderError', code: 'cancelled' });
    expect(countdown).toEqual([3]);
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  }, SLOW);

  it('cancels without a take folder when stopped before anything started', async () => {
    const projectDir = project();
    const recording = record({ ...test, projectDir, stop: {} });
    await expect(recording.stop()).rejects.toMatchObject({ code: 'cancelled' });
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  }, SLOW);

  it('fails when a track breaks off, and lets the other tracks finish their files', async () => {
    const projectDir = project();
    await expect(record({ ...test, projectDir, webcam: 'Failing Test Camera', stop: { maxSeconds: 20 } }).done).rejects.toMatchObject({
      code: 'capture',
      message: expect.stringMatching(/the webcam capture stopped unexpectedly[\s\S]*\(what was recorded is in takes\/1\)$/),
    });
    expect(probe(join(projectDir, 'takes/1/screen.mp4')).duration).toBeGreaterThan(0.8);
  }, SLOW);

  it("logs no pointer input inside a dead zone (the app's HUD), but keys", async () => {
    const projectDir = project();
    // The synthetic pointer circles (640, 360) with a radius of 200: the zone takes its upper half.
    const take = await record({ ...test, projectDir, stop: { maxSeconds: 2 }, deadZones: [{ x: 0, y: 0, width: 1280, height: 360 }] }).done;
    const { events } = parseEventsJsonl(read(projectDir, take.events));
    const pointer = events.slice(2).filter((event) => event.type === 'move' || event.type === 'click' || event.type === 'scroll');
    expect(pointer.length).toBeGreaterThan(10);
    expect(pointer.every((event) => 'y' in event && event.y >= 360)).toBe(true);
    expect(events.some((event) => event.type === 'keys')).toBe(true);
  }, SLOW);

  it('captures a region and a window, with input relative to them, in numbered takes', async () => {
    const projectDir = project();
    const region = await record({ ...test, projectDir, source: { kind: 'region', rect: [100, 50, 401, 301], monitor: 0 }, stop: { maxSeconds: 1 } }).done;
    const window = await record({ ...test, projectDir, source: { kind: 'window', id: 1001 }, stop: { maxSeconds: 1 } }).done;
    expect([region.dir, region.screenSize]).toEqual(['takes/1', { width: 400, height: 300 }]);
    expect([window.dir, window.screenSize]).toEqual(['takes/2', { width: 640, height: 360 }]);
    expect(probe(join(projectDir, window.screen))).toMatchObject({ width: 640, height: 360 });
    // The synthetic pointer circles (640, 360) on the desktop with a radius of 200; the window starts at (100, 60).
    const first = parseEventsJsonl(read(projectDir, window.events)).events[0]!;
    if (first.type !== 'move') throw new Error('expected a move');
    expect(Math.hypot(first.x + 100 - 640, first.y + 60 - 360)).toBeCloseTo(200, -1);
  }, SLOW);

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
  }, SLOW);
});

// Not concurrent: these set CLAUDE_CONFIG_DIR, which the watcher reads when the recording starts.
describe('record until a Claude Code turn ends (test backend)', () => {
  function transcripts() {
    const config = temp('cuttle-claude-');
    const cwd = join(config, 'demo app');
    const dir = claudeTranscriptDir(cwd, config);
    mkdirSync(dir, { recursive: true });
    const write = (session: string, value: object) => appendFileSync(join(dir, `${session}.jsonl`), `${JSON.stringify({ timestamp: new Date().toISOString(), ...value })}\n`);
    return { config, cwd, write };
  }

  async function withConfig<T>(config: string, body: () => Promise<T>): Promise<T> {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      return await body();
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  }

  it('stops shortly after the session that prompted finishes its turn, with markers from its transcript', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
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
      const markers = markersOf(projectDir, take.markers);
      expect(markers.map(({ kind, label }) => (label ? `${kind}:${label}` : kind))).toEqual(['prompt', 'tool:Bash', 'answer']);
      const answer = markers[2]!.t;
      expect(take.seconds).toBeGreaterThan(answer + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(answer + CLAUDE_TAIL_SECONDS + 1);
    });
  }, SLOW);

  it('follows a session whose prompt came during the countdown', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      write('demo', { type: 'user', message: { content: 'an earlier turn' } }); // the session exists before the recording
      await sleep(50);
      const recording = record({ ...test, projectDir, countdownSeconds: 1, stop: { untilClaude: cwd, maxSeconds: 20 } });
      await sleep(300);
      write('demo', { type: 'user', message: { content: 'build it' } }); // during the countdown
      await sleep(1500);
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text' }] } });
      const take = await recording.done;
      expect(take.stopReason).toBe('claude');
      // The prompt came before the first frame, so only the answer is a marker.
      expect(markersOf(projectDir, take.markers).map((marker) => marker.kind)).toEqual(['answer']);
    });
  }, SLOW);
});

describe('inDeadZone', () => {
  const zones = [{ x: 100, y: 100, width: 200, height: 50 }];
  it('takes pointer input inside a zone (left and top edges in, right and bottom out), never keys or shapes', () => {
    expect(inDeadZone({ type: 'move', time: 0, x: 100, y: 100 }, zones)).toBe(true);
    expect(inDeadZone({ type: 'click', time: 0, x: 299, y: 149, button: 'left' }, zones)).toBe(true);
    expect(inDeadZone({ type: 'scroll', time: 0, x: 300, y: 120, dx: 0, dy: 1 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 150 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'key', time: 0 }, zones)).toBe(false);
    expect(inDeadZone({ type: 'shape', time: 0, shape: 'text' }, zones)).toBe(false);
    expect(inDeadZone({ type: 'move', time: 0, x: 150, y: 120 }, [])).toBe(false);
  });
});
