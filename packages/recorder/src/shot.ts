// A screenshot: one picture of a monitor, a region of it or a window, as a PNG with the display's
// scale in its resolution (72 dpi a point). macOS through the capture helper (`cuttle-capture shot`:
// ScreenCaptureKit, the windows of given processes left out, a window by itself without its shadow);
// Windows through a take's own ffmpeg inputs, one frame: ddagrab (DXGI, which leaves out
// content-protected windows: Cuttle's) for the screen, gfxcapture (ffmpeg 8) for a window by itself;
// the test backend's test pattern.
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { listDevices } from './devices';
import { RecorderError } from './errors';
import { ffmpegMissing, ffmpegPath } from './ffmpeg';
import { captureHelper } from './mac-capture';
import { platformFor, resolveArea, type Platform, type ScreenArea } from './sources';
import type { Backend, CaptureSource, Devices } from './types';
import { hasWindowCapture } from './window-capture';

export interface ShotOptions {
  source: CaptureSource;
  /** The PNG to write (replaced). */
  out: string;
  /** With the pointer (default without). */
  cursor?: boolean;
  /** macOS: processes whose windows are left out (Cuttle's own). Windows leaves out content-protected windows by itself. */
  hideWindowsOf?: readonly number[];
  backend?: Backend;
  /** The devices, when the caller has them already (the window to take is looked up in them). */
  devices?: Devices;
}

export interface ScreenShot {
  file: string;
  /** Its pixels. */
  width: number;
  height: number;
  /** The display's pixels per point (2 on a Retina display, 1.5 at 150 %). */
  scale: number;
  /** The monitor it was taken on (`Monitor.index`). */
  monitor: number;
  /** A window shot: the window's title. */
  window?: string;
  /** What the shot could not do as asked (a window taken with what lies over it). */
  warnings: string[];
}

const SCREEN_DENIED =
  'macOS does not let this app take the screen: allow the app that runs Cuttle (your terminal, or Cuttle) under System Settings > Privacy & Security > Screen & System Audio Recording, then quit and reopen it';

/** Seconds a shot may take before it counts as hung. */
const SHOT_TIMEOUT_SECONDS = 20;

/** Runs a program to its end: its stdout, or a failure with the end of its stderr. */
function run(command: string, args: readonly string[], what: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), SHOT_TIMEOUT_SECONDS * 1000);
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === 'ENOENT' && command === ffmpegPath() ? ffmpegMissing(error) : new RecorderError('capture', `${what} could not start: ${error.message}`, { cause: error }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new RecorderError('capture', `${what} took more than ${SHOT_TIMEOUT_SECONDS} s and was stopped`));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** What a picture of an area is written to, and with what. */
interface AreaShot {
  out: string;
  cursor?: boolean;
  hideWindowsOf?: readonly number[];
}

/** macOS: the helper takes the display or the window and writes the PNG itself. */
async function macShot(area: ScreenArea, options: AreaShot): Promise<{ width: number; height: number; scale: number }> {
  const { loadDarwin } = await import('./darwin');
  const mac = await loadDarwin();
  if (!mac.screenAccess()) {
    mac.requestScreenAccess();
    throw new RecorderError('permission-denied', SCREEN_DENIED);
  }
  const helper = captureHelper();
  if (!helper) throw new RecorderError('capture', 'the capture helper (cuttle-capture) is missing: build it with "pnpm install", or reinstall Cuttle');
  const { monitor, crop } = area;
  const args = [
    'shot',
    '--display', String(monitor.displayId ?? 0),
    ...(area.window !== undefined ? ['--window', String(area.window)] : crop ? ['--crop', `${crop.x},${crop.y},${crop.width},${crop.height}`] : []),
    ...(options.cursor ? ['--cursor'] : []),
    ...(options.hideWindowsOf ?? []).flatMap((pid) => ['--exclude-pid', String(pid)]),
    '--out', options.out,
  ];
  const done = await run(helper, args, 'the screenshot');
  if (done.code === 3) throw new RecorderError('permission-denied', SCREEN_DENIED);
  if (done.code !== 0) throw new RecorderError('capture', `the screenshot failed: ${done.stderr.trim() || `the helper exited with code ${done.code}`}`);
  const answer = JSON.parse(done.stdout.trim().split('\n').at(-1) ?? '{}') as { width?: number; height?: number; scale?: number };
  if (!answer.width || !answer.height) throw new RecorderError('capture', `the screenshot failed: the helper said ${done.stdout.trim() || 'nothing'}`);
  return { width: answer.width, height: answer.height, scale: answer.scale ?? monitor.scale };
}

/**
 * The ffmpeg graph of one frame: a take's own source. Windows: the window by gfxcapture (all of it,
 * at its frame's size), else ddagrab's part of the monitor; the test backend: its pattern (a window
 * at its frame's size).
 */
export function shotGraph(platform: 'windows' | 'test', area: ScreenArea, cursor: boolean, windowCapture: boolean): string {
  const { monitor, crop } = area;
  if (platform === 'test') {
    const window = area.window !== undefined ? (area.frame ?? crop) : undefined;
    const size = window ?? monitor.bounds;
    // in RGB: a 4:2:0 picture is cut to even sizes
    const pattern = `testsrc2=s=${size.width}x${size.height}:d=1,format=rgba`;
    return !window && crop ? `${pattern},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : pattern;
  }
  if (area.window !== undefined && windowCapture && area.frame) {
    const { width, height } = area.frame;
    return `gfxcapture=hwnd=${area.window}:capture_cursor=${cursor ? 1 : 0}:capture_border=1:display_border=0:width=${width}:height=${height},hwdownload,format=bgra`;
  }
  const region = crop ? `:offset_x=${crop.x}:offset_y=${crop.y}:video_size=${crop.width}x${crop.height}` : '';
  return `ddagrab=output_idx=${monitor.index}:draw_mouse=${cursor ? 1 : 0}${region},hwdownload,format=bgra`;
}

/**
 * A picture of an area (a take's, or a screenshot's) into a PNG: the window by itself, the display or
 * its region, at the display's pixels.
 */
export async function shootArea(platform: Platform, area: ScreenArea, options: AreaShot): Promise<{ width: number; height: number; scale: number; warnings: string[] }> {
  const warnings: string[] = [];
  await rm(options.out, { force: true });
  if (platform === 'macos') return { ...(await macShot(area, options)), warnings };
  const windowCapture = platform === 'windows' && area.window !== undefined && (await hasWindowCapture());
  if (platform === 'windows' && area.window !== undefined && !windowCapture) {
    warnings.push('this ffmpeg has no gfxcapture (ffmpeg 8 and newer): the window was taken where it is on the screen, with whatever lies over it');
  }
  const scale = area.monitor.scale;
  const graph = shotGraph(platform, area, options.cursor ?? false, windowCapture);
  const done = await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', graph, '-frames:v', '1', '-dpi', String(Math.round(72 * scale)), options.out], 'the screenshot');
  if (done.code !== 0) throw new RecorderError('capture', `the screenshot failed: ${done.stderr.trim().split('\n').slice(-5).join('\n') || `ffmpeg exited with code ${done.code}`}`);
  const byItself = area.window !== undefined && (platform === 'test' || windowCapture) && area.frame;
  const size = byItself ? area.frame! : (area.crop ?? area.monitor.bounds);
  return { width: size.width, height: size.height, scale, warnings };
}

/** Takes a screenshot of a monitor, a region of it or a window, into a PNG. */
export async function takeShot(options: ShotOptions): Promise<ScreenShot> {
  const platform = platformFor(options.backend);
  const devices = options.devices ?? (await listDevices({ ...(options.backend && { backend: options.backend }), media: false }));
  const area = resolveArea(options.source, devices, true);
  const window = area.window !== undefined ? devices.windows.find((candidate) => candidate.id === area.window) : undefined;
  const taken = await shootArea(platform, area, options);
  return { file: options.out, ...taken, monitor: area.monitor.index, ...(window && { window: window.title }) };
}
