import type { CuttleProject, InputEvent, TranscriptWord } from '@cuttle/project';
import type { MotionView } from './motion/runtime';

/**
 * Contract between the main process and the export page. Pure types and constants: both sides
 * import this file, the preload script repeats the channel names (it cannot import TypeScript).
 */

export type EncoderPreference = 'auto' | 'hardware' | 'software';

/** Why an export failed; the CLI maps these to exit codes (see `ExportError`). */
export type ExportErrorCode = 'invalid-project' | 'missing-file' | 'invalid-media' | 'ffmpeg-missing' | 'render' | 'cancelled';

/** The job's motion pages (absolute paths), which the main process renders: the folder they may read, and each item's page. */
export interface MotionPages {
  root: string;
  /** Scene index → its page. */
  scenes: Record<number, string>;
  /** Overlay index → its page. */
  overlays: Record<number, string>;
  /** Scene index → the page of the transition into it. */
  transitions: Record<number, string>;
}

/** A motion page's frame: premultiplied RGBA, top row first (what the engine draws as `MotionPixels`). */
export interface MotionPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A frame of one showing of a motion item, which the page asks the main process for. */
export interface MotionFrameRequest {
  /** The showing: `scene:<index>`, `overlay:` and the overlay's `ActiveOverlay.key`, or a transition's `ActiveTransition.key`. */
  key: string;
  kind: 'scene' | 'overlay' | 'transition';
  /** Its place in the project's `scenes` or `overlays` (a transition's: the scene it goes into). */
  index: number;
  /** Frame n is n / fps seconds into the showing. */
  frame: number;
  /** Where the showing starts in the video, and how long it lasts (output seconds). */
  start: number;
  duration: number;
  /** The screen recording's size (source px). */
  screen: { width: number; height: number };
  /** An overlay's frame: where the clip under it shows the take. */
  view?: MotionView;
  /** A transition's frame: the outgoing and the incoming frame it draws from (the output's size, opaque). */
  between?: { from: MotionPixels; to: MotionPixels };
}

/** Everything the page needs for one export. Paths are absolute; the page may read only these files. */
export interface ExportJob {
  kind: 'video';
  /** Output size already set to the export format. */
  project: CuttleProject;
  /** The screen recording; absent in a project without clips. */
  screen?: string;
  /** Present when the webcam bubble is on. `offset`: seconds the webcam started after the screen. */
  webcam?: { path: string; offset: number };
  /** Present when the cursor is on and the project has events. */
  events?: InputEvent[];
  /** The take's transcript (source seconds), for the captions; present when the project has one. */
  transcript?: TranscriptWord[];
  /** Burn the captions in (default: the project's `captions.enabled`). */
  captions?: boolean;
  /** Scene index → image of a still scene. */
  stills: Record<number, string>;
  /** Image for `look.background.preset: 'image'`. */
  backgroundImage?: string;
  /** The watermark's image (`look.watermark.image`, else the brand's logo), when it is on. */
  watermarkImage?: string;
  /** Present when the project has motion scenes or overlays. */
  motion?: MotionPages;
  encoder: EncoderPreference;
}

/**
 * Single frames instead of a video (a preview): PNGs of the output frames at `times` (output seconds),
 * written through `ExportHost.writeStill` as `still-<n>` in the order of `times`, and with `sheet` one
 * contact sheet of them (`sheet`), labelled with their times.
 */
export interface StillsJob extends Omit<ExportJob, 'kind' | 'encoder'> {
  kind: 'stills';
  times: number[];
  sheet?: { columns: number };
}

export type PageJob = ExportJob | StillsJob;

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

/** A stills job's result; `width` and `height` are the output size. */
export interface PageStillsSuccess {
  ok: true;
  stills: number;
  /** Per time: the source second the still shows (its frame's most visible clip), null on a still or card. */
  sources: (number | null)[];
  width: number;
  height: number;
  gpu: string;
  totalMs: number;
}

export type PageResult = PageSuccess | PageStillsSuccess | PageFailure;

/** What the preload script exposes to the page as `window.cuttleHost`. */
export interface ExportHost {
  job(): Promise<PageJob>;
  size(path: string): Promise<number>;
  /** Bytes `[start, end)` of a job file. */
  read(path: string, start: number, end: number): Promise<Uint8Array>;
  readFile(path: string): Promise<Uint8Array>;
  /** Writes into the video-only output file at a byte position. */
  write(data: Uint8Array, position: number): Promise<void>;
  progress(done: number, total: number): void;
  /** Writes a PNG of a stills job: `still-<n>` (0-based, in the order of `times`) or `sheet`. */
  writeStill(name: string, data: Uint8Array): Promise<void>;
  /** A motion item's frame (frames of one showing only go forward; an earlier one starts it again). */
  motionFrame(request: MotionFrameRequest): Promise<MotionPixels>;
  /** A showing is over: its page closes. */
  motionDone(key: string): void;
}

/** IPC channel names; keep electron/export-page/preload.cjs in sync. */
export const CHANNELS = {
  job: 'cuttle-export:job',
  size: 'cuttle-export:size',
  read: 'cuttle-export:read',
  readFile: 'cuttle-export:read-file',
  write: 'cuttle-export:write',
  progress: 'cuttle-export:progress',
  writeStill: 'cuttle-export:write-still',
  motionFrame: 'cuttle-export:motion-frame',
  motionDone: 'cuttle-export:motion-done',
} as const;
