import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, SEGMENTS_VERSION, TAKE_VERSION, takeTime, type Marker, type MarkersFile, type Segment, type SegmentsFile, type TakeFile } from '@cuttle/project';
import { SILENCE_SECONDS, freezeEnd, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from './args';
import { claudeTranscriptDir, watchClaude, type ClaudeSignal } from './claude';
import { cameraModeFor, devicesFor, windowsFor } from './devices';
import { RecorderError } from './errors';
import { EventsWriter } from './events';
import { spawnCapture, type CaptureProcess } from './ffmpeg';
import { captureHelper, helperArgs, helperInput } from './mac-capture';
import { startInput, type InputSource } from './input';
import { levelMeter, wholeSamples } from './level';
import { FPS as JOIN_FPS, joinSegments, mediaInfo, renameWhenFree } from './join';
import { areaGeometry, checkDevice, deviceClock, micInput, micLatency, platformFor, resolveArea, screenFilter, screenInput, screenLatency, webcamInput, wholeWindow, type CameraMode, type Platform, type ScreenArea } from './sources';
import { hasWindowCapture, relayInput, testWindowFeeder, windowFeeder } from './window-capture';
import { WINDOW_GATE_MS, windowGate } from './window-gate';
import type { Bounds, RawInput, RecordOptions, Recording, RecorderEvent, StopOptions, StopReason, Take } from './types';

const DEFAULT_COUNTDOWN_SECONDS = 3;
/** Seconds kept after Claude's final answer, so the video shows it. */
export const CLAUDE_TAIL_SECONDS = 2;
/**
 * When Claude answers while commands or agents it started still run in the background, the take
 * waits for them and for its answer after them, but not past this many seconds without anything new
 * in its transcript: a server it started never ends.
 */
export const CLAUDE_BACKGROUND_SECONDS = 60;
/** Seconds a track may take to deliver its first frame or sample (a DirectShow device can be slow to open, macOS may ask for access first). */
const START_TIMEOUT_SECONDS = 20;
const FILE_POLL_MS = 200;
const IDLE_POLL_MS = 200;

/** A take is joined from at most this many pieces (each adds to one ffmpeg command line). */
export const MAX_SEGMENTS = 100;
const FILES = { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a', events: 'events.jsonl', markers: 'markers.json', take: 'take.json', segments: 'segments.json' };
/** How often maxSeconds is checked against the take's time (which stands still while paused). */
const MAX_POLL_MS = 50;

const now = () => Date.now() / 1000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Records a take into `<projectDir>/takes/<n>/`. See `RecordOptions` for the stop triggers. */
export function record(options: RecordOptions): Recording {
  const control = new Control();
  const since = now(); // Claude prompts count from here, during the device listing and the countdown too
  control.deadZones = [...(options.deadZones ?? [])];
  const done = run(options, control, since);
  done.catch(() => {}); // the caller sees a failure through `done` or `stop()`
  return {
    stop() {
      control.request('stop');
      return done;
    },
    marker: (label) => control.marker(label),
    retake: () => control.retake(),
    next: () => control.step(1),
    previous: () => control.step(-1),
    pause: () => control.setPaused(true),
    resume: () => control.setPaused(false),
    setDeadZones: (zones) => (control.deadZones = [...zones]),
    done,
  };
}

/** Stop requests, pauses, manual markers and the script's steps from the caller, the hotkeys and the triggers. */
class Control {
  reason: StopReason | undefined;
  onMarker: ((label?: string, kind?: 'manual' | 'retake') => void) | undefined;
  /** Moves through the script's steps once the take runs. */
  onStep: ((delta: 1 | -1) => void) | undefined;
  /** Pointer input inside these is not logged. */
  deadZones: Bounds[] = [];
  private waiters: ((reason: StopReason) => void)[] = [];
  /** Whether the caller wants the take paused: the newest `pause` or `resume` wins. */
  private paused = false;
  private pauseWaiters: { paused: boolean; resolve: () => void }[] = [];

  /** A pause that cannot be taken (the take has as many pieces as it may), and what to say then. */
  pauseRefused: (() => boolean) | undefined;
  onPauseRefused: (() => void) | undefined;

  setPaused(paused: boolean): void {
    if (paused && !this.paused && this.pauseRefused?.()) return void this.onPauseRefused?.();
    this.paused = paused;
    const ready = this.pauseWaiters.filter((waiter) => waiter.paused === paused);
    this.pauseWaiters = this.pauseWaiters.filter((waiter) => waiter.paused !== paused);
    for (const waiter of ready) waiter.resolve();
  }

  toggle(): void {
    this.setPaused(!this.paused);
  }

  /** Resolves once the take should be paused; at once when it already should. */
  pauseWanted(): Promise<'pause'> {
    return this.until(true).then(() => 'pause' as const);
  }

  /** Resolves once the take should record again; at once when it already should. */
  resumeWanted(): Promise<'resume'> {
    return this.until(false).then(() => 'resume' as const);
  }

  private until(paused: boolean): Promise<void> {
    if (this.paused === paused) return Promise.resolve();
    return new Promise((resolve) => this.pauseWaiters.push({ paused, resolve }));
  }

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

  retake(): void {
    this.onMarker?.(undefined, 'retake');
  }

  step(delta: 1 | -1): void {
    this.onStep?.(delta);
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

/** Whether a pointer event lies in one of the dead zones (keys and shapes have no position). */
export function inDeadZone(input: RawInput, zones: readonly Bounds[]): boolean {
  if (input.type === 'key' || input.type === 'shape' || input.type === 'area' || input.type === 'window') return false;
  return zones.some((zone) => input.x >= zone.x && input.x < zone.x + zone.width && input.y >= zone.y && input.y < zone.y + zone.height);
}

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
  if (platform === 'macos') await checkMacAccess(options);
  const devices = await devicesFor(platform, options.webcam !== undefined || options.mic !== undefined);
  let area = resolveArea(options.source, devices);
  if (options.webcam !== undefined) checkDevice('camera', options.webcam, devices);
  if (options.mic !== undefined) checkDevice('mic', options.mic, devices);
  const cameraMode = options.webcam === undefined ? undefined : await cameraModeFor(platform, options.webcam);
  const reporter = new Reporter(options.onEvent);
  const claude = options.stop.untilClaude === undefined ? undefined : claudeTrigger(options.stop.untilClaude, since);
  // a window by itself: on Windows where ffmpeg has gfxcapture (asked while the countdown runs), and the test backend's
  const window = options.source.kind === 'window';
  const byItself = window && platform === 'windows' ? hasWindowCapture() : Promise.resolve(window && platform === 'test');
  try {
    for (let left = options.countdownSeconds ?? DEFAULT_COUNTDOWN_SECONDS; left > 0 && control.reason === undefined; left--) {
      reporter.emit({ type: 'countdown', seconds: left });
      await Promise.race([sleep(Math.min(left, 1) * 1000), control.stopped()]);
    }
    if (control.reason !== undefined) throw cancelled('it started');
    // A window is captured where it is when the recording starts, not where it was before the countdown.
    if (options.source.kind === 'window') area = resolveArea(options.source, { ...devices, windows: await windowsFor(platform) });
    const whole = await byItself;
    if (whole) area = wholeWindow(area);
    else if (window && platform === 'windows') {
      reporter.warn('this ffmpeg cannot record a window by itself (ffmpeg 8 or newer can: winget upgrade Gyan.FFmpeg): the screen where the window is is recorded, so keep the window in front');
    }
    return await recordTake({ options, control, platform, area, byItself: whole, cameraMode, projectDir, dir: allocateTake(projectDir), reporter, claude });
  } finally {
    claude?.stop();
  }
}

interface TakeContext {
  options: RecordOptions;
  control: Control;
  platform: Platform;
  area: ScreenArea;
  /** A window take of the window by itself through gfxcapture (Windows) or a test pattern (the test backend). */
  byItself: boolean;
  /** The webcam's picture size, where the platform needs to ask for one (macOS). */
  cameraMode: CameraMode | undefined;
  projectDir: string;
  /** The take folder, already created. */
  dir: string;
  reporter: Reporter;
  claude: ClaudeTrigger | undefined;
}

/** One stretch of the take's capture processes, from a start (or resume) to a pause or the stop. */
interface Tracks {
  screen: CaptureProcess;
  webcam?: CaptureProcess;
  mic?: CaptureProcess;
  /** Rejects with the first capture that fails; never resolves. */
  failed: Promise<never>;
  /** This screen process's freeze detection (a new one starts unfrozen). */
  frozen: boolean;
}

const all = (tracks: Tracks) => [tracks.screen, tracks.webcam, tracks.mic].filter((capture): capture is CaptureProcess => capture !== undefined);

/** A track's file in segment `k` of a paused take: `screen.2.mp4`. */
const numbered = (file: string, k: number) => file.replace(/\.(mp4|m4a)$/, `.${k}.$1`);

async function recordTake({ options, control, platform, area, byItself, cameraMode, projectDir, dir, reporter, claude }: TakeContext): Promise<Take> {
  const path = (file: string) => join(dir, file);
  const rel = (file: string) => relative(projectDir, file).split(sep).join('/');
  /** The take's stretches between pauses; written to segments.json from the first pause on. */
  const segments: Segment[] = [];
  /** It was paused at least once: its segments are joined at the end. */
  let paused = false;
  /** Input is logged and the take's time runs only while every track records. */
  let capturing = false;
  /** Seconds recorded before the segment that runs now. */
  const recordedBefore = () => segments.reduce((sum, segment) => sum + (segment.duration ?? 0), 0);
  const recordedNow = () => {
    const last = segments.at(-1);
    return recordedBefore() + (capturing && last && last.duration === undefined ? now() - last.screen.start : 0);
  };

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
    // nothing on screen yet; while paused, where the take paused
    const t = takeTime(segments, time, true);
    if (t === undefined) return;
    const entry = { t: Math.round(t * 1000) / 1000, ...marker };
    markers.push(entry);
    markers.sort((a, b) => a.t - b.t);
    saveMarkers();
    reporter.emit({ type: 'marker', marker: entry });
  };
  saveMarkers();
  control.onMarker = (label, kind = 'manual') => addMarker({ kind, ...(label && { label }) }, now());

  const writeSegments = (joined = false) => {
    const file = path(FILES.segments);
    writeJson(`${file}.part`, { version: SEGMENTS_VERSION, segments, ...(joined && { joined }) } satisfies SegmentsFile);
    renameWhenFree(`${file}.part`, file);
  };

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
  /** Every capture started, so a failure stops the ones still running. */
  const captures: CaptureProcess[] = [];
  let input: InputSource | undefined;
  const cleanups: (() => void)[] = [];
  let finished = false;
  const timer = (callback: () => void, ms: number, repeat = false) => {
    if (finished) return; // a late Claude answer must not start a timer after the take ended
    const handle = repeat ? setInterval(callback, ms) : setTimeout(callback, ms);
    cleanups.push(() => clearTimeout(handle));
    return handle;
  };
  /** Ends every trigger, the transcript watcher and the input: nothing new happens after this. */
  const finish = () => {
    finished = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
    claude?.stop();
    input?.stop();
  };

  let micWarned = false;
  let audioFailed = false;
  // macOS: ScreenCaptureKit through the helper, which leaves out the app's own windows; avfoundation without it
  const helper = platform === 'macos' ? captureHelper() : undefined;
  // macOS: the camera's and the mic's starts are their capture times on the host clock, mapped to the wall clock
  const ownStamps = deviceClock(platform);
  const toWall = ownStamps ? (await import('./darwin').then(({ loadDarwin }) => loadDarwin())).hostToWall : (seconds: number) => seconds;
  // a window take by itself (macOS's helper, Windows' gfxcapture): only the input done in the window
  const gate = area.window !== undefined && (helper !== undefined || (byItself && platform === 'windows')) ? windowGate(area.window, { ...origin, ...size }, (corner) => writer.moveOrigin(corner)) : undefined;
  if (gate) {
    const os = platform === 'macos' ? await (await import('./darwin')).loadDarwin() : await (await import('./win32')).loadWin32();
    const look = () => {
      try {
        gate.look(os.foreground());
      } catch {
        // the next look tries again
      }
    };
    look();
    timer(look, WINDOW_GATE_MS, true);
  }
  // Windows and the test backend, a window by itself: a feeder reads it, its newest frame is written 30 times a second
  const feeder = byItself ? (platform === 'windows' ? windowFeeder(area.window!, size, options.drawMouse ?? false) : testWindowFeeder(size)) : undefined;
  if (byItself && platform === 'windows') cleanups.push((await (await import('./win32')).loadWin32()).fineTimers());
  if (platform === 'macos' && !helper && (options.hideWindowsOf?.length ?? 0) > 0) {
    reporter.warn("Cuttle's own windows show in this take: the capture helper is missing (it is built by pnpm install with Xcode's command line tools)");
  }
  /** The capture processes of segment `k` (the first writes the take's own file names). */
  const spawnTracks = (k: number): Tracks => {
    const file = (name: string) => path(k === 1 ? name : numbered(name, k));
    const drawMouse = options.drawMouse ?? false;
    const screen = helper
      ? spawnCapture('screen', screenArgs(helperInput(area), file(FILES.screen), options.stop.untilIdleSeconds), { command: helper, args: helperArgs(area, drawMouse, options.hideWindowsOf ?? []) })
      : feeder
        ? spawnCapture('screen', screenArgs(relayInput(size), file(FILES.screen), options.stop.untilIdleSeconds), feeder)
        : spawnCapture('screen', screenArgs(screenInput(platform, area, drawMouse), file(FILES.screen), options.stop.untilIdleSeconds, screenFilter(platform, area)));
    // the window was closed: the take ends there
    void screen.ended?.then(() => {
      if (control.reason !== undefined) return;
      reporter.warn('the window was closed: the take ends there');
      control.request('window');
    });
    const webcam = options.webcam === undefined ? undefined : spawnCapture('webcam', webcamArgs(webcamInput(platform, options.webcam, cameraMode), file(FILES.webcam), !ownStamps));
    // the mic's level and its samples, while the take records (whole samples per capture: one that
    // stops at a pause may end inside a sample)
    const level = levelMeter((heard) => capturing && reporter.emit({ type: 'level', ...heard }));
    const samples = wholeSamples((heard) => {
      if (!capturing || audioFailed || !options.onAudio) return;
      try {
        options.onAudio(heard);
      } catch (error) {
        audioFailed = true;
        reporter.warn(`onAudio failed: ${message(error)}`);
      }
    });
    const sound = (chunk: Uint8Array) => {
      level(chunk);
      samples(chunk);
    };
    const mic = options.mic === undefined ? undefined : spawnCapture('mic', micArgs(micInput(platform, options.mic), file(FILES.mic), !ownStamps), undefined, sound);
    // Rejects with the first capture that fails; `exited` only resolves after stop() was called.
    const failed: Promise<never> = Promise.race([screen, webcam, mic].filter((capture) => capture !== undefined).map((capture) => capture.exited)).then(() => new Promise<never>(() => {}));
    failed.catch(() => {});
    const tracks: Tracks = { screen, ...(webcam && { webcam }), ...(mic && { mic }), failed, frozen: false };
    captures.push(...all(tracks));
    reporter.emit({ type: 'processes', pids: all(tracks).flatMap((capture) => [capture.pid, capture.feederPid]).filter((pid): pid is number => pid !== undefined) });
    // A freeze that starts at 0 means the screen has not changed yet: untilIdleSeconds waits for one
    // after a change, and for the input to rest as long (someone pointing at a still chart is not idle).
    screen.onLine((line) => {
      const start = freezeStart(line);
      if (start !== undefined && start > 0) tracks.frozen = true;
      if (freezeEnd(line) !== undefined) tracks.frozen = false;
    });
    mic?.onLine((line) => {
      const start = silenceStart(line);
      if (start === undefined || start >= SILENCE_SECONDS || micWarned) return;
      micWarned = true;
      const settings = platform === 'macos' ? 'macOS: System Settings > Privacy & Security > Microphone' : 'Windows: Settings > Privacy & security > Microphone';
      reporter.warn(`the microphone "${options.mic}" records silence: it may be muted, or blocked for desktop apps (${settings})`);
    });
    return tracks;
  };

  /**
   * Starts segment `k` and waits until its screen runs and its other tracks do, or a stop comes.
   * Undefined when the stop came before the screen's first frame. A track that has not started by
   * the stop is left out of the segment (and its file removed).
   */
  const startSegment = async (k: number): Promise<{ tracks: Tracks; segment: Segment } | { tracks: Tracks; segment: undefined }> => {
    const tracks = spawnTracks(k);
    const stamped = await startedWithin(Promise.race([tracks.screen.started, tracks.failed, control.stopped().then(() => undefined)]), 'screen');
    if (stamped === undefined) return { tracks, segment: undefined };
    // the first frame shows the screen as it was a moment before ffmpeg stamped it
    const screenAt = stamped - screenLatency(platform, helper !== undefined);
    const starts: { webcam?: number; mic?: number } = {};
    void tracks.webcam?.started.then((at) => (starts.webcam = toWall(at)), () => {});
    void tracks.mic?.started.then((at) => (starts.mic = toWall(at)), () => {});
    const others = [tracks.webcam && 'webcam', tracks.mic && 'mic'].filter(Boolean).join(' and ');
    if (others !== '') await startedWithin(Promise.race([Promise.all([tracks.webcam?.started, tracks.mic?.started]), tracks.failed, control.stopped()]), others);
    const begun = { ...starts };
    const name = (file: string) => (k === 1 ? file : numbered(file, k));
    for (const track of ['webcam', 'mic'] as const) {
      if (tracks[track] && begun[track] === undefined) reporter.warn(`the ${track} had not started when the recording was stopped; it is left out of the take`);
    }
    return {
      tracks,
      segment: {
        screen: { file: name(FILES.screen), start: screenAt },
        ...(begun.webcam !== undefined && { webcam: { file: name(FILES.webcam), start: begun.webcam } }),
        // the mic's stamp is when its first buffer arrived: its first sample came that much earlier
        ...(begun.mic !== undefined && { mic: { file: name(FILES.mic), start: begun.mic - micLatency(platform) } }),
      },
    };
  };

  /** Removes the files of `tracks` that `segment` does not list (they had not started). */
  const removeUnlisted = (k: number, segment: Segment | undefined) => {
    for (const [track, file] of [['screen', FILES.screen], ['webcam', FILES.webcam], ['mic', FILES.mic]] as const) {
      if (!segment?.[track]) removeQuietly(path(k === 1 ? file : numbered(file, k)));
    }
  };

  /** The screen file's length, to ffmpeg's 10 ms (what joining it end to end uses). */
  const lengthOf = async (file: string, fallback: number) => (await mediaInfo(path(file), 'v').catch(() => undefined))?.seconds || fallback;

  let tracks: Tracks | undefined;
  let k = 1;
  try {
    input = await startInput(
      platform,
      (raw) => {
        // Nothing while paused, nothing after a stop was asked for, nothing over the app's own
        // controls: no take shows the pointer travelling to Stop or its click.
        if (!capturing || control.reason !== undefined || inDeadZone(raw, control.deadZones)) return;
        // a window take: nothing done in another window, nothing that opens over the screen
        if (gate && !gate.allows(raw)) return;
        // the facts about the screen (the content area, a window opening) are no one's input
        if (raw.type !== 'area' && raw.type !== 'window') lastInput = raw.time;
        writer.push(raw);
      },
      (action) => {
        if (action === 'stop') control.request('hotkey');
        else if (action === 'pause') control.toggle();
        else if (action === 'retake') control.retake();
        else if (action === 'next') control.step(1);
        else if (action === 'previous') control.step(-1);
        else control.marker();
      },
    );
    if (input.warning) reporter.warn(input.warning);

    // The screen track's start is the take's clock: input, markers and maxSeconds count from it.
    const first = await startSegment(1);
    tracks = first.tracks;
    if (!first.segment) throw cancelled('the screen track started');
    const screenAt = first.segment.screen.start;
    segments.push(first.segment);
    writer.setStart(screenAt, input.initial(screenAt));
    const begun = first.segment;
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      ...(area.monitor.scale > 0 && { scale: area.monitor.scale }),
      tracks: {
        screen: { file: FILES.screen, start: screenAt },
        ...(begun.webcam && { webcam: { file: FILES.webcam, start: begun.webcam.start } }),
        ...(begun.mic && { mic: { file: FILES.mic, start: begun.mic.start } }),
      },
    } satisfies TakeFile);
    capturing = true;
    reporter.emit({ type: 'recording', dir: rel(dir) });
    // The script: its first step from the take's first frame, then a marker for each move.
    const steps = options.steps ?? [];
    if (steps.length > 0) {
      let step = 0;
      addMarker({ kind: 'step', label: steps[0]! }, screenAt);
      control.onStep = (delta) => {
        const to = step + delta;
        if (to < 0 || to >= steps.length) return;
        step = to;
        addMarker({ kind: 'step', label: steps[to]! }, now());
      };
    }
    // Claude's answer stops the take a little after it; while paused, a little after the resume.
    let claudeStop = false;
    // one timer at a time; a pause clears it (the tail is recorded time), the resume starts it again
    let claudeTimer: ReturnType<typeof setTimeout> | undefined;
    const stopForClaude = () => {
      clearTimeout(claudeTimer);
      claudeTimer = timer(() => control.request('claude'), CLAUDE_TAIL_SECONDS * 1000);
    };
    startTriggers(options.stop, recordedNow, control, () => capturing && tracks !== undefined && tracks.frozen && now() - lastInput >= (options.stop.untilIdleSeconds ?? Infinity), timer);
    // An answer while commands or agents Claude started still run in the background is not the end:
    // their results come in a later answer. Anything new in the session restarts the wait for it.
    /** The tool calls that started background work still running, and their task ids (Claude stops a task by its id). */
    const background = new Set<string>();
    const tasks = new Map<string, string>();
    let waiting = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const quiet = options.stop.untilClaudeQuietSeconds ?? CLAUDE_BACKGROUND_SECONDS;
    const claudeDone = () => {
      claudeStop = true;
      clearTimeout(quietTimer);
      if (capturing) stopForClaude();
    };
    claude?.attach((signal) => {
      if (signal.kind === 'background' && signal.id !== undefined) {
        background.add(signal.id);
        if (signal.task !== undefined) tasks.set(signal.task, signal.id);
      } else if (signal.kind === 'finished') {
        const id = signal.id ?? (signal.task === undefined ? undefined : tasks.get(signal.task));
        if (id !== undefined) background.delete(id);
      } else if (signal.kind !== 'background') addMarker({ kind: signal.kind, ...(signal.label !== undefined && { label: signal.label }) }, signal.time);
      if (claudeStop) return;
      if (signal.kind === 'answer') {
        if (background.size === 0) return claudeDone();
        waiting = true;
      }
      if (!waiting) return;
      clearTimeout(quietTimer);
      quietTimer = timer(() => {
        if (claudeStop) return;
        reporter.warn(`Claude Code left ${background.size === 1 ? 'a command or agent' : `${background.size} commands or agents`} running in the background (a server?): the take ended ${quiet} s after the last step in its session`);
        claudeDone();
      }, quiet * 1000);
    });

    let reason: StopReason;
    let running = true;
    control.pauseRefused = () => segments.length >= MAX_SEGMENTS;
    control.onPauseRefused = () => reporter.warn(`this take cannot pause again: it has ${MAX_SEGMENTS} pieces; stop it and record another`);
    for (;;) {
      const next = await Promise.race([control.stopped(), tracks.failed, control.pauseWanted()]);
      if (next !== 'pause') {
        reason = next;
        break;
      }
      // Pause: every track finishes its file; the take's time stands still. The piece ends where
      // the pause was asked for: the frames the tracks write while they stop (half a second and
      // more) are cut off when the pieces are joined.
      const pausedAt = now();
      capturing = false;
      clearTimeout(claudeTimer);
      await Promise.all(all(tracks).map((capture) => capture.stop()));
      running = false;
      const segment = segments.at(-1)!;
      // in whole frames, so the joined screen is exactly as long as its pieces
      const asked = Math.floor((pausedAt - segment.screen.start) * JOIN_FPS) / JOIN_FPS;
      segment.duration = Math.min(await lengthOf(segment.screen.file, asked), asked);
      if (!paused) {
        // the first pause: the first segment's files get their number too
        paused = true;
        for (const track of ['screen', 'webcam', 'mic'] as const) {
          const entry = segment[track];
          if (!entry) continue;
          renameWhenFree(path(entry.file), path(numbered(entry.file, 1)));
          entry.file = numbered(entry.file, 1);
        }
      }
      writeSegments();
      reporter.emit({ type: 'paused' });
      const after = await Promise.race([control.stopped(), control.resumeWanted()]);
      if (after !== 'resume') {
        reason = after;
        break;
      }
      // Resume: the next segment's tracks start; its input counts on from where the take paused.
      k++;
      reporter.emit({ type: 'resuming' });
      const resumed = await startSegment(k);
      tracks = resumed.tracks;
      running = true;
      if (!resumed.segment) {
        // stopped before the screen started again: that segment is not part of the take
        await Promise.allSettled(all(tracks).map((capture) => capture.stop()));
        running = false;
        removeUnlisted(k, undefined);
        reason = control.reason ?? 'stop';
        break;
      }
      const offset = recordedBefore();
      segments.push(resumed.segment);
      writeSegments();
      writer.setStart(resumed.segment.screen.start - offset, input.initial(resumed.segment.screen.start));
      lastInput = now();
      capturing = true;
      reporter.emit({ type: 'resumed' });
      if (claudeStop) stopForClaude();
    }
    reporter.emit({ type: 'stopping', reason });
    capturing = false;
    finish();
    if (running) {
      await Promise.all(all(tracks).map((capture) => capture.stop()));
      removeUnlisted(k, segments.at(-1));
    }
    writer.close();
    closeEvents();
    if (markersFailed) saveMarkers();
    const last = segments.at(-1)!;
    if (paused && last.duration === undefined) last.duration = await lengthOf(last.screen.file, now() - last.screen.start);
    const has = paused ? await joinTake() : { webcam: last.webcam !== undefined, mic: last.mic !== undefined };
    return {
      dir: rel(dir),
      screen: rel(path(FILES.screen)),
      ...(has.webcam && { webcam: rel(path(FILES.webcam)) }),
      ...(has.mic && { mic: rel(path(FILES.mic)) }),
      events: rel(path(FILES.events)),
      markers: rel(path(FILES.markers)),
      screenSize: size,
      seconds: paused ? recordedBefore() : (tracks.screen.seconds() ?? now() - segments[0]!.screen.start),
      stopReason: reason,
      warnings: reporter.warnings,
    };
  } catch (error) {
    capturing = false;
    finish();
    // The tracks that still run finish their files first; the take folder keeps what was recorded.
    await Promise.allSettled(captures.map((capture) => capture.stop()));
    writer.close();
    closeEvents();
    if (segments.length === 0) {
      removeQuietly(dir); // nothing on screen: no take
      throw error instanceof RecorderError ? error : new RecorderError('capture', `the recording failed: ${message(error)}`, { cause: error });
    }
    const code = error instanceof RecorderError ? error.code : 'capture';
    throw new RecorderError(code, `${message(error)}\n(what was recorded is in ${rel(dir)})`, { cause: error });
  } finally {
    control.onMarker = undefined;
    control.onStep = undefined;
    closeEvents();
  }

  /**
   * Joins the segments into the take's own files, lined up (a new take.json says they start
   * together), marks segments.json joined, and removes the segments' files.
   */
  async function joinTake(): Promise<{ webcam: boolean; mic: boolean }> {
    const has = await joinSegments(dir, segments, { screen: FILES.screen, webcam: FILES.webcam, mic: FILES.mic });
    const start = segments[0]!.screen.start;
    writeJson(path(FILES.take), {
      version: TAKE_VERSION,
      ...(area.monitor.scale > 0 && { scale: area.monitor.scale }),
      tracks: {
        screen: { file: FILES.screen, start },
        ...(has.webcam && { webcam: { file: FILES.webcam, start } }),
        ...(has.mic && { mic: { file: FILES.mic, start } }),
      },
    } satisfies TakeFile);
    writeSegments(true);
    for (const segment of segments) for (const track of ['screen', 'webcam', 'mic'] as const) if (segment[track]) removeQuietly(path(segment[track].file));
    removeQuietly(path('segments.txt'));
    return has;
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

/** Starts the time, file and idle triggers on `timer`, which stops them with the take. `maxSeconds` counts the take's time (`recorded`), not its pauses. */
function startTriggers(
  stop: StopOptions,
  recorded: () => number,
  control: Control,
  idle: () => boolean,
  timer: (callback: () => void, ms: number, repeat?: boolean) => void,
): void {
  const max = stop.maxSeconds;
  if (max !== undefined) timer(() => recorded() >= max && control.request('max-seconds'), MAX_POLL_MS, true);
  if (stop.untilFile !== undefined) {
    const file = resolve(stop.untilFile);
    timer(() => existsSync(file) && control.request('file'), FILE_POLL_MS, true);
  }
  if (stop.untilIdleSeconds !== undefined) timer(() => idle() && control.request('idle'), IDLE_POLL_MS, true);
}

/**
 * macOS asks the app the recorder runs in (the terminal, or Cuttle) for the screen, the camera and the
 * microphone. Screen recording that is not allowed delivers no frame at all, so it fails here, with
 * macOS's prompt shown the first time; a camera or a mic that was refused fails the same way. One not
 * asked for yet is left to macOS, which asks when the capture opens it.
 */
async function checkMacAccess(options: RecordOptions): Promise<void> {
  const { loadDarwin } = await import('./darwin');
  const mac = await loadDarwin();
  const where = (pane: string) => `allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > ${pane}`;
  if (!mac.screenAccess()) {
    mac.requestScreenAccess();
    throw new RecorderError('permission-denied', `macOS does not let this app record the screen: ${where('Screen & System Audio Recording')}, then quit and reopen it`);
  }
  const refused = (kind: 'camera' | 'mic') => ['denied', 'restricted'].includes(mac.mediaAccess(kind));
  if (options.webcam !== undefined && refused('camera')) throw new RecorderError('permission-denied', `macOS does not let this app use the camera: ${where('Camera')}`);
  if (options.mic !== undefined && refused('mic')) throw new RecorderError('permission-denied', `macOS does not let this app use the microphone: ${where('Microphone')}`);
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
  positive('untilClaudeQuietSeconds', options.stop.untilClaudeQuietSeconds);
  const countdown = options.countdownSeconds;
  if (countdown !== undefined && !(Number.isFinite(countdown) && countdown >= 0)) throw invalid('countdownSeconds must be 0 or more');
  const flag = options.stop.untilFile === undefined ? undefined : resolve(options.stop.untilFile);
  if (flag !== undefined && existsSync(flag)) throw invalid(`untilFile ${flag} already exists; delete it first, or the recording would stop at once`);
  const steps = options.steps ?? [];
  if (steps.some((id) => typeof id !== 'string' || id === '') || new Set(steps).size !== steps.length) throw invalid('steps must be different, non-empty step ids');
}

/** Creates the next free `takes/<n>` folder; `mkdir` fails on an existing one, so two recorders never share one. */
export function allocateTake(projectDir: string): string {
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
