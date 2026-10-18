import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { RecorderError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** The error for an ffmpeg that is not installed (spawn failed with ENOENT). */
export function ffmpegMissing(cause: Error): RecorderError {
  return new RecorderError(
    'ffmpeg-missing',
    `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg) or set CUTTLE_FFMPEG to its path.`,
    { cause },
  );
}

/** Milliseconds ffmpeg gets to finish its file after "q" before it is killed. */
const STOP_TIMEOUT_MS = 10_000;
/** Lines of stderr kept for an error message. */
const STDERR_TAIL_LINES = 12;

/**
 * ffmpeg's input dump: `Duration: N/A, start: 1792189686.207373, bitrate: N/A`. With
 * `-use_wallclock_as_timestamps 1` the start is the first packet's wall clock (Unix seconds).
 */
const INPUT_START = /Duration: [^,]+, start: (\d+(?:\.\d+)?)/;
/** The progress report, `… time=00:00:03.13 …`; the last one is the output's length. */
const PROGRESS_TIME = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

export interface CaptureProcess {
  /** ffmpeg's process id (undefined when it could not be started). */
  readonly pid: number | undefined;
  /** The feeder's process id, when one feeds ffmpeg. */
  readonly feederPid?: number;
  /** Wall-clock seconds (Unix epoch) of the first captured frame or sample. */
  readonly started: Promise<number>;
  /** Resolves when ffmpeg exits after `stop()`; rejects when it fails or exits on its own. */
  readonly exited: Promise<void>;
  /** Every stderr line (progress reports included), for filters that log what they detect. */
  onLine(listener: (line: string) => void): void;
  /** Length of the output so far, from ffmpeg's last progress report. */
  seconds(): number | undefined;
  /** Asks ffmpeg to finish the file ("q" on stdin); kills it if it has not exited after 10 s (the fragmented MP4 stays readable). */
  stop(): Promise<void>;
}

/** A process that feeds ffmpeg: its stdout becomes ffmpeg's file descriptor 3 (`-i /dev/fd/3`). */
export interface Feeder {
  command: string;
  args: readonly string[];
}

/** A feeder's exit code that means the OS does not allow the capture (cuttle-capture: screen recording). */
const FEEDER_DENIED = 3;

/**
 * Starts one capture process. `name` labels its errors ("screen", "webcam", "mic"). With a `feeder`,
 * ffmpeg reads that process's output; the feeder ends with ffmpeg, and its own failure is the one reported.
 * `onStdout` takes what ffmpeg writes to its stdout (the mic's samples), as it comes.
 */
export function spawnCapture(name: string, args: readonly string[], feeder?: Feeder, onStdout?: (chunk: Buffer) => void): CaptureProcess {
  const feed = feeder && spawn(feeder.command, [...feeder.args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const feedTail: string[] = [];
  feed?.stderr?.setEncoding('utf8');
  feed?.stderr?.on('data', (chunk: string) => feedTail.push(...chunk.split(/\r?\n/).filter((line) => line.trim() !== '')));
  feed?.on('error', () => {}); // a feeder that cannot start ends its pipe: ffmpeg reports that
  const feedExit = feed && new Promise<number | null>((resolve) => feed.once('close', (code) => resolve(code)));
  // stdin for "q", stdout for what the caller reads (else nothing), stderr for the log; a feeder's pipe as file descriptor 3
  const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { stdio: ['pipe', onStdout ? 'pipe' : 'ignore', 'pipe', ...(feed ? [feed.stdout] : [])], windowsHide: true }) as ChildProcessByStdio<Writable, Readable | null, Readable>;
  // read as it comes: a full pipe would stall ffmpeg
  if (onStdout) child.stdout?.on('data', onStdout);
  // ffmpeg holds the pipe now: this process lets go of it, so the feeder sees ffmpeg's end
  feed?.stdout?.destroy();
  const listeners: ((line: string) => void)[] = [];
  const tail: string[] = [];
  let partial = '';
  let seconds: number | undefined;
  let stopping = false;
  let killed = false;

  let resolveStarted!: (start: number) => void;
  let rejectStarted!: (error: Error) => void;
  const started = new Promise<number>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  started.catch(() => {}); // `exited` reports the failure; a caller may never await `started`

  const line = (text: string) => {
    if (text.trim() === '') return;
    const start = INPUT_START.exec(text);
    if (start) resolveStarted(Number(start[1]));
    const time = PROGRESS_TIME.exec(text);
    if (time) seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    else {
      tail.push(text); // progress reports say nothing about a failure
      if (tail.length > STDERR_TAIL_LINES) tail.shift();
    }
    for (const listener of listeners) listener(text);
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const parts = (partial + chunk).split(/\r\n|\r|\n/);
    partial = parts.pop() ?? '';
    parts.forEach(line);
  });
  // Without a listener, writing "q" to an ffmpeg that already exited throws EPIPE.
  child.stdin.on('error', () => {});

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      const failure =
        error.code === 'ENOENT'
          ? ffmpegMissing(error)
          : new RecorderError('capture', `the ${name} capture could not start: ${error.message}`, { cause: error });
      rejectStarted(failure);
      reject(failure);
    });
    child.on('close', (code) => {
      line(partial);
      partial = '';
      // a feeder still running is done now; one that ended first says why the capture failed
      if (feed && feed.exitCode === null && feed.signalCode === null) feed.kill();
      void (feedExit ?? Promise.resolve(null)).then((fed) => {
        const what = stopping ? 'failed while stopping' : 'stopped unexpectedly';
        const failure =
          fed === FEEDER_DENIED
            ? new RecorderError(
                'permission-denied',
                'macOS does not let this app record the screen: allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > Screen & System Audio Recording, then quit and reopen it',
              )
            : fed !== null && fed !== 0 && !stopping
              ? new RecorderError('capture', `the ${name} capture ${what}:\n${feedTail.slice(-STDERR_TAIL_LINES).join('\n') || `its feeder exited with code ${fed}`}`)
              : new RecorderError('capture', `the ${name} capture ${what} (ffmpeg exit code ${code}):\n${tail.join('\n')}`);
        rejectStarted(failure);
        // After "q", ffmpeg exits with 0; a kill leaves a readable fragmented file. Any exit before
        // stop() is a failure, even with code 0: a capture only ends when asked to.
        if (stopping && (code === 0 || killed)) resolve();
        else reject(failure);
      });
    });
  });
  exited.catch(() => {}); // surfaced through `started`, `stop()` or the caller's own await

  return {
    pid: child.pid,
    ...(feed?.pid !== undefined && { feederPid: feed.pid }),
    started,
    exited,
    onLine: (listener) => void listeners.push(listener),
    seconds: () => seconds,
    stop() {
      if (child.exitCode === null && !stopping) {
        stopping = true;
        child.stdin.end('q');
        const timer = setTimeout(() => {
          killed = true;
          child.kill();
        }, STOP_TIMEOUT_MS);
        exited.finally(() => clearTimeout(timer)).catch(() => {});
      }
      return exited;
    },
  };
}
