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
  phase: 'countdown' | 'recording' | 'paused' | 'resuming' | 'stopping';
  /** When the running stretch started (epoch milliseconds); none while paused. */
  startedAt?: number;
  /** Seconds recorded before it (the take's time stands still while paused). */
  recorded?: number;
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

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
export interface ToolsStatus {
  /** ffmpeg where the OS's PATH has it now (or WinGet's links folder), with its version. */
  ffmpeg?: { path: string; version: string };
  /** A `cuttle` command on that PATH: the app's own copy (`ours`), or another (the repository's, say). */
  command?: { path: string; ours: boolean };
  /** The cuttle skill in Claude Code's config folder: put there by Cuttle, missing, or someone else's folder. */
  skill: { dir: string; state: 'installed' | 'missing' | 'other' };
  /** The app's command folder was just put on the user's PATH: a terminal opened before does not see it. */
  newTerminal?: boolean;
}

/** How motion is set: the OS's "reduce motion", or always on, or always off. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];

/** What the settings window shows. */
export interface SettingsView {
  projectsFolder: string;
  countdown: 0 | 3 | 5;
  /** The camera and microphone a new recording starts with (the picker's last choice). */
  camera?: string;
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  recent: { dir: string; name: string; opened: number }[];
  version: string;
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
  'hud:pause': z.undefined(),
  'hud:resume': z.undefined(),
  /** Puts the take aside and records again with the same settings (the HUD asks for a press held 600 ms). */
  'hud:restart': z.undefined(),
  // editor (editing)
  'project:save': z
    .strictObject({
      raw: z.record(z.string(), z.unknown()),
      /** The hash of the version this one was made from: the write is refused when the file changed since. */
      base: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background']) }),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
  /** The page has written its last edits (`project:closing`): the window may close. */
  'project:closed': z.undefined(),
  /** Brings back the take a restart put aside (its folder inside `takes/.discarded`), as the project's take. */
  'project:undo-restart': z.string().min(1).max(4096),
  /** Opens the settings window. */
  'app:settings': z.undefined(),
  // settings and the first run
  'settings:get': z.undefined(),
  'settings:set': z.strictObject({
    countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).optional(),
    /** A device's name, or null for none. */
    camera: z.string().min(1).max(512).nullable().optional(),
    mic: z.string().min(1).max(512).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    motion: z.enum(MOTIONS).optional(),
  }),
  /** Asks for the projects folder (a folder dialog) and keeps it. */
  'settings:choose-folder': z.undefined(),
  'settings:devices': z.undefined(),
  /** The first run is done: the window closes and the pill shows. */
  'settings:welcomed': z.undefined(),
  'tools:status': z.undefined(),
  /** Looks for ffmpeg again (after `winget install`): found, the app uses it at once. */
  'tools:check': z.undefined(),
  /** Installs the cuttle command (the app's own copy of the CLI) and the Claude skill. */
  'tools:install': z.undefined(),
  'tools:copy': z.string().min(1).max(200),
  /** A recent project, by its folder (only folders in the recent list are accepted). */
  'recent:open': z.string().min(1).max(4096),
  'recent:reveal': z.string().min(1).max(4096),
  'recent:forget': z.string().min(1).max(4096),
  /** Renames a recent project's folder (not while it is open or recording). */
  'recent:rename': z.strictObject({ dir: z.string().min(1).max(4096), name: z.string().trim().min(1).max(120) }),
} as const;

export type Request = keyof typeof REQUESTS;

/** A project file larger than this is not written from the editor (a few hundred scenes are ~100 KB). */
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

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
  'hud:pause': void;
  'hud:resume': void;
  'hud:restart': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: 'outside' | 'suggest' } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  /** The person's version a save conflict could not carry over, written to cuttle.json.draft. */
  'project:draft': void;
  'project:reload': void;
  'project:closed': void;
  'project:undo-restart': void;
  'app:settings': void;
  'settings:get': SettingsView;
  'settings:set': SettingsView;
  'settings:choose-folder': SettingsView;
  /** The cameras and mics this machine has, or why they could not be listed. */
  'settings:devices': { cameras: string[]; mics: string[]; problem?: string };
  'settings:welcomed': void;
  'tools:status': ToolsStatus;
  'tools:check': ToolsStatus;
  /** What is installed now, and what could not be (said for people). */
  'tools:install': { status: ToolsStatus; problem?: string };
  'tools:copy': void;
  'recent:open': void;
  'recent:reveal': void;
  'recent:forget': SettingsView;
  /** The project's new folder, or why it could not be renamed. */
  'recent:rename': { dir: string } | { problem: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
export interface ProjectVersion {
  raw: Record<string, unknown>;
  hash: string;
}

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, else another program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: 'outside' | 'suggest' }) | { issues: string[] };

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
  'project:file': ProjectFileEvent;
  /** The window is about to close: write the last edits, then `project:closed`. */
  'project:closing': Record<string, never>;
  /** The take was restarted: the one before is kept in `discarded` (a folder relative to the project). */
  'project:restarted': { discarded: string };
  'settings:changed': SettingsView;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
}

export type Event = keyof Events;

/** What a window sends with request `R`. */
export type RequestArgument<R extends Request> = z.input<(typeof REQUESTS)[R]>;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
  on<E extends Event>(channel: E, listener: (payload: Events[E]) => void): () => void;
}
