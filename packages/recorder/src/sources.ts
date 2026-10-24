// Which ffmpeg inputs a backend uses, and which part of which monitor a capture source covers.
import { FRAME_RATE } from './args';
import { RecorderError } from './errors';
import type { Backend, Bounds, CaptureSource, Devices, Monitor } from './types';

/** `test` works everywhere; real capture exists for Windows and macOS. */
export type Platform = 'windows' | 'macos' | 'test';

export function platformFor(backend: Backend = 'auto'): Platform {
  if (backend === 'test') return 'test';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  throw new RecorderError('unsupported-platform', `recording on ${process.platform} is not supported yet; only Windows and macOS (and backend "test")`);
}

/**
 * The test backend's devices. Monitor 0 shows a moving test pattern; monitor 1 moves for 1 s and
 * then stands still (for `untilIdleSeconds`). "Silent Test Microphone" delivers digital silence;
 * "Spoken Test Microphone" plays the sound file CUTTLE_TEST_SPEECH names, over and over;
 * "Failing Test Camera" ends after 1 s, like a camera that is unplugged.
 */
export const TEST_DEVICES: Devices = {
  monitors: [
    { index: 0, name: 'Test Monitor', bounds: { x: 0, y: 0, width: 1280, height: 720 }, scale: 1, primary: true },
    { index: 1, name: 'Still Test Monitor', bounds: { x: 1280, y: 0, width: 640, height: 360 }, scale: 1, primary: false },
  ],
  windows: [{ id: 1001, pid: 4242, className: 'TestWindow', title: 'Test Window', bounds: { x: 100, y: 60, width: 640, height: 360 }, monitor: 0 }],
  cameras: ['Test Camera', 'Failing Test Camera'],
  mics: ['Test Microphone', 'Silent Test Microphone', 'Spoken Test Microphone'],
};

/** What the screen track captures: a monitor, optionally cropped (monitor pixels, even sizes). */
export interface ScreenArea {
  monitor: Monitor;
  crop?: Bounds;
  /**
   * The window a window take shows (`WindowInfo.id`). macOS's capture helper takes that window by
   * itself, at the crop's size, and so does Windows' gfxcapture (window-capture.ts), all of it
   * (`wholeWindow`): what lies over it is not in the take. Otherwise the crop is the screen where the
   * window is.
   */
  window?: number;
  /** A window take: the window's frame on the desktop when the take starts. */
  frame?: Bounds;
}

/** The area's size and its top-left corner on the desktop (where events.jsonl's origin lies). */
export function areaGeometry(area: ScreenArea): { size: { width: number; height: number }; origin: { x: number; y: number } } {
  const { bounds } = area.monitor;
  const crop = area.crop ?? { x: 0, y: 0, width: bounds.width, height: bounds.height };
  return { size: { width: crop.width, height: crop.height }, origin: { x: bounds.x + crop.x, y: bounds.y + crop.y } };
}

/**
 * Resolves a capture source against the device list. A video's sizes are even (H.264 4:2:0 needs
 * them); `exact` keeps a screenshot's as they are.
 */
export function resolveArea(source: CaptureSource, devices: Devices, exact = false): ScreenArea {
  const even = (value: number) => (exact ? value : Math.floor(value / 2) * 2);
  const monitorAt = (index: number) => {
    const monitor = devices.monitors.find((candidate) => candidate.index === index);
    if (monitor) return monitor;
    const known = devices.monitors.map((candidate) => `${candidate.index} (${candidate.bounds.width}×${candidate.bounds.height})`).join(', ');
    throw new RecorderError('device-not-found', `there is no monitor ${index}; monitors: ${known || 'none'}`);
  };
  switch (source.kind) {
    case 'monitor': {
      // H.264 4:2:0 needs even sizes; a monitor with an odd one loses its last column or row.
      const monitor = monitorAt(source.index);
      return { monitor, crop: fullOrCrop(monitor, { x: 0, y: 0, width: even(monitor.bounds.width), height: even(monitor.bounds.height) }) };
    }
    case 'region': {
      const monitor = monitorAt(source.monitor);
      const [x, y, width, height] = source.rect.map(Math.round) as [number, number, number, number];
      const crop = { x, y, width: even(width), height: even(height) };
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || crop.width < 2 || crop.height < 2 || x + crop.width > monitor.bounds.width || y + crop.height > monitor.bounds.height) {
        throw new RecorderError(
          'invalid-options',
          `region [${source.rect.join(', ')}] is not inside monitor ${monitor.index} (${monitor.bounds.width}×${monitor.bounds.height}); give it in that monitor's pixels`,
        );
      }
      return { monitor, crop: fullOrCrop(monitor, crop) };
    }
    case 'window': {
      const window = 'id' in source ? windowById(source.id, devices) : findWindow(source.title, devices);
      const monitor = monitorAt(window.monitor);
      const { bounds } = monitor;
      // The part of the window on the monitor that holds most of it, in that monitor's pixels.
      const left = Math.max(window.bounds.x, bounds.x) - bounds.x;
      const top = Math.max(window.bounds.y, bounds.y) - bounds.y;
      const right = Math.min(window.bounds.x + window.bounds.width, bounds.x + bounds.width) - bounds.x;
      const bottom = Math.min(window.bounds.y + window.bounds.height, bounds.y + bounds.height) - bounds.y;
      const crop = { x: left, y: top, width: even(right - left), height: even(bottom - top) };
      if (crop.width < 2 || crop.height < 2) throw new RecorderError('invalid-options', `window "${window.title}" is not visible on a monitor`);
      return { monitor, crop: fullOrCrop(monitor, crop), window: window.id, frame: window.bounds };
    }
  }
}

/**
 * A window take of the window by itself (Windows' gfxcapture): all of the window, also where it
 * reaches past its monitor, in even sizes (the right and bottom are cut). Its origin is the window's
 * corner, as the window gate's.
 */
export function wholeWindow(area: ScreenArea): ScreenArea {
  const even = (value: number) => Math.floor(value / 2) * 2;
  const { frame, monitor } = area;
  if (!frame) return area;
  return { ...area, crop: { x: frame.x - monitor.bounds.x, y: frame.y - monitor.bounds.y, width: even(frame.width), height: even(frame.height) } };
}

function fullOrCrop(monitor: Monitor, crop: Bounds): Bounds | undefined {
  const full = crop.x === 0 && crop.y === 0 && crop.width === monitor.bounds.width && crop.height === monitor.bounds.height;
  return full ? undefined : crop;
}

function windowById(id: number, devices: Devices) {
  const window = devices.windows.find((candidate) => candidate.id === id);
  if (!window) throw new RecorderError('device-not-found', `the window ${id} is gone (closed, minimized or on another desktop)`);
  return window;
}

/** The one window with exactly this title, otherwise the one whose title contains it (ignoring case). */
function findWindow(title: string, devices: Devices) {
  const exact = devices.windows.filter((window) => window.title === title);
  const needle = title.toLowerCase();
  const matches = exact.length > 0 ? exact : devices.windows.filter((window) => window.title.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new RecorderError('invalid-options', `"${title}" matches ${matches.length} windows: ${matches.map((window) => `"${window.title}"`).join(', ')}`);
  }
  throw new RecorderError('device-not-found', `no window title contains "${title}"`);
}

/** Checks a webcam or mic name against the device list. */
export function checkDevice(kind: 'camera' | 'mic', name: string, devices: Devices): void {
  const names = kind === 'camera' ? devices.cameras : devices.mics;
  if (names.includes(name)) return;
  throw new RecorderError('device-not-found', `there is no ${kind} "${name}"; ${kind}s: ${names.map((known) => `"${known}"`).join(', ') || 'none'}`);
}

const MICROSECONDS = 'settb=1/1000000';

/** ffmpeg input arguments of the screen track. */
export function screenInput(platform: Platform, area: ScreenArea, drawMouse: boolean): string[] {
  const { monitor, crop } = area;
  if (platform === 'macos') {
    // the whole display in its backing pixels, as RGB like ddagrab's (the chain converts it to BT.709);
    // a region or a window is cut from it by `screenFilter`
    return ['-f', 'avfoundation', '-capture_cursor', drawMouse ? '1' : '0', '-framerate', String(FRAME_RATE), '-pixel_format', 'bgr0', '-i', `Capture screen ${monitor.index}:none`];
  }
  if (platform === 'test') {
    const { width, height } = monitor.bounds;
    const pattern = `testsrc2=s=${width}x${height}:r=${FRAME_RATE}`;
    // `realtime` paces the frames like a capture device; wall-clock timestamps need that.
    const source = monitor.name === 'Still Test Monitor' ? `${pattern}:d=1,tpad=stop=-1:stop_mode=clone` : pattern;
    const cropped = crop ? `${source},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : source;
    return ['-f', 'lavfi', '-i', `${cropped},realtime,${MICROSECONDS}`];
  }
  const region = crop ? `:offset_x=${crop.x}:offset_y=${crop.y}:video_size=${crop.width}x${crop.height}` : '';
  const grab = `ddagrab=output_idx=${monitor.index}:framerate=${FRAME_RATE}:draw_mouse=${drawMouse ? 1 : 0}${region}`;
  return ['-f', 'lavfi', '-i', `${grab},hwdownload,format=bgra,${MICROSECONDS}`];
}

/** The filter that comes first on the screen track: macOS crops the captured display to the area. */
export function screenFilter(platform: Platform, area: ScreenArea): string | undefined {
  const { crop } = area;
  return platform === 'macos' && crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : undefined;
}

/** A camera's picture size; avfoundation opens a camera at its smallest one unless asked. */
export interface CameraMode {
  width: number;
  height: number;
}

export function webcamInput(platform: Platform, name: string, mode?: CameraMode): string[] {
  if (platform === 'test') {
    const end = name === 'Failing Test Camera' ? ':d=1' : '';
    return ['-f', 'lavfi', '-i', `testsrc=s=640x480:r=${FRAME_RATE}${end},realtime,${MICROSECONDS}`];
  }
  if (platform === 'macos') {
    const size = mode ? ['-video_size', `${mode.width}x${mode.height}`] : [];
    return ['-f', 'avfoundation', '-framerate', String(FRAME_RATE), ...size, '-i', `${name}:none`];
  }
  return ['-f', 'dshow', '-rtbufsize', '256M', '-i', `video=${name}`];
}

/**
 * The camera mode to ask for, from the modes avfoundation lists (`  1280x720@[1.000000 30.000000]fps`):
 * 1280×720 at 30 frames per second when the camera has it, otherwise its largest mode up to 1080
 * lines that runs at 30; undefined when none does (the camera's default is used).
 */
export function pickCameraMode(log: string): CameraMode | undefined {
  const modes: (CameraMode & { fps: number[] })[] = [];
  for (const match of log.matchAll(/(\d+)x(\d+)@\[([\d.\s]+)\]fps/g)) {
    modes.push({ width: Number(match[1]), height: Number(match[2]), fps: match[3]!.trim().split(/\s+/).map(Number) });
  }
  const at30 = modes.filter(({ fps }) => fps.length > 0 && Math.min(...fps) <= FRAME_RATE && Math.max(...fps) >= FRAME_RATE);
  const best = at30.find(({ width, height }) => width === 1280 && height === 720) ?? at30.filter(({ height }) => height <= 1080).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return best && { width: best.width, height: best.height };
}

/**
 * A small DirectShow buffer: with wall-clock timestamps a packet is stamped when it arrives, one
 * buffer after its first sample was captured (the device default measured ~500 ms).
 */
const MIC_BUFFER_MS = 50;

/**
 * Seconds a screen frame is older than its stamp (taken when ffmpeg reads it): what was on screen at
 * a moment shows in the take this much later, so the screen's start is moved back by it, and the
 * input and the other tracks line up with the picture. Measured with a clock on screen on an M1:
 * ScreenCaptureKit through the helper about 37 ms, avfoundation about 80 ms; ddagrab is not measured.
 */
export function screenLatency(platform: Platform, helper: boolean): number {
  return platform === 'macos' ? (helper ? 0.037 : 0.08) : 0;
}

/**
 * Seconds to subtract from the mic's stamped start to get the time of its first sample. macOS needs
 * none: its mic and camera keep avfoundation's own stamps, the time each buffer was captured
 * (`deviceClock`).
 */
export function micLatency(platform: Platform): number {
  return platform === 'windows' ? MIC_BUFFER_MS / 1000 : 0;
}

/** Whether the camera and the mic keep the device's own timestamps (macOS) instead of the wall clock's at arrival. */
export const deviceClock = (platform: Platform) => platform === 'macos';

/** The spoken test mic: the file CUTTLE_TEST_SPEECH names, in real time and looped. */
function spokenInput(): string[] {
  const file = process.env.CUTTLE_TEST_SPEECH;
  if (!file) throw new RecorderError('device-not-found', 'the Spoken Test Microphone plays the sound file CUTTLE_TEST_SPEECH names, and it is not set');
  return ['-re', '-stream_loop', '-1', '-i', file];
}

export function micInput(platform: Platform, name: string): string[] {
  if (platform === 'test') {
    if (name === 'Spoken Test Microphone') return spokenInput();
    const source = name === 'Silent Test Microphone' ? 'anullsrc=r=48000:cl=mono' : 'sine=frequency=440:sample_rate=48000';
    return ['-f', 'lavfi', '-i', `${source},arealtime`];
  }
  if (platform === 'macos') return ['-f', 'avfoundation', '-i', `none:${name}`];
  return ['-f', 'dshow', '-audio_buffer_size', String(MIC_BUFFER_MS), '-i', `audio=${name}`];
}
