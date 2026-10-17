import type { CursorShape, Marker, Rect } from '@cuttle/project';

/** A rectangle on the desktop, in physical pixels (negative left of and above the primary monitor). */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Monitor {
  /**
   * Windows: ffmpeg ddagrab's `output_idx`, the order of the default adapter's outputs. macOS: the
   * order of CGGetActiveDisplayList, avfoundation's "Capture screen <index>".
   */
  index: number;
  name: string;
  /** In desktop pixels: physical pixels on Windows, a display's backing pixels on macOS (see darwin.ts). */
  bounds: Bounds;
  /** Display scale factor (1.25 at 125 %; 2 on a Retina display). */
  scale: number;
  primary: boolean;
  /** macOS: the display's CGDirectDisplayID, which is Electron's `Display.id`. */
  displayId?: number;
}

export interface WindowInfo {
  /** The window's handle (HWND; the window number on macOS) as a number: unique while the window exists. */
  id: number;
  /** The process that owns it. */
  pid: number;
  /** Its window class, e.g. `CASCADIA_HOSTING_WINDOW_CLASS` (macOS: the app's name). */
  className: string;
  title: string;
  /** The visible frame without the invisible resize border. */
  bounds: Bounds;
  /** Index of the monitor that holds most of the window. */
  monitor: number;
}

export interface Devices {
  monitors: Monitor[];
  windows: WindowInfo[];
  cameras: string[];
  mics: string[];
}

export type Backend = 'auto' | 'test';

export type CaptureSource =
  | { kind: 'monitor'; index: number }
  /** `rect` is `[x, y, width, height]` in pixels of that monitor (origin at its top-left corner). */
  | { kind: 'region'; rect: Rect; monitor: number }
  /** Captured as the region of the window's bounds when the recording starts; by title or by id (`WindowInfo.id`). */
  | { kind: 'window'; title: string }
  | { kind: 'window'; id: number };

export interface StopOptions {
  /** Stops this many seconds after the screen track's first frame. */
  maxSeconds?: number;
  /** Stops once this file exists; it must not exist when the recording starts. */
  untilFile?: string;
  /**
   * Stops once the screen has not changed and no input arrived for this many seconds, after the screen
   * changed at least once (someone pointing at a still chart is not idle).
   */
  untilIdleSeconds?: number;
  /**
   * The folder Claude Code runs in. Stops `CLAUDE_TAIL_SECONDS` after the first session in that folder
   * that submits a prompt after `record()` was called (the countdown included) finishes its turn; its
   * prompts, tool calls and final answer become markers.
   */
  untilClaude?: string;
}

export interface RecordOptions {
  projectDir: string;
  source: CaptureSource;
  /** Device names from `listDevices()`. */
  webcam?: string;
  mic?: string;
  stop: StopOptions;
  /** Seconds to wait before the capture starts (default 3). */
  countdownSeconds?: number;
  /** Bake the real pointer into the screen track (then set `look.cursor.enabled` to false). */
  drawMouse?: boolean;
  /** `test`: ffmpeg test sources and synthetic input instead of real devices (default `auto`). */
  backend?: Backend;
  /**
   * macOS: the windows of these processes are left out of the screen track (the app's own: its HUD,
   * pill and pickers), when the capture helper is there. Windows leaves out content-protected windows itself.
   */
  hideWindowsOf?: number[];
  /**
   * Desktop areas (physical pixels) whose pointer input is not logged: the app's own controls, such
   * as a recording HUD, so no take shows the pointer going to them or a click on Stop.
   */
  deadZones?: Bounds[];
  onEvent?: (event: RecorderEvent) => void;
}

export type StopReason = 'stop' | 'hotkey' | 'max-seconds' | 'file' | 'idle' | 'claude';

export type RecorderEvent =
  | { type: 'countdown'; seconds: number }
  /** The capture processes started (ffmpeg's process ids), so a host that dies can be cleaned up after. */
  | { type: 'processes'; pids: number[] }
  /** Every track is capturing; `dir` is the take folder relative to the project. */
  | { type: 'recording'; dir: string }
  | { type: 'marker'; marker: Marker }
  | { type: 'warning'; message: string }
  /** Every track has stopped: nothing is captured or logged until a resume. */
  | { type: 'paused' }
  /** The tracks are starting again (a camera can take a second or two). */
  | { type: 'resuming' }
  /** Every track records again. */
  | { type: 'resumed' }
  | { type: 'stopping'; reason: StopReason };

/** A finished take. Paths are relative to the project folder, with forward slashes. */
export interface Take {
  dir: string;
  screen: string;
  webcam?: string;
  mic?: string;
  events: string;
  markers: string;
  screenSize: { width: number; height: number };
  /** Length of the screen track. */
  seconds: number;
  stopReason: StopReason;
  warnings: string[];
}

export interface Recording {
  /** Stops every track and resolves with the take (same promise as `done`). */
  stop(): Promise<Take>;
  /** Adds a manual marker at the current time (while paused: where the take paused). */
  marker(label?: string): void;
  /**
   * Pauses the take: every track stops (each file is complete) and nothing is captured or logged
   * until `resume()`. The take's time stands still meanwhile; the stop joins the pieces. Events:
   * `paused`, then `resuming` and `resumed`. The newest of `pause` and `resume` wins.
   */
  pause(): void;
  resume(): void;
  /** Replaces the dead zones (`RecordOptions.deadZones`), e.g. after the HUD was dragged. */
  setDeadZones(zones: Bounds[]): void;
  /** Resolves when the recording has stopped for any reason; rejects with a `RecorderError`. */
  done: Promise<Take>;
}

/** One input event before it is mapped into the screen track: wall-clock seconds, desktop pixels. */
export type RawInput =
  | { type: 'move'; time: number; x: number; y: number }
  | { type: 'click'; time: number; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; time: number; x: number; y: number; dx: number; dy: number }
  | { type: 'shape'; time: number; shape: CursorShape }
  | { type: 'key'; time: number };

export type HotkeyAction = 'stop' | 'marker' | 'pause';
