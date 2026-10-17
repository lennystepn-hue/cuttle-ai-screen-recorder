// The IPC contract between the main process and the windows: every channel with the zod schema of
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { PickedTarget, PickerDisplay, PickerWindow, RecordChoices } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, Rect, RecordChoices } from './recording';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
export const EXPORT_TARGETS = ['project', ...EXPORT_FORMATS] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export const ENCODERS = ['auto', 'hardware', 'software'] as const;

/** The origin of the media protocol in an editor window: `cuttle-media://project/<path in the project>`. */
export const MEDIA_ORIGIN = 'cuttle-media://project';

/** What the editor needs to open its project; the rest it reads through the media protocol. */
export interface ProjectInfo {
  dir: string;
  name: string;
  /** cuttle.json as written (parse it with `parseProject`) and the SHA-256 of its bytes. */
  raw: Record<string, unknown>;
  hash: string;
  /** Seconds after the screen track that the webcam and mic started (take.json); 0 when unknown. */
  offsets: { webcam: number; mic: number };
}

/** The editor's background media: a 720p proxy of the screen track, a thumbnail strip, the mic's peaks. */
export interface MediaState {
  /** Counts the changes, so a window keeps the newest of an answer and an event that cross. */
  seq: number;
  proxy: { state: 'none' | 'working' | 'ready' | 'failed'; progress?: number; path?: string; message?: string };
  thumbnails: {
    state: 'none' | 'working' | 'ready' | 'failed';
    path?: string;
    interval?: number;
    width?: number;
    height?: number;
    count?: number;
    columns?: number;
    message?: string;
  };
  peaks: { state: 'none' | 'working' | 'ready' | 'failed'; path?: string; rate?: number; message?: string };
}

export interface ExportProgress {
  format: ExportTarget;
  /** 0-based position of this format in the job, and the job's number of formats. */
  position: number;
  formats: number;
  done: number;
  total: number;
  elapsed: number;
}

export interface ExportFile {
  format: ExportTarget;
  out: string;
  seconds: number;
  bytes: number;
}

export type ExportEnd =
  | { state: 'done'; files: ExportFile[] }
  | { state: 'cancelled'; files: ExportFile[] }
  | { state: 'failed'; files: ExportFile[]; format: ExportTarget; code: string; message: string };

/** What a picker shows: its display, the windows on it, the devices and the bar's choices. */
export interface PickerSetup {
  display: PickerDisplay;
  windows: PickerWindow[];
  cameras: string[];
  mics: string[];
  choices: RecordChoices;
  /** Whether this picker is on the display the pointer is on (it shows the bar). */
  active: boolean;
  countdown: number;
  /** Why recording cannot start (no ffmpeg, the recorder failed, an unknown display), said for people: Record is off. */
  problem?: string;
  /** What is worth knowing first (little disk space), said for people: Record stays on. */
  warning?: string;
  /** Cameras and mics are still being listed (DirectShow takes a moment): the bar says so. */
  listingDevices?: boolean;
}

/** What the HUD shows. */
export interface HudState {
  phase: 'countdown' | 'recording' | 'stopping';
  /** When the take started (epoch milliseconds). */
  startedAt?: number;
  markers: number;
  /** A warning in a few words ("Mic is silent: muted?"), or "Stopping…". */
  message?: string;
  /** The whole warning, for the tooltip. */
  detail?: string;
  /** `warn`: a warning (amber); `info`: a state ("Stopping…"). */
  tone?: 'warn' | 'info';
}

/** What the main process is doing to a project, shown in its editor's title bar. */
export interface ProjectStatus {
  text?: string;
  /** `working`: cutting the take (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const deviceName = z.string().min(1).max(512);

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  'media:state': z.undefined(),
  'media:retry': z.undefined(),
  'export:targets': z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
    encoder: z.enum(ENCODERS),
  }),
  'export:cancel': z.undefined(),
  // pill
  'pill:recent': z.undefined(),
  'pill:open': z.strictObject({ dir: z.string().min(1).max(4096) }).optional(),
  'pill:hide': z.undefined(),
  'pill:menu': z.undefined(),
  'pill:record': z.undefined(),
  // editor (recording)
  'project:record': z.undefined(),
  'project:takes': z.undefined(),
  // cut the take with suggest again, after it failed
  'project:cut': z.undefined(),
  // picker
  'picker:setup': z.undefined(),
  'picker:hover': z.undefined(),
  'picker:choices': z.strictObject({
    camera: deviceName.optional(),
    mic: deviceName.optional(),
    stop: z.enum(['none', 'claude', 'idle']),
    claudeFolder: z.string().min(1).max(4096).optional(),
  }),
  'picker:record': z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('screen'), display: z.number().int() }),
    z.strictObject({ kind: z.literal('window'), display: z.number().int(), window: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal('region'), display: z.number().int(), rect }),
  ]),
  'picker:cancel': z.undefined(),
  'picker:claude-folder': z.undefined(),
  'picker:retry': z.undefined(),
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
} as const;

export type Request = keyof typeof REQUESTS;

/** What each request answers. */
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'media:state': MediaState;
  'media:retry': void;
  /** Where each format would be written, and when an export already there was made (epoch ms). */
  'export:targets': { format: ExportTarget; out: string; modified?: number }[];
  'export:start': { out: string };
  'export:cancel': void;
  'pill:recent': { dir: string; name: string; opened: number }[];
  'pill:open': void;
  'pill:hide': void;
  'pill:menu': void;
  'pill:record': void;
  'project:record': void;
  'project:takes': void;
  'project:cut': void;
  'picker:setup': PickerSetup | undefined;
  'picker:hover': void;
  'picker:choices': void;
  'picker:record': void;
  'picker:cancel': void;
  'picker:claude-folder': string | undefined;
  'picker:retry': void;
  'hud:stop': void;
  'hud:marker': void;
}

/** Events (main → window). */
export interface Events {
  'media:state': MediaState;
  'export:progress': ExportProgress;
  'export:end': ExportEnd;
  'pill:recent': Responses['pill:recent'];
  'picker:open': PickerSetup;
  /** The cameras and mics, listed after the pickers opened (DirectShow is slow). */
  'picker:devices': Pick<PickerSetup, 'cameras' | 'mics' | 'choices'>;
  'picker:active': { display: number };
  'picker:choices': RecordChoices;
  'countdown:tick': { seconds: number };
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
}

export type Event = keyof Events;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
  on<E extends Event>(channel: E, listener: (payload: Events[E]) => void): () => void;
}
