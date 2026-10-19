// Messages between the main process and the media worker (a utility process running ffmpeg), and
// the ffmpeg arguments of each job: pure, so they are tested without ffmpeg.

/** A 720p copy of the screen track with a key frame every half second, for playback and scrubbing. */
export interface ProxyJob {
  job: 'proxy';
  input: string;
  output: string;
}

/** Small frames of a video every `interval` seconds, tiled `columns` wide into one JPEG. */
export interface ThumbnailsJob {
  job: 'thumbnails';
  input: string;
  output: string;
}

/** The mic's loudness: one byte (0–255) per 1/`rate` seconds. */
export interface PeaksJob {
  job: 'peaks';
  input: string;
  output: string;
}

/** `suggest` on a project (`input`: its folder): it decodes the whole take, so it runs here, not in the main process. */
export interface SuggestJob {
  job: 'suggest';
  input: string;
  output: string;
}

/** Transcribes a project's mic (`input`: its folder) into its take's transcript.json, not linked yet. */
export interface TranscribeJob {
  job: 'transcribe';
  input: string;
  output: string;
  model: string;
  language: string;
}

/** Links `transcript` (and `cleanMic`) and cuts the filler words and pauses of a project (`input`: its folder), in one write. */
export interface SpeechEditsJob {
  job: 'speech-edits';
  input: string;
  output: string;
  transcript: string;
  cleanMic?: string;
}

/** Reads the screen's text inside a project's clips (`input`: its folder) into its take's screen-text.jsonl, not linked yet. */
export interface ReadScreenJob {
  job: 'read-screen';
  input: string;
  output: string;
}

/** Links `link` (the screen's text just read) and masks what the screen showed and the notifications, in one write. */
export interface PrivacyEditsJob {
  job: 'privacy-edits';
  input: string;
  output: string;
  link?: string;
  /** The settings' "Always mask", added to the project's words. */
  words: string[];
}

/** Fits a project (`input`: its folder) to `seconds` of video where it rests, or takes the fit out (none). */
export interface FitLengthJob {
  job: 'fit-length';
  input: string;
  output: string;
  seconds?: number;
}

/** What a length fit did, in output seconds: the length asked for, the video's length before and after, whether it fits. */
export interface LengthReport {
  target: number;
  before: number;
  length: number;
  reached: boolean;
  /** Whether cuttle.json changed (it already fitted, or the fit was the same: not). */
  written: boolean;
}

export type MediaJob = ProxyJob | ThumbnailsJob | PeaksJob | SuggestJob | TranscribeJob | SpeechEditsJob | ReadScreenJob | PrivacyEditsJob | FitLengthJob;

/** What a job answers besides being done: the thumbnails' layout, or a length fit's report. */
export type JobResult = ThumbnailsMeta | LengthReport;

export interface ThumbnailsMeta {
  interval: number;
  width: number;
  height: number;
  count: number;
  columns: number;
}

export type WorkerRequest = { id: number; cancel?: false } & MediaJob;
export type WorkerCancel = { id: number; cancel: true };
export type WorkerReply =
  // `preparing`: the OCR is being prepared, which takes long (read-screen: macOS's first use of Vision)
  | { id: number; progress: number; preparing?: boolean }
  | { id: number; done: true; meta?: JobResult }
  | { id: number; error: string; cancelled?: boolean; code?: string };

/** Height of the proxy (the screen track is scaled down to it, never up). */
export const PROXY_HEIGHT = 720;
/** Seconds between the proxy's key frames: above 6× the player shows key frames only. */
export const PROXY_KEY_SECONDS = 0.5;
export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;
export const THUMB_COLUMNS = 20;
/** At most this many thumbnails per take; longer takes get a longer interval. */
export const MAX_THUMBS = 600;
export const PEAKS_RATE = 100;
/** Samples per second the mic is decoded at for its peaks. */
export const PEAKS_SAMPLE_RATE = 8000;

export function proxyArgs(input: string, output: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0', '-an',
    // The proxy keeps the take's timestamps, so a source second is the same frame in both.
    '-copyts', '-fps_mode', 'passthrough',
    '-vf', `scale=-2:'min(${PROXY_HEIGHT},ih)':flags=bilinear,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-force_key_frames', `expr:gte(t,n_forced*${PROXY_KEY_SECONDS})`,
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
}

/** The thumbnail interval for a take of `seconds`: 1 s, longer when it would make more than `MAX_THUMBS`. */
export function thumbnailInterval(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / MAX_THUMBS));
}

export function thumbnailsMeta(seconds: number): ThumbnailsMeta {
  const interval = thumbnailInterval(seconds);
  const count = Math.max(1, Math.ceil(seconds / interval));
  return { interval, width: THUMB_WIDTH, height: THUMB_HEIGHT, count, columns: Math.min(THUMB_COLUMNS, count) };
}

export function thumbnailsArgs(input: string, output: string, meta: ThumbnailsMeta): string[] {
  const rows = Math.ceil(meta.count / meta.columns);
  return [
    '-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0', '-an',
    // One frame per interval (the first at 0), letterboxed into 160×90, tiled in reading order.
    '-vf',
    [
      `fps=1/${meta.interval}:round=down`,
      `scale=${meta.width}:${meta.height}:force_original_aspect_ratio=decrease:flags=bilinear`,
      `pad=${meta.width}:${meta.height}:(ow-iw)/2:(oh-ih)/2:color=0x08080a`,
      `tile=${meta.columns}x${rows}:color=0x08080a`,
    ].join(','),
    '-frames:v', '1', '-q:v', '5',
    '-f', 'image2', '-update', '1', output,
  ];
}

export function peaksArgs(input: string): string[] {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-map', '0:a:0', '-ac', '1', '-ar', String(PEAKS_SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
}

/**
 * Folds 16-bit mono samples into peaks: the loudest sample of each `PEAKS_SAMPLE_RATE / PEAKS_RATE`
 * samples, 0–255. `carry` keeps a window that a chunk boundary split.
 */
export class PeakFolder {
  private readonly window = PEAKS_SAMPLE_RATE / PEAKS_RATE;
  private filled = 0;
  private peak = 0;
  private odd: number | undefined;
  readonly peaks: number[] = [];

  push(chunk: Uint8Array): void {
    let i = 0;
    if (this.odd !== undefined && chunk.length > 0) {
      this.sample((this.odd | (chunk[0]! << 8)) << 16 >> 16);
      this.odd = undefined;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample((chunk[i]! | (chunk[i + 1]! << 8)) << 16 >> 16);
    if (i < chunk.length) this.odd = chunk[i];
  }

  private sample(value: number): void {
    this.peak = Math.max(this.peak, Math.abs(value));
    if (++this.filled === this.window) this.flush();
  }

  private flush(): void {
    this.peaks.push(Math.min(255, Math.round((this.peak / 32768) * 255)));
    this.filled = 0;
    this.peak = 0;
  }

  /** The peaks, the last window counted even when it is short. */
  finish(): Uint8Array {
    if (this.filled > 0) this.flush();
    return Uint8Array.from(this.peaks);
  }
}

/** The fraction done from ffmpeg's `-progress` output (`out_time_us=…`), for a job over `seconds`. */
export function progressOf(line: string, seconds: number): number | undefined {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match || !(seconds > 0)) return undefined;
  return Math.min(1, Number(match[1]) / 1e6 / seconds);
}
