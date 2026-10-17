import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type Marker, type MarkersFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeEnd, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude, type ClaudeSignal } from './claude';
import { devicesFor, windowsFor } from './devices';
import { RecorderError } from './errors';
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { startInput, type InputSource } from './input';
import { areaGeometry, checkDevice, micInput, micLatency, platformFor, resolveArea, screenInput, webcamInput, type Platform, type ScreenArea } from './sources';
import type { RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
/** Seconds a track may take to deliver its first frame or sample (a DirectShow device can be slow to open). */
const START_TIMEOUT_SECONDS = 20;
const FILE_POLL_MS = 200;
const IDLE_POLL_MS = 200;

const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json' };

const now = () => Date.now() / 1000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Records a take into `<projectDir>/takes/<n>/`. See `RecordOptions` for the stop triggers. */
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const since = now(); // Claude prompts count from here, during the device listing and the countdown too
  const done = run(options, control, since);
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

/** Events for the caller and the take's warnings. A throwing `onEvent` becomes a warning, never a failed take. */
class Reporter {
  readonly warnings: string[] = [];

  constructor(private readonly onEvent: RecordOptions['onEvent']) {}

  emit(event: RecorderEvent): void {
    try {
      this.onEvent?.(event);
    } catch (error) {
      this.warnings.push(`onEvent failed on "${event.type}": ${message(error)}`);
    }
  }

  warn(text: string): void {
    this.warnings.push(text);
    this.emit({ type: 'warning', message: text });
  }
}

/**
 * The transcript watcher of `untilClaude`. It starts with `record()`, so a prompt submitted during the
 * countdown locks it onto that session; signals wait until the take runs.
 */
function claudeTrigger(cwd: string, since: number) {
  const waiting: ClaudeSignal[] = [];
  let listener: ((signal: ClaudeSignal) => void) | undefined;
  const watcher = watchClaude(claudeTranscriptDir(cwd), since, (signal) => (listener ? listener(signal) : waiting.push(signal)));
  return {
    attach(handle: (signal: ClaudeSignal) => void): void {
      listener = handle;
      for (const signal of waiting.splice(0)) handle(signal);
    },
    stop: () => watcher.stop(),
  };
}
type ClaudeTrigger = ReturnType<typeof claudeTrigger>;

const cancelled = (what: string) => new RecorderError('cancelled', `the recording was stopped before ${what}`);

async function run(options: RecordOptions, control: Control, since: number): Promise<Take> {
  try {
    return await prepareAndRecord(options, control, since);
  } catch (error) {
    // File system and native-module failures get a code too, so the CLI can map every failure.
    throw error instanceof RecorderError ? error : new RecorderError('capture', `the recording failed: ${message(error)}`, { cause: error });
  }
}

async function prepareAndRecord(options: RecordOptions, control: Control, since: number): Promise<Take> {
  const platform = platformFor(options.backend);
  const projectDir = resolve(options.projectDir);
  checkOptions(options, projectDir);
  const devices = await devicesFor(platform, options.webcam !== undefined || options.mic !== undefined);
  let area = resolveArea(options.source, devices);
  if (options.webcam !== undefined) checkDevice('camera', options.webcam, devices);
  if (options.mic !== undefined) checkDevice('mic', options.mic, devices);
  const reporter = new Reporter(options.onEvent);
  const claude = options.stop.untilClaude === undefined ? undefined : claudeTrigger(options.stop.untilClaude, since);
  try {
    for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0 && control.reason === undefined; left--) {
      reporter.emit({ type: 'countdown', seconds: left });
      await Promise.race([sleep(Math.min(left, 1) * 1000), control.stopped()]);
    }
    if (control.reason !== undefined) throw cancelled('it started');
    // A window is captured where it is when the recording starts, not where it was before the countdown.
    if (options.source.kind === 'window') area = resolveArea(options.source, { ...devices, windows: await windowsFor(platform) });
    return await recordTake({ options, control, platform, area, projectDir, dir: allocateTake(projectDir), reporter, claude });
  } finally {
    claude?.stop();
  }
}

interface TakeContext {
  options: RecordOptions;
  control: Control;
  platform: Platform;
  area: ScreenArea;
  projectDir: string;
  /** The take folder, already created. */
  dir: string;
  reporter: Reporter;
  claude: ClaudeTrigger | undefined;
}

async function recordTake({ options, control, platform, area, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  let screenStart: number | undefined;

  const markers: Marker[] = [];
  let markersFailed = false;
  const saveMarkers = () => {
    try {
      writeJson(path(FILES.markers), { version: MARKERS_VERSION, markers } satisfies MarkersFile);
      markersFailed = false;
    } catch (error) {
      if (!markersFailed) reporter.warn(`markers.json could not be written (${message(error)}); it is written again when the recording stops`);
      markersFailed = true;
    }
  };
  const addMarker = (marker: Omit<Marker, 't'>, time: number) => {
    if (screenStart === undefined || time < screenStart) return; // nothing on screen yet
    const entry = { t: Math.round((time - screenStart) * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
    reporter.emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label) => addMarker({ kind: 'manual', ...(label && { label }) }, now());

  const { size, origin } = areaGeometry(area);
  const events = openSync(path(FILES.events), 'a');
  let eventsOpen = true;
  const closeEvents = () => {
    if (!eventsOpen) return;
    eventsOpen = false;
    try {
      closeSync(events);
    } catch {
      // nothing more to lose
    }
  };
  let eventsFailed = false;
  // Called from the input hook: a failed write must not throw there, it would end the process.
  const writer = new EventsWriter((line) => {
    if (eventsFailed || !eventsOpen) return;
    try {
      writeSync(events, line);
    } catch (error) {
      eventsFailed = true;
      reporter.warn(`events.jsonl could not be written (${message(error)}); the input from here on is missing`);
    }
  }, origin);
  let lastInput = now();
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  const cleanups: (() => void)[] = [];
  let finished = false;
  const timer = (callback: () => void, ms: number, repeat = false) => {
    if (finished) return; // a late Claude answer must not start a timer after the take ended
    const handle = repeat ? setInterval(callback, ms) : setTimeout(callback, ms);
    cleanups.push(() => clearTimeout(handle));
  };
  /** Ends every trigger, the transcript watcher and the input: nothing new happens after this. */
  const finish = () => {
    finished = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
    claude?.stop();
    input?.stop();
  };

  try {
    input = await startInput(
      platform,
      (raw) => {
        lastInput = raw.time;
        writer.push(raw);
      },
      (action) => (action === 'stop' ? control.request('hotkey') : control.marker()),
    );
    const screen = spawnCapture('screen', screenArgs(screenInput(platform, area, options.drawMouse ?? false), path(FILES.screen), options.stop.untilIdleSeconds));
    captures.push(screen);
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam), path(FILES.webcam)));
    if (webcam) captures.push(webcam);
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), path(FILES.mic)));
    if (mic) captures.push(mic);

    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
    let frozen = false;
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) frozen = true;
      if (freezeEnd(line) !== undefined) frozen = false;
    });
    let micWarned = false;
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      reporter.warn(`the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (Windows: Settings > Privacy & security > Microphone)`);
    });
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race(captures.map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
    const screenAt = await startedWithin(Promise.race([screen.started, failed, control.stopped().then(() => undefined)]), 'screen');
    if (screenAt === undefined) throw cancelled('the screen track started');
    screenStart = screenAt;
    writer.setStart(screenAt, input.initial(screenAt));

    // The other tracks: a stop before they deliver anything leaves them out of the take.
    const starts: { webcam?: number; mic?: number } = {};
    void webcam?.started.then((at) => (starts.webcam = at), () => {});
    void mic?.started.then((at) => (starts.mic = at), () => {});
    const others = [webcam && 'webcam', mic && 'mic'].filter(Boolean).join(' and ');
    if (others !== '') await startedWithin(Promise.race([Promise.all([webcam?.started, mic?.started]), failed, control.stopped()]), others);
    // The tracks of this take: one that starts while the stop runs is left out of take.json and the Take alike.
    const begun = { ...starts };
    for (const [track, capture] of [['webcam', webcam], ['mic', mic]] as const) {
      if (capture && begun[track] === undefined) reporter.warn(`the ${track} had not started when the recording was stopped; it is left out of the take`);
    }
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(begun.webcam !== undefined && { webcam: { file: FILES.webcam, start: begun.webcam } }),
        ...(begun.mic !== undefined && { mic: { file: FILES.mic, start: begun.mic - micLatency(platform) } }),
      },
    } satisfies TakeFile);
    reporter.emit({ type: 'recording', dir: rel(dir) });
    startTriggers(options.stop, screenAt, control, () => frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    claude?.attach((signal) => {
      addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (signal.kind === 'answer') timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    });

    const reason = await Promise.race([control.stopped(), failed]);
    reporter.emit({ type: 'stopping', reason });
    finish();
    await Promise.all(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    // A track that was left out has no file of this take.
    for (const [track, file] of [['webcam', FILES.webcam], ['mic', FILES.mic]] as const) {
      if ((track === 'webcam' ? webcam : mic) && begun[track] === undefined) removeQuietly(path(file));
    }
    if (markersFailed) saveMarkers();
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(begun.webcam !== undefined && { webcam: rel(path(FILES.webcam)) }),
      ...(begun.mic !== undefined && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: screen.seconds() ?? now() - screenAt,
      stopReason: reason,
      warnings: reporter.warnings,
    };
  } catch (error) {
    finish();
    // The tracks that still run finish their files first; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    if (screenStart === undefined) {
      removeQuietly(dir); // nothing on screen: no take
      throw error instanceof RecorderError ? error : new RecorderError('capture', `the recording failed: ${message(error)}`, { cause: error });
    }
    const code = error instanceof RecorderError ? error.code : 'capture';
    throw new RecorderError(code, `${message(error)}\n(what was recorded is in ${rel(dir)})`, { cause: error });
  } finally {
    control.onMarker = undefined;
    closeEvents();
  }
}

/** Removes a file or folder of the take; a lock (a virus scanner, OneDrive) must not turn a result into a failure. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // left behind; the take is complete without it
  }
}

/** Starts the time, file and idle triggers on `timer`, which stops them with the take. `maxSeconds` counts from the screen's start. */
function startTriggers(
  stop: StopOptions,
  screenAt: number,
  control: Control,
  idle: () => boolean,
  timer: (callback: () => void, ms: number, repeat?: boolean) => void,
): void {
  if (stop.maxSeconds !== undefined) timer(() => control.request('max-seconds'), Math.max(0, (screenAt + stop.maxSeconds - now()) * 1000));
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    timer(() => existsSync(file) && control.request('file'), FILE_POLL_MS, true);
  }
  if (stop.untilIdleSeconds !== undefined) timer(() => idle() && control.request('idle'), IDLE_POLL_MS, true);
}

/** `promise`, or a `capture` failure when `track` has not started within START_TIMEOUT_SECONDS. */
async function startedWithin<T>(promise: Promise<T>, track: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new RecorderError('capture', `the ${track} capture did not start within ${START_TIMEOUT_SECONDS} s`)), START_TIMEOUT_SECONDS * 1000);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle);
  }
}

function checkOptions(options: RecordOptions, projectDir: string): void {
  const invalid = (text: string) => new RecorderError('invalid-options', text);
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
