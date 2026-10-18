// The IPC contract between the main process and the windows: every channel with the zod schema of
// what a window may send. The main process checks each request against it; the preloads expose only
// their window's channels.
import { z } from 'zod';
import type { ParamDeclaration } from '@cuttle/export/motion-params';
import type { Chapter } from '@cuttle/timeline';
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import { ID_PATTERN, SCRIPT_MAX_STEPS, STEP_NOTE_MAX, STEP_TITLE_MAX } from '@cuttle/project';
import type { LengthReport } from './media-jobs';
import type { PickedTarget, PickerDisplay, PickerWindow, PrompterState, RecordChoices, ScriptStep } from './recording';

export type { PickedTarget, PickerDisplay, PickerWindow, PrompterState, Rect, RecordChoices, ScriptStep } from './recording';

export const EXPORT_FORMATS = ['16:9', '1:1', '9:16'] as const;
/** What an export makes: the project's own output size, or a preset. */
export const EXPORT_TARGETS = ['project', ...EXPORT_FORMATS] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
export const ENCODERS = ['auto', 'hardware', 'software'] as const;
/** Subtitle files an export can write next to the video (as @cuttle/export's SUBTITLE_FORMATS). */
export const SUBTITLE_FILES = ['srt', 'vtt'] as const;

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
  /** The subtitle files written next to it. */
  subtitles?: string[];
  /** The chapters in it, from the script's steps. */
  chapters?: Chapter[];
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
  /** The script the take records with: the project's (`script` in cuttle.json), or what was typed for it since. */
  script: ScriptStep[];
}

/** What the HUD shows. */
export interface HudState {
  phase: 'countdown' | 'recording' | 'paused' | 'resuming' | 'stopping';
  /** When the running stretch started (epoch milliseconds); none while paused. */
  startedAt?: number;
  /** Seconds recorded before it (the take's time stands still while paused). */
  recorded?: number;
  markers: number;
  /** How often the mistake key was pressed (its markers are not counted in `markers`). */
  retakes?: number;
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
  /** `working`: cutting the take or transcribing it (a spinner); `failed`: it could not (Try again); `recording`: a new take records (the player pauses). */
  state?: 'working' | 'failed' | 'recording';
  /** What Try again does after a failure: cut the take again (the default), transcribe it again, or read the screen again. */
  retry?: 'cut' | 'speech' | 'privacy';
}

/** The speech models (as @cuttle/core's MODEL_NAMES; a contract test keeps them alike). */
export const SPEECH_MODEL_NAMES = ['base', 'small', 'large-v3-turbo-q5_0'] as const;
export type SpeechModelName = (typeof SPEECH_MODEL_NAMES)[number];
export const SPEECH_LANGUAGES = ['auto', 'de', 'en'] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

/** The speech models on this computer, and a download under way or the last one that failed. */
export interface SpeechStatus {
  /** Where the models are kept. */
  dir: string;
  models: { name: SpeechModelName; label: string; bytes: number; note: string; installed: boolean }[];
  /** Whether ffmpeg can transcribe (its `whisper` filter); undefined without ffmpeg. */
  whisper?: boolean;
  download?: { name: SpeechModelName; received: number; total: number };
  failure?: { name: SpeechModelName; message: string };
}

/** The tools around the app: ffmpeg, and for Claude Code the cuttle command and the skill. */
export interface ToolsStatus {
  /** ffmpeg where the OS's PATH has it now (or WinGet's links folder), with its version. */
  ffmpeg?: { path: string; version: string };
  /**
   * A `cuttle` command on that PATH: the app's own (`ours`; `moved`: written for another copy of
   * the app, so Update), or another (the repository's, say).
   */
  command?: { path: string; ours: boolean; moved?: boolean };
  /** The cuttle skill in Claude Code's config folder: put there by Cuttle, missing, or someone else's folder. */
  skill: { dir: string; state: 'installed' | 'missing' | 'other' };
  /** The app's command folder was just put on the user's PATH: a terminal opened before does not see it. */
  newTerminal?: boolean;
  /** What the last install could not do, per tool, said for people. */
  problems?: { command?: string; skill?: string };
  /** Off Windows: the shims are written but their folder is not on PATH; the line for the shell profile. */
  pathLine?: string;
}

/** The words always masked (the settings' "Always mask"): how long each, and how many. */
export const PRIVACY_WORD_MAX = 120;
export const PRIVACY_WORDS_MAX = 50;

/** How motion is set: the OS's "reduce motion", or always on, or always off. */
export const MOTIONS = ['system', 'reduce', 'full'] as const;
export type Motion = (typeof MOTIONS)[number];
/** The settings window's pages, in its sidebar's order. */
export const SETTINGS_PAGES = ['recording', 'speech', 'privacy', 'claude', 'projects', 'general'] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/** What the settings window shows. */
export interface SettingsView {
  projectsFolder: string;
  countdown: 0 | 3 | 5;
  /** The camera and microphone a new recording starts with (the picker's last choice). */
  camera?: string;
  mic?: string;
  launchAtLogin: boolean;
  motion: Motion;
  /** Transcribing a take after its cut: the model (or off) and the language spoken. */
  speech: { model: SpeechModelName | 'off'; language: SpeechLanguage };
  /** After a take's cut: read the screen's text to mask what it showed, and the words always masked. */
  privacy: { read: boolean; words: string[] };
  /** `open`: the project is open in Cuttle, here (`here`) or on the computer named. */
  recent: { dir: string; name: string; opened: number; open?: string }[];
  version: string;
}

/** The params a motion page declares (its `cuttle-params`), and what is wrong with the declaration. */
export interface MotionParams {
  params: ParamDeclaration[];
  issues: string[];
}

/** What a motion item's page is doing in the editor's preview, and what it said (as @cuttle/export's MotionStatus). */
export interface MotionStatusView {
  /** `scenes[2]` or `overlays[0]`. */
  item: string;
  src: string;
  state: 'loading' | 'ready' | 'failed';
  failure?: string;
  errors: string[];
  console: string[];
}

/** A motion frame for the player: the number of what drew it, and its pixels (none when the player's own copy is still right). */
export type MotionFrameAnswer = { id: number; pixels?: { width: number; height: number; data: Uint8Array } } | null;

/** Frames across a motion scene for its block on the timeline (none when the editor's strip is still right). */
export type MotionStripAnswer = { id: number; frames?: { width: number; height: number; data: Uint8Array }[] } | null;

/** The motion templates the editor offers (as @cuttle/motion-kit has them). */
export const MOTION_TEMPLATE_NAMES = MOTION_TEMPLATES.map((template) => template.name) as [string, ...string[]];

/** The music templates the editor offers (as @cuttle/motion-kit has them). */
export const MUSIC_TEMPLATE_NAMES = MUSIC_TEMPLATES.map((template) => template.name) as [string, ...string[]];

/** What the music page told about its music (as @cuttle/export's MusicInfo). */
export interface MusicInfoView {
  bpm?: number;
  key?: string;
  sections?: { start: number; end: number; name: string; energy?: number }[];
}

/**
 * The editor's soundtrack (its music and sounds): `none` without music or sounds, `rendering` while it
 * renders (`key` is then the last one rendered, which plays meanwhile), `ready`, or `failed`.
 */
export interface SoundStatusView {
  state: 'none' | 'rendering' | 'ready' | 'failed';
  /** The project version it is for. */
  version?: number;
  /** The rendered soundtrack to ask for (`sound:soundtrack`). */
  key?: string;
  info?: MusicInfoView | null;
  renderMs?: number;
  failure?: string;
  errors: string[];
  console: string[];
  /** Sounds that could not play. */
  skipped: string[];
  /** The sounds the motion pages asked for (`cuttle.sound`), in output seconds, with the item's name. */
  pageSounds?: PageSoundView[];
}

export interface PageSoundView {
  at: number;
  sound: string;
  item: string;
}

/** A rendered soundtrack: each stem interleaved stereo float at `rate`, the music's peaks for its lane, the speech it goes down for. */
export type SoundtrackAnswer = {
  key: string;
  rate: number;
  music: Float32Array;
  effects: Float32Array;
  /** The music's peaks, 50 a second, 0–255. */
  peaks: Uint8Array;
  speech: { start: number; end: number }[];
} | null;

/** A saved brand kit, as the Look tab lists it: its name, and its accent, background and heading font for its chip. */
export interface BrandView {
  name: string;
  accent: string;
  background: { preset: string; color?: string; colors?: string[] };
  font: string;
}

/** What applying a kit sets, its files already copied into the project: the whole theme, and the look's brand parts. */
export interface BrandApplied {
  theme: Record<string, unknown>;
  background: Record<string, unknown>;
  frame: { style: string };
  cursor: { style: string; color: string };
}

const rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });
const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
/** A frame (premultiplied RGBA, top row first) whose bytes fit its size. */
const pixels = z
  .strictObject({ width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), data: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'bytes') })
  .refine((frame) => frame.data.byteLength === frame.width * frame.height * 4, { message: 'the bytes do not fit the size' });
/** A motion frame the player asks for (as @cuttle/export's MotionFrameRequest); a transition's comes with the two frames it goes between. */
const motionRequest = z.strictObject({
  key: z.string().min(1).max(200),
  kind: z.enum(['scene', 'overlay', 'transition']),
  index: z.number().int().nonnegative().max(100_000),
  frame: z.number().int().nonnegative().max(100_000_000),
  start: z.number().finite().nonnegative(),
  duration: z.number().finite().positive(),
  screen: z.strictObject({ width: z.number().int().positive().max(32_768), height: z.number().int().positive().max(32_768) }),
  view: z
    .strictObject({
      source: z.number().finite().nullable(),
      zoom: box.nullable(),
      content: box.nullable(),
      cursor: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).nullable(),
    })
    .optional(),
  between: z.strictObject({ from: pixels, to: pixels }).optional(),
});
const deviceName = z.string().min(1).max(512);

/** Requests (window → main), each with the schema of its argument. */
export const REQUESTS = {
  // editor
  'project:info': z.undefined(),
  'project:reveal': z.string().max(4096).optional(),
  /** Text for the clipboard: the chapters for a YouTube description. */
  'export:copy': z.string().max(20_000),
  'media:state': z.undefined(),
  'media:retry': z.undefined(),
  'export:targets': z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
  'export:start': z.strictObject({
    formats: z.array(z.enum(EXPORT_TARGETS)).min(1).max(4),
    encoder: z.enum(ENCODERS),
    /** Burn the subtitles in (default: the project's `captions.enabled`). */
    captions: z.boolean().optional(),
    /** Subtitle files next to each video. */
    subtitles: z.array(z.enum(SUBTITLE_FILES)).max(2).optional(),
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
  // transcribe the take's mic (after it failed, or a model came later) and cut its filler words and pauses
  'project:transcribe': z.undefined(),
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
  /** The script as typed so far (a step being written may have no title yet). */
  'picker:script': z
    .array(
      z.strictObject({
        id: z.string().regex(ID_PATTERN),
        title: z.string().max(STEP_TITLE_MAX),
        note: z.string().max(STEP_NOTE_MAX).optional(),
      }),
    )
    .max(SCRIPT_MAX_STEPS),
  // prompter
  'prompter:next': z.undefined(),
  'prompter:previous': z.undefined(),
  /** The height its content needs (DIP, its margins included): the window takes it. */
  'prompter:size': z.strictObject({ height: z.number().finite().positive().max(4000) }),
  // HUD
  'hud:stop': z.undefined(),
  'hud:marker': z.undefined(),
  /** The mistake key: Cuttle cuts back to the pause before it. */
  'hud:retake': z.undefined(),
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
  'project:import-image': z.strictObject({ purpose: z.enum(['still', 'background', 'logo', 'watermark']) }),
  /** The brand kits saved on this computer. */
  'brand:list': z.undefined(),
  /** Saves the project's brand, as this version of it has it, as a kit (a kit of that name is replaced). */
  'brand:save': z
    .strictObject({ name: z.string().trim().min(1).max(80), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** Copies a kit's files into the project and answers what applying it sets (the page makes it one edit). */
  'brand:apply': z.string().trim().min(1).max(80),
  'brand:remove': z.string().trim().min(1).max(80),
  /** The colours of the take's screen or of the brand's logo, for the background. */
  'background:palette': z.strictObject({ from: z.enum(['take', 'logo']), logo: z.string().min(1).max(4096).optional() }),
  /** The desktop's wallpaper, copied into the project's images/ for the background. */
  'background:wallpaper': z.undefined(),
  'project:draft': z.strictObject({ raw: z.record(z.string(), z.unknown()) }).refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'cuttle.json is too large'),
  /** The page asks to be loaded anew (another take): a page cannot reload itself (navigation is refused). */
  'project:reload': z.undefined(),
  /** The page has written its last edits (`project:closing`): the window may close. */
  'project:closed': z.undefined(),
  /** Brings back the take a restart put aside (its folder inside `takes/.discarded`), as the project's take. */
  'project:undo-restart': z.string().min(1).max(4096),
  /** Opens the settings window, at one of its pages (or where it was). */
  'app:settings': z.enum(SETTINGS_PAGES).optional(),
  // settings and the first run
  'settings:get': z.undefined(),
  'settings:set': z.strictObject({
    countdown: z.union([z.literal(0), z.literal(3), z.literal(5)]).optional(),
    /** A device's name, or null for none. */
    camera: z.string().min(1).max(512).nullable().optional(),
    mic: z.string().min(1).max(512).nullable().optional(),
    launchAtLogin: z.boolean().optional(),
    motion: z.enum(MOTIONS).optional(),
    speechModel: z.enum(['off', ...SPEECH_MODEL_NAMES]).optional(),
    speechLanguage: z.enum(SPEECH_LANGUAGES).optional(),
    privacyRead: z.boolean().optional(),
    privacyWords: z.array(z.string().trim().min(1).max(PRIVACY_WORD_MAX)).max(PRIVACY_WORDS_MAX).optional(),
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
  /** Shows the skill folder (one Cuttle did not install, to move away). */
  'tools:reveal': z.undefined(),
  /** A recent project, by its folder (only folders in the recent list are accepted). */
  'recent:open': z.string().min(1).max(4096),
  'recent:reveal': z.string().min(1).max(4096),
  'recent:forget': z.string().min(1).max(4096),
  /** Renames a recent project's folder (not while it is open or recording). */
  'recent:rename': z.strictObject({ dir: z.string().min(1).max(4096), name: z.string().trim().min(1).max(120) }),
  'speech:status': z.undefined(),
  /** Downloads a speech model (checked by size and checksum); answers once it is there or failed. */
  'speech:download': z.enum(SPEECH_MODEL_NAMES),
  'speech:cancel': z.undefined(),
  'speech:remove': z.enum(SPEECH_MODEL_NAMES),
  /** Reads the screen's text of the project's take again and masks what it showed (the Auto tab, Try again). */
  'project:read-screen': z.undefined(),
  /** Fits the video to this many seconds where it rests, or takes the fit out (null). */
  'project:fit-length': z.strictObject({ seconds: z.number().positive().max(36_000).nullable() }),
  /** The project as the editor shows it now, numbered: motion frames are asked for by that number. */
  'motion:project': z
    .strictObject({ version: z.number().int().nonnegative(), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'the project is too large'),
  /**
   * A frame of a motion item at the player's size: `mode` `seek` while paused, `play` while playing;
   * `have`: the number of the player's own copy of that frame.
   */
  'motion:frame': z.strictObject({
    version: z.number().int().nonnegative(),
    request: motionRequest,
    width: z.number().int().min(8).max(8192),
    height: z.number().int().min(8).max(8192),
    mode: z.enum(['seek', 'play']),
    have: z.number().int().positive().optional(),
  }),
  /** Frames across a motion scene for its block on the timeline, small. */
  'motion:strip': z.strictObject({
    version: z.number().int().nonnegative(),
    request: motionRequest,
    frames: z.array(z.number().int().nonnegative().max(100_000_000)).min(1).max(16),
    width: z.number().int().min(8).max(512),
    height: z.number().int().min(8).max(512),
    have: z.number().int().positive().optional(),
  }),
  /** The params a page declares (a page in the project, as an item's `src`). */
  'motion:params': z.string().min(1).max(4096),
  'motion:statuses': z.undefined(),
  /** Loads an item's page again (`scenes[2]`, `overlays[0]`). */
  'motion:reload': z.string().regex(/^(scenes|overlays)\[\d{1,6}\]$/),
  /** Copies a template of the motion kit into the project's `motion/` folder. */
  'motion:add-template': z.enum(MOTION_TEMPLATE_NAMES),
  /** The project as the editor shows it now, numbered: its soundtrack renders a moment later. */
  'sound:project': z
    .strictObject({ version: z.number().int().nonnegative(), raw: z.record(z.string(), z.unknown()) })
    .refine((value) => JSON.stringify(value.raw).length <= MAX_PROJECT_BYTES, 'the project is too large'),
  /** The soundtrack rendered last, by its key (none when a newer one replaced it). */
  'sound:soundtrack': z.string().regex(/^[0-9a-f]{8,64}$/),
  'sound:status': z.undefined(),
  /** The params the music page declares. */
  'sound:params': z.string().min(1).max(4096),
  /** Renders the music again. */
  'sound:reload': z.undefined(),
  /** Copies a music template into the project's `music/` folder. */
  'sound:add-template': z.enum(MUSIC_TEMPLATE_NAMES),
} as const;

export type Request = keyof typeof REQUESTS;

/** A project file larger than this is not written from the editor (a few hundred scenes are ~100 KB). */
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

/** What each request answers. */
export interface Responses {
  'project:info': ProjectInfo;
  'project:reveal': void;
  'export:copy': void;
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
  /** Started (the title bar shows it), or why not, and whether Settings is the place to fix it. */
  'project:transcribe': { started: true } | { problem: string; settings?: boolean };
  'picker:setup': PickerSetup | undefined;
  'picker:hover': void;
  'picker:choices': void;
  'picker:record': void;
  'picker:cancel': void;
  'picker:claude-folder': string | undefined;
  'picker:retry': void;
  'picker:script': void;
  'prompter:next': void;
  'prompter:previous': void;
  'prompter:size': void;
  'hud:stop': void;
  'hud:marker': void;
  'hud:retake': void;
  'hud:pause': void;
  'hud:resume': void;
  'hud:restart': void;
  /** Written (its new hash); or the file changed meanwhile (the version on disk now); or it could not be written. */
  'project:save': { hash: string } | { conflict: ProjectVersion & { origin: ChangeOrigin } } | { problem: string };
  /** An image chosen by the person, copied into the project when it lay outside (a path inside the project). */
  'project:import-image': { path: string } | undefined;
  'brand:list': BrandView[];
  /** The kits after the change, or why it could not be made. */
  'brand:save': { brands: BrandView[] } | { problem: string };
  'brand:apply': BrandApplied | { problem: string };
  'brand:remove': { brands: BrandView[] } | { problem: string };
  'background:palette': { colors: string[] } | { problem: string };
  /** The wallpaper's path in the project, or why there is none. */
  'background:wallpaper': { path: string } | { problem: string };
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
  /** What is installed now, and in `problems` what could not be. */
  'tools:install': ToolsStatus;
  'tools:copy': void;
  'tools:reveal': void;
  'recent:open': void;
  'recent:reveal': void;
  'recent:forget': SettingsView;
  /** The project's new folder, or why it could not be renamed. */
  'recent:rename': { dir: string } | { problem: string };
  'speech:status': SpeechStatus;
  'speech:download': SpeechStatus;
  'speech:cancel': void;
  'speech:remove': SpeechStatus;
  /** Started (the title bar shows it), or why not. */
  'project:read-screen': { started: true } | { problem: string };
  /** What the fit did, once it is done, or why it could not. */
  'project:fit-length': { report: LengthReport } | { problem: string };
  'motion:project': void;
  'motion:frame': MotionFrameAnswer;
  'motion:strip': MotionStripAnswer;
  'motion:params': MotionParams;
  'motion:statuses': MotionStatusView[];
  'motion:reload': void;
  /** The page's path in the project (`motion/title/index.html`). */
  'motion:add-template': { src: string };
  'sound:project': void;
  'sound:soundtrack': SoundtrackAnswer;
  'sound:status': SoundStatusView;
  'sound:params': MotionParams;
  'sound:reload': void;
  /** The page's path in the project (`music/pulse/index.html`). */
  'sound:add-template': { src: string };
}

/** A version of cuttle.json: as written, and the SHA-256 of its bytes. */
export interface ProjectVersion {
  raw: Record<string, unknown>;
  hash: string;
}

/**
 * cuttle.json changed on disk, not by this window: a new version (`origin`: `suggest` when the app's
 * own suggest cut the take, `speech` when the app cut its filler words and pauses, `privacy` when it
 * masked what the screen showed, else another
 * program, Claude or the CLI), or one that does not parse.
 */
export type ProjectFileEvent = (ProjectVersion & { origin: ChangeOrigin }) | { issues: string[] };

/** Who changed cuttle.json outside the editor: another program, or the app's own cut, speech edits, privacy masks or length fit. */
export type ChangeOrigin = 'outside' | 'suggest' | 'speech' | 'privacy' | 'length';

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
  /** The script, changed in another display's picker. */
  'picker:script': ScriptStep[];
  'prompter:state': PrompterState;
  /** `restart`: counting down again after a restart (the take before is kept). */
  'countdown:tick': { seconds: number; restart?: boolean };
  'hud:state': HudState;
  /** What the main process is doing to the project (cutting the take), or nothing. */
  'project:status': ProjectStatus;
  'project:file': ProjectFileEvent;
  /** The window is about to close: write the last edits, then `project:closed`. */
  'project:closing': Record<string, never>;
  /** The take was restarted: the one before is kept in `discarded` (a folder relative to the project). */
  'project:restarted': { discarded: string };
  /** A note for the editor's person once the take is in, said there (an undone restart). */
  'project:note': { text: string };
  'settings:changed': SettingsView;
  /** The settings window, already open, is asked to show this page. */
  'settings:page': SettingsPage;
  /** The speech models changed, or a download moved on. */
  'speech:status': SpeechStatus;
  /** Every window: how motion is set now (`data-motion` on the page's root). */
  'app:motion': Motion;
  /** The motion items' pages in the editor's preview: loading, ready or failed, and what they said. */
  'motion:status': MotionStatusView[];
  /** The project's files changed (a page edited): motion frames are drawn anew. Counts the changes. */
  'motion:changed': { files: number };
  /** The soundtrack's state: rendering, ready (with its key), failed. */
  'sound:status': SoundStatusView;
}

export type Event = keyof Events;

/** What a window sends with request `R`. */
export type RequestArgument<R extends Request> = z.input<(typeof REQUESTS)[R]>;

/** The bridge a preload exposes as `window.cuttle`. */
export interface Bridge {
  invoke<R extends Request>(channel: R, argument?: z.input<(typeof REQUESTS)[R]>): Promise<Responses[R]>;
  on<E extends Event>(channel: E, listener: (payload: Events[E]) => void): () => void;
}
