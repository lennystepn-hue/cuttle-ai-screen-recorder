// The screen on macOS through cuttle-capture (native/macos/capture.swift): ScreenCaptureKit, which
// leaves out the windows of given processes (the app's HUD, pill and pickers; avfoundation records
// them), as raw BGRA frames that ffmpeg reads from a pipe at a steady frame rate.
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_RATE } from './args';
import type { ScreenArea } from './sources';

/**
 * Where the helper is looked for: CUTTLE_CAPTURE_HELPER (a path; "none" captures with avfoundation),
 * next to this bundle (the CLI's, the app's), or in the source tree.
 */
export function captureHelper(): string | undefined {
  const chosen = process.env.CUTTLE_CAPTURE_HELPER;
  if (chosen) return existsSync(chosen) ? chosen : undefined;
  const here = dirname(fileURLToPath(import.meta.url));
  // a packaged app runs its bundle from app.asar; executables are unpacked beside it
  const unpacked = (path: string) => path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  return [join(here, 'cuttle-capture'), join(here, '..', 'native', 'macos', 'cuttle-capture')].map(unpacked).find((file) => existsSync(file));
}

/** The helper's arguments: the area's display, its crop in the display's pixels, the pointer, the processes left out. */
export function helperArgs(area: ScreenArea, drawMouse: boolean, hide: readonly number[]): string[] {
  const { monitor, crop } = area;
  return [
    '--display', String(monitor.displayId ?? 0),
    '--fps', String(FRAME_RATE),
    ...(crop ? ['--crop', `${crop.x},${crop.y},${crop.width},${crop.height}`] : []),
    ...(drawMouse ? ['--cursor'] : []),
    ...hide.flatMap((pid) => ['--exclude-pid', String(pid)]),
  ];
}

/**
 * ffmpeg's input for the helper's frames, which come on file descriptor 3. Not as "pipe:3": ffmpeg
 * stops reading "q" from stdin when an input is a pipe, and the take could not be stopped. The time
 * base is a microsecond, as the wall clock stamps it (a frame rate of 30 would round the start to 33 ms).
 */
export function helperInput(area: ScreenArea): string[] {
  const { width, height } = area.crop ?? area.monitor.bounds;
  return ['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${width}x${height}`, '-framerate', '1000000', '-i', '/dev/fd/3'];
}
