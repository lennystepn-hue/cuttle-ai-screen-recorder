import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { parseEventsJsonl, parseMarkersJson, parseSegmentsJson, parseTakeJson, trackOffset } from '@cuttle/project';
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

/** A spoken sentence, for the spoken test mic. */
const SPEECH = join(import.meta.dirname, '..', '..', 'core', 'test', 'fixtures', 'speech', 'en.m4a');

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
    let slipAt = 0;
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
          // the mistake key
          setTimeout(() => {
            slipAt = Date.now() / 1000;
            recording.retake();
          }, 1600);
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
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    // each track's start is recorded (the engine lines them up); a loaded machine starts one late
    expect(Math.abs(trackOffset(takeFile.take, 'webcam')!)).toBeLessThan(0.5);
    expect(Math.abs(trackOffset(takeFile.take, 'mic')!)).toBeLessThan(0.5);
    // the mic runs to the stop from its own start: as long as the take, and as much longer as it started earlier
    expect(probe(join(projectDir, take.mic!))).toMatchObject({ codec_name: 'aac', sample_rate: '48000', duration: expect.closeTo(take.seconds - trackOffset(takeFile.take, 'mic')!, 0) });

    const { events: input, issues } = parseEventsJsonl(read(projectDir, take.events));
    expect(issues).toEqual([]);
    expect(input.slice(0, 2)).toEqual([expect.objectContaining({ t: 0, type: 'move' }), { t: 0, type: 'shape', shape: 'arrow' }]);
    expect(new Set(input.map((event) => event.type))).toEqual(new Set(['move', 'shape', 'click', 'scroll', 'keys']));

    // Marker times count from the screen's first frame, which starts late on a loaded machine.
    const markedSecond = markedAt - takeFile.take.tracks.screen.start;
    const slipSecond = slipAt - takeFile.take.tracks.screen.start;
    expect(markersOf(projectDir, take.markers)).toEqual([
      { t: expect.closeTo(markedSecond, 1), kind: 'manual', label: 'one second' },
      { t: expect.closeTo(slipSecond, 1), kind: 'retake' },
    ]);
    expect(events.filter((event) => event.type !== 'level').map((event) => event.type)).toEqual(['processes', 'recording', 'marker', 'marker', 'stopping']);
    // the mic's level while it records: the test mic's sine at 1/8 of full scale is about -21 dBFS
    const levels = events.flatMap((event) => (event.type === 'level' ? [event.rms] : []));
    expect(levels.length).toBeGreaterThan(15);
    expect(levels.every((rms) => rms > -22.5 && rms < -19.5)).toBe(true);
    // screen, webcam and mic: the app kills these when its recorder host dies
    const processes = events[0]!;
    expect(processes.type === 'processes' && processes.pids.length === 3 && processes.pids.every(Number.isInteger)).toBe(true);
  }, SLOW);

  it("moves through the script's steps: the first at the first frame, then a marker for each move, none past either end", async () => {
    const projectDir = project();
    const events: RecorderEvent[] = [];
    const moves: number[] = [];
    const recording = record({
      ...test,
      projectDir,
      steps: ['step1', 'step2', 'step3'],
      stop: { maxSeconds: 2.5 },
      onEvent: (event) => {
        events.push(event);
        if (event.type !== 'recording') return;
        setTimeout(() => {
          recording.previous(); // at the first step: nothing
          moves.push(Date.now() / 1000);
          recording.next();
        }, 700);
        setTimeout(() => {
          moves.push(Date.now() / 1000);
          recording.next();
          recording.next(); // past the last: nothing
          recording.previous();
        }, 1400);
      },
    });
    const take = await recording.done;
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    const [second, third] = moves.map((at) => at - takeFile.take.tracks.screen.start);
    expect(markersOf(projectDir, take.markers)).toEqual([
      { t: 0, kind: 'step', label: 'step1' },
      { t: expect.closeTo(second!, 1), kind: 'step', label: 'step2' },
      { t: expect.closeTo(third!, 1), kind: 'step', label: 'step3' },
      { t: expect.closeTo(third!, 1), kind: 'step', label: 'step2' },
    ]);
    // each step reaches the host as a marker event, the first right after the recording one
    expect(events.filter((event) => event.type === 'recording' || event.type === 'marker').map((event) => (event.type === 'marker' ? event.marker.label : event.type))).toEqual(['recording', 'step1', 'step2', 'step3', 'step2']);
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
    const levels: number[] = [];
    const recording = record({
      ...test,
      projectDir,
      mic: 'Silent Test Microphone',
      stop: {},
      onEvent: (event) => {
        if (event.type === 'warning') warnings.push(event.message);
        if (event.type === 'level') levels.push(event.rms, event.peak);
      },
    });
    await sleep(2000);
    const take = await recording.stop();
    expect(take.stopReason).toBe('stop');
    expect(take.warnings).toEqual(['the microphone "Silent Test Microphone" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)']);
    expect(warnings).toEqual(take.warnings);
    // its level says so too: digital silence
    expect(levels.length).toBeGreaterThan(0);
    expect(new Set(levels)).toEqual(new Set([-90]));
  }, SLOW);

  it("hands the mic's samples to onAudio while it records: whole samples, as long as the take recorded", async () => {
    const projectDir = project();
    const chunks: Uint8Array[] = [];
    let recordingSeen = false;
    let early = 0;
    const take = await record({
      ...test,
      projectDir,
      mic: 'Test Microphone',
      stop: { maxSeconds: 1.5 },
      onEvent: (event) => {
        if (event.type === 'recording') recordingSeen = true;
      },
      onAudio: (samples) => {
        if (!recordingSeen) early++;
        chunks.push(samples.slice());
      },
    }).done;
    expect(early).toBe(0);
    expect(chunks.every((samples) => samples.length % 2 === 0)).toBe(true);
    // the 1.5 s recorded until the stop; the screen's file runs on while its capture ends (longer on a
    // loaded machine), the samples do not
    const seconds = chunks.reduce((sum, samples) => sum + samples.length, 0) / 2 / 16_000;
    expect(seconds).toBeGreaterThan(1.5 - 0.4);
    expect(seconds).toBeLessThan(Math.max(take.seconds, 1.5) + 0.3);
  }, SLOW);

  it('stops handing samples to an onAudio that throws, with a warning, and keeps the take', async () => {
    let calls = 0;
    const take = await record({
      ...test,
      projectDir: project(),
      mic: 'Test Microphone',
      stop: { maxSeconds: 1.5 },
      onAudio: () => {
        calls++;
        throw new Error('listener bug');
      },
    }).done;
    expect(calls).toBe(1);
    expect(take.mic).toBe('takes/1/mic.m4a');
    expect(take.warnings).toEqual(['onAudio failed: listener bug']);
  }, SLOW);

  it('records the spoken test mic: the sound file CUTTLE_TEST_SPEECH names, looped', async () => {
    process.env.CUTTLE_TEST_SPEECH = SPEECH;
    const levels: number[] = [];
    const take = await record({
      ...test,
      projectDir: project(),
      mic: 'Spoken Test Microphone',
      stop: { maxSeconds: 2 },
      onEvent: (event) => event.type === 'level' && levels.push(event.rms),
    }).done;
    expect(take.warnings).toEqual([]);
    expect(take.mic).toBe('takes/1/mic.m4a');
    // speech: loud and quiet tenths of a second
    expect(Math.max(...levels)).toBeGreaterThan(-35);
    expect(Math.min(...levels)).toBeLessThan(Math.max(...levels) - 10);
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

  it('records a window by itself, its frame changing only now and then, at 30 frames a second', async () => {
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', title: 'Test Window' }, stop: { maxSeconds: 2 } }).done;
    expect(take.warnings).toEqual([]);
    // the test window's pattern changes 10 times a second; the take has a frame every 1/30 s (under
    // load fewer: a late tick of the clock writes one)
    const { stdout } = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(projectDir, take.screen)], { encoding: 'utf8' });
    expect(Number(stdout) / take.seconds).toBeGreaterThan(20);
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
      [{ steps: ['step1', 'step1'] }, 'invalid-options'],
      [{ steps: [''] }, 'invalid-options'],
      [{ mic: 'No Such Microphone' }, 'device-not-found'],
      [{ source: { kind: 'monitor', index: 7 } }, 'device-not-found'],
    ];
    for (const [options, code] of cases) {
      await expect(record({ ...test, projectDir, stop: {}, ...options }).done).rejects.toMatchObject({ code });
    }
    expect(existsSync(join(projectDir, 'takes'))).toBe(false);
  }, SLOW);
});

describe.concurrent('pausing a take (test backend)', () => {
  it('records nothing while paused, joins the segments with every track in step, and counts maxSeconds in take time', async () => {
    const projectDir = project();
    const events: RecorderEvent['type'][] = [];
    let wallAtPause = 0;
    const started = Date.now() / 1000;
    const recording = record({
      ...test,
      projectDir,
      webcam: 'Test Camera',
      mic: 'Test Microphone',
      stop: { maxSeconds: 5 },
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === 'recording') setTimeout(() => recording.pause(), 1200);
        if (event.type === 'paused' && wallAtPause === 0) {
          wallAtPause = Date.now() / 1000;
          // a marker set while paused lands where the take paused
          recording.marker('during the pause');
          setTimeout(() => recording.resume(), 1000);
        }
        if (event.type === 'resumed' && events.filter((type) => type === 'resumed').length === 1) {
          setTimeout(() => recording.pause(), 1000);
          // the second pause is short: resume asked before it even finished
          setTimeout(() => recording.resume(), 1100);
        }
      },
    });
    const take = await recording.done;
    const elapsed = Date.now() / 1000 - started;

    expect(take.stopReason).toBe('max-seconds');
    // 5 s of take (room for three segments that start or stop late on a loaded machine, as GitHub's
    // macOS runners are), and at least a second more of pauses on the clock
    expect(take.seconds).toBeGreaterThan(4.5);
    expect(take.seconds).toBeLessThan(6);
    expect(elapsed).toBeGreaterThan(take.seconds + 1);
    expect(events.filter((type) => type === 'paused')).toHaveLength(2);
    expect(events.filter((type) => type === 'resumed')).toHaveLength(2);
    expect(events.at(-1)).toBe('stopping');

    // the joined tracks are as long as the take (each segment lined up with its screen segment), to a
    // few frames at the end: a loaded machine ends a piece's webcam a frame or two late
    const screen = probe(join(projectDir, take.screen));
    expect(screen).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    expect(screen.duration).toBeCloseTo(take.seconds, 1);
    expect(Math.abs(probe(join(projectDir, take.webcam!)).duration - take.seconds)).toBeLessThan(0.1);
    expect(Math.abs(probe(join(projectDir, take.mic!)).duration - take.seconds)).toBeLessThan(0.1);
    // take.json: the joined webcam and mic start with the screen
    const takeFile = parseTakeJson(read(projectDir, 'takes/1/take.json'));
    if (!takeFile.ok) throw new Error(JSON.stringify(takeFile.issues));
    expect(trackOffset(takeFile.take, 'webcam')).toBe(0);
    expect(trackOffset(takeFile.take, 'mic')).toBe(0);
    // segments.json keeps the stamps (for Claude's markers later); the segments' files are gone
    const manifest = parseSegmentsJson(read(projectDir, 'takes/1/segments.json'));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.issues));
    expect(manifest.segments.joined).toBe(true);
    expect(manifest.segments.segments).toHaveLength(3);
    const lengths = manifest.segments.segments.map((segment) => segment.duration!);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(take.seconds, 1);
    expect(readdirSync(join(projectDir, 'takes/1')).sort()).toEqual(['events.jsonl', 'markers.json', 'mic.m4a', 'screen.mp4', 'segments.json', 'take.json', 'webcam.mp4']);

    // the marker set while paused is at the end of the first segment
    expect(markersOf(projectDir, take.markers)).toEqual([{ t: expect.closeTo(lengths[0]!, 1), kind: 'manual', label: 'during the pause' }]);
    // input is in take time: nothing beyond the take, and none while paused
    const { events: input } = parseEventsJsonl(read(projectDir, take.events));
    expect(input.at(-1)!.t).toBeLessThanOrEqual(take.seconds + 0.1);
    expect(Math.max(...input.map((event) => event.t))).toBeLessThanOrEqual(take.seconds + 0.1);
  }, SLOW);

  it('stops while paused: the take ends where it paused', async () => {
    const projectDir = project();
    let pausedAt = 0;
    let stoppedAt = 0;
    const recording = record({
      ...test,
      projectDir,
      mic: 'Test Microphone',
      stop: {},
      onEvent: (event) => {
        if (event.type === 'recording')
          setTimeout(() => {
            pausedAt = Date.now() / 1000;
            recording.pause();
          }, 1000);
        if (event.type === 'paused')
          setTimeout(() => {
            stoppedAt = Date.now() / 1000;
            void recording.stop();
          }, 800);
      },
    });
    const take = await recording.done;
    expect(take.stopReason).toBe('stop');
    // from the screen's first frame (the recording event waits for the mic too, later on a loaded
    // machine) to the pause; the 0.8 s paused before the stop are not in it
    const manifest = parseSegmentsJson(read(projectDir, 'takes/1/segments.json'));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.issues));
    const screenStart = manifest.segments.segments[0]!.screen.start;
    expect(take.seconds).toBeCloseTo(pausedAt - screenStart, 0);
    expect(take.seconds).toBeLessThan(stoppedAt - screenStart - 0.5);
    expect(probe(join(projectDir, take.screen)).duration).toBeCloseTo(take.seconds, 1);
    expect(probe(join(projectDir, take.mic!)).duration).toBeCloseTo(take.seconds, 1);
    expect(existsSync(join(projectDir, 'takes/1/screen.1.mp4'))).toBe(false);
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

  /** Claude Code's notice that the background work started by tool call `id` ended. */
  const notice = (id: string) => `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Background command completed (exit code 0)</summary>\n</task-notification>`;
  const background = (write: (session: string, value: object) => void, id: string, command: string) => {
    write('demo', { type: 'assistant', message: { id: `m-${id}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, run_in_background: true } }] } });
    write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: b-${id}. Output is being written to: b-${id}.output` }] } });
  };

  it('waits for what Claude left running in the background, and stops after its answer once that is done', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 20 } });
      let ended = false;
      recording.done.then(
        () => (ended = true),
        () => (ended = true),
      );
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'show me the table' } });
      await sleep(300);
      background(write, 't1', 'sqlite3 shop.db "select * from orders"');
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The query runs in the background; the table follows.' }] } });
      // past the tail of that answer: the take goes on
      await sleep((CLAUDE_TAIL_SECONDS + 1.5) * 1000);
      expect(ended).toBe(false);
      write('demo', { type: 'queue-operation', operation: 'enqueue', content: notice('t1') });
      write('demo', { type: 'user', message: { content: notice('t1') } });
      await sleep(300);
      write('demo', { type: 'assistant', message: { id: 'a2', stop_reason: 'end_turn', content: [{ type: 'text', text: '| order | total |' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual([]);
      const markers = markersOf(projectDir, take.markers);
      expect(markers.map(({ kind, label }) => (label ? `${kind}:${label}` : kind))).toEqual(['prompt', 'tool:Bash', 'answer', 'answer']);
      // the table's answer, not the first one, ends the take
      expect(take.seconds).toBeGreaterThan(markers[3]!.t + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(markers[3]!.t + CLAUDE_TAIL_SECONDS + 1);
    });
  }, SLOW);

  it('stops anyway once the session has been quiet for untilClaudeQuietSeconds, and says why (a server never ends)', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, untilClaudeQuietSeconds: 2, maxSeconds: 20 } });
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'start the app' } });
      await sleep(300);
      background(write, 't1', 'npm run dev');
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'It runs at http://localhost:3000.' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual(['Claude Code left a command or agent running in the background (a server?): the take ended 2 s after the last step in its session']);
      const answer = markersOf(projectDir, take.markers).find((marker) => marker.kind === 'answer')!.t;
      expect(take.seconds).toBeGreaterThan(answer + 2 + CLAUDE_TAIL_SECONDS - 0.3);
      expect(take.seconds).toBeLessThan(answer + 2 + CLAUDE_TAIL_SECONDS + 1.5);
    });
  }, SLOW);

  it('counts work Claude stopped itself as done: the take ends after its answer', async () => {
    const projectDir = project();
    const { config, cwd, write } = transcripts();
    await withConfig(config, async () => {
      const recording = record({ ...test, projectDir, stop: { untilClaude: cwd, maxSeconds: 15 } });
      await sleep(600);
      write('demo', { type: 'user', message: { content: 'check the page, then stop the server' } });
      await sleep(300);
      background(write, 't1', 'npm run dev');
      write('demo', { type: 'assistant', message: { id: 'm-t2', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'TaskStop', input: { task_id: 'b-t1' } }] } });
      write('demo', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '{"message":"Successfully stopped task: b-t1 (npm run dev)","task_id":"b-t1"}' }] } });
      write('demo', { type: 'assistant', message: { id: 'a1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'The page works; the server is stopped.' }] } });
      const take = await recording.done;

      expect(take.stopReason).toBe('claude');
      expect(take.warnings).toEqual([]);
      const answer = markersOf(projectDir, take.markers).find((marker) => marker.kind === 'answer')!.t;
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

describe('record (test backend), a window that is closed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('ends the take when the window it records by itself is closed, and says so', async () => {
    vi.stubEnv('CUTTLE_TEST_WINDOW_CLOSES', '1');
    const projectDir = project();
    const take = await record({ ...test, projectDir, source: { kind: 'window', id: 1001 }, stop: { maxSeconds: 10 } }).done;
    expect(take.stopReason).toBe('window');
    expect(take.warnings).toEqual(['the window was closed: the take ends there']);
    expect(take.seconds).toBeGreaterThan(0.8);
    expect(take.seconds).toBeLessThan(3);
    expect(probe(join(projectDir, take.screen))).toMatchObject({ width: 640, height: 360 });
  }, SLOW);
});
