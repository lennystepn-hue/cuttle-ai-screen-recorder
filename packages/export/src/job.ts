import type { CuttleProject, InputEvent } from '@cuttle/project';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
 * import this file, the preload script repeats the channel names (it cannot import TypeScript).
 */

export type EncoderPreference = 'auto' | 'hardware' | 'software';

/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
  /** Output size already set to the export format. */
  project: CuttleProject;
  screen: string;
  /** Present when the webcam bubble is on. `offset`: seconds the webcam started after the screen. */
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
  events?: InputEvent[];
  /** Scene index → image of a still scene. */
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  encoder: EncoderPreference;
}

export interface PageTimings {
  /** Waiting for decoded frames and still images. */
  decodeMs: number;
  /** Timeline and renderer calls (GPU work runs on asynchronously). */
  renderMs: number;
  /** Handing frames to the encoder, including its back-pressure and the GPU finishing the frame. */
  encodeMs: number;
  /** Writing the moov and the last chunks. */
  finalizeMs: number;
  totalMs: number;
}

export interface PageSuccess {
  ok: true;
  frames: number;
  codec: string;
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software';
  bitrate: number;
  /** WebGL renderer string, e.g. "ANGLE (AMD, … Direct3D11 …)"; SwiftShader means no GPU. */
  gpu: string;
  timings: PageTimings;
}

export interface PageFailure {
  ok: false;
  code: ExportErrorCode;
  message: string;
}

export type PageResult = PageSuccess | PageFailure;

/** What the preload script exposes to the page as `window.cuttleHost`. */
export interface ExportHost {
  job(): Promise<ExportJob>;
  size(path: string): Promise<number>;
  /** Bytes `[start, end)` of a job file. */
  read(path: string, start: number, end: number): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes into the video-only output file at a byte position. */
  write(data: Uint8Array, position: number): Promise<void>;
  progress(done: number, total: number): void;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
export const CHANNELS = {
  job: 'cuttle-export:job',
  size: 'cuttle-export:size',
  read: 'cuttle-export:read',
  readFile: 'cuttle-export:read-file',
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
} as const;
