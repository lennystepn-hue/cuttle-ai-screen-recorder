import { closeSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type Marker, type MarkersFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude } from './claude';
import { listDevices } from './devices';
import { RecorderError } from './errors';
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
const FILE_POLL_MS = 200;

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

const now = () => Date.now() / 1000;

/** Records a take into `<projectDir>/takes/<n>/`. See `RecordOptions` for the stop triggers. */
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const done = run(options, control);
  done.catch(() => {}); // the caller sees a failure through `done` or `stop()`
  return {
    stop() {
      control.request('stop');
      return done;
    },
    marker: (label) => control.marker(label),
    done,
  };
}

/** Stop requests and manual markers from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string) => void) | undefined;
  private waiters: ((reason: StopReason) => void)[] = [];

  /** The first request wins. */
  request(reason: StopReason): void {
    if (this.reason !== undefined) return;
    this.reason = reason;
    for (const waiter of this.waiters) waiter(reason);
  }

  stopped(): Promise<StopReason> {
    if (this.reason !== undefined) return Promise.resolve(this.reason);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  marker(label?: string): void {
    this.onMarker?.(label);
  }
}

async function run(options: RecordOptions, control: Control): Promise<Take> {
  const platform = platformFor(options.backend);
  const projectDir = resolve(options.projectDir);
  checkOptions(options, projectDir);
  const devices = await listDevices({ backend: options.backend });
  const area = resolveArea(options.source, devices);
  if (options.webcam !== undefined) checkDevice('camera', options.webcam, devices);
  if (options.mic !== undefined) checkDevice('mic', options.mic, devices);
  const emit = (event: RecorderEvent) => options.onEvent?.(event);
  const since = now(); // Claude prompts during the countdown count: the user may start early

  for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0; left--) {
    emit({ type: 'countdown', seconds: left });
    await Promise.race([sleep(Math.min(left, 1) * 1000), control.stopped()]);
    if (control.reason !== undefined) throw new RecorderError('cancelled', 'the recording was stopped before it started');
  }
  return recordTake({ options, control, platform, area, projectDir, dir: allocateTake(projectDir), since, emit });
}

interface TakeContext {
  options: RecordOptions;
  control: Control;
  platform: Platform;
  area: ScreenArea;
  projectDir: string;
  /** The take folder, already created. */
  dir: string;
  since: number;
  emit: (event: RecorderEvent) => void;
}

async function recordTake({ options, control, platform, area, projectDir, dir, since, emit }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  const warnings: string[] = [];
  let screenStart: number | undefined;

  const markers: Marker[] = [];
  const saveMarkers = () => writeJson(path(FILES.markers), { version: MARKERS_VERSION, markers } satisfies MarkersFile);
  const addMarker = (marker: Omit<Marker, 't'>, time: number) => {
    if (screenStart === undefined || time < screenStart) return; // nothing on screen yet
    const entry = { t: Math.round((time - screenStart) * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
    emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const { size, origin } = areaGeometry(area);
  const events = openSync(path(FILES.events), 'a');
  const writer = new EventsWriter((line) => writeSync(events, line), origin);
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  let triggers: (() => void)[] = [];

  try {
    input = await startInput(platform, (raw) => writer.push(raw), (action) => (action === 'stop' ? control.request('hotkey') : control.marker()));
    const screen = spawnCapture('screen', screenArgs(screenInput(platform, area, options.drawMouse ?? false), path(FILES.screen), options.stop.untilIdleSeconds));
    captures.push(screen);
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam), path(FILES.webcam)));
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one after a change.
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) control.request('idle');
    });
    let micWarned = false;
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      const message = `the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)`;
      warnings.push(message);
      emit({ type: 'warning', message });
    });
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race(captures.map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});

    const [screenAt, webcamAt, micAt] = await Promise.race([Promise.all([screen.started, webcam?.started, mic?.started]), failed]);
    screenStart = screenAt;
    writer.setStart(screenAt, input.initial(screenAt));
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(webcamAt !== undefined && { webcam: { file: FILES.webcam, start: webcamAt } }),
        ...(micAt !== undefined && { mic: { file: FILES.mic, start: micAt - micLatency(platform) } }),
      },
    } satisfies TakeFile);
    emit({ type: 'recording', dir: rel(dir) });
    triggers = startTriggers(options.stop, since, control, addMarker);

    const reason = await Promise.race([control.stopped(), failed]);
    emit({ type: 'stopping', reason });
    triggers.forEach((stop) => stop());
    input.stop();
    writer.close();
    await Promise.all(captures.map((capture) => capture.stop()));
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(webcam && { webcam: rel(path(FILES.webcam)) }),
      ...(mic && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: screen.seconds() ?? now() - screenAt,
      stopReason: reason,
      warnings,
    };
  } catch (error) {
    triggers.forEach((stop) => stop());
    input?.stop();
    writer.close();
    // The tracks that still run finish their files; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    throw error;
  } finally {
    control.onMarker = undefined;
    closeSync(events);
  }
}

/** Starts the time, file and Claude triggers; returns their stop functions. */
function startTriggers(stop: StopOptions, since: number, control: Control, addMarker: (marker: Omit<Marker, 't'>, time: number) => void): (() => void)[] {
  const stops: (() => void)[] = [];
  if (stop.maxSeconds !== undefined) {
    const timer = setTimeout(() => control.request('max-seconds'), stop.maxSeconds * 1000);
    stops.push(() => clearTimeout(timer));
  }
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    const timer = setInterval(() => existsSync(file) && control.request('file'), FILE_POLL_MS);
    stops.push(() => clearInterval(timer));
  }
  if (stop.untilClaude !== undefined) {
    const watcher = watchClaude(claudeTranscriptDir(stop.untilClaude), since, (signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind !== 'answer') return;
      const timer = setTimeout(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
      stops.push(() => clearTimeout(timer));
    });
    stops.push(() => watcher.stop());
  }
  return stops;
}

function checkOptions(options: RecordOptions, projectDir: string): void {
  const invalid = (message: string) => new RecorderError('invalid-options', message);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw invalid(`project folder ${projectDir} does not exist`);
  const positive = (name: string, value: number | undefined) => {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw invalid(`${name} must be a positive number of seconds`);
  };
  positive('maxSeconds', options.stop.maxSeconds);
  positive('untilIdleSeconds', options.stop.untilIdleSeconds);
  const countdown = options.countdownSeconds;
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
  if (flag !== undefined && existsSync(flag)) throw invalid(`untilFile ${flag} already exists; delete it first, or the recording would stop at once`);
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
function allocateTake(projectDir: string): string {
  const takes = join(projectDir, 'takes');
  mkdirSync(takes, { recursive: true });
  let next = readdirSync(takes).reduce((max, name) => (/^\d+$/.test(name) ? Math.max(max, Number(name)) : max), 0) + 1;
  for (;;) {
    const dir = join(takes, String(next));
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      next++;
    }
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
