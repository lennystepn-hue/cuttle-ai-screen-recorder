import { basename, extname, join, relative, sep } from 'node:path';
import { CliError } from '../errors';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile, writeProjectFile } from '../project-file';

export interface CaptureArgs {
  /** The whole page, for a scrolling still scene. */
  scroll?: boolean;
  width?: number;
  height?: number;
  /** File name in stills/ (without .png); default from the URL or file. */
  name?: string;
  /** Append a still scene that shows the capture. */
  add?: boolean;
  /** Seconds of that scene (default 4). */
  duration?: number;
  /** Milliseconds to wait after loading (fonts, maps, animations; default 1000). */
  wait?: number;
}

export interface CaptureResult {
  project: string;
  file: string;
  width: number;
  height: number;
  /** The scene that was appended, with `add`. */
  scene?: { type: 'still'; image: string; duration: number; motion: 'scroll' | 'none'; frame: 'browser-light' };
}

const DEFAULT_SCENE_SECONDS = 4;

/** `cuttle capture-page <url|file>`: a page as a PNG in stills/, optionally as a still scene. */
export async function capturePageCommand(projectDir: string, target: string, args: CaptureArgs, output: Output, signal: AbortSignal): Promise<CaptureResult> {
  const file = await readProjectFile(projectDir);
  const width = args.width ?? file.project.output.width;
  const height = args.height ?? file.project.output.height;
  for (const [name, value] of [['--width', width], ['--height', height], ['--duration', args.duration ?? 1], ['--wait', args.wait ?? 0]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new CliError('usage', `${name} must be a number of 0 or more`);
  }
  const name = slug(args.name ?? nameOf(target));
  const out = join(file.dir, 'stills', `${name}.png`);
  output.info(`capturing ${target} …`);
  const shot = await runInElectron<{ file: string; width: number; height: number }>(
    { command: 'capture-page', target, out, width: Math.round(width), height: Math.round(height), fullPage: args.scroll ?? false, waitMs: Math.round(args.wait ?? 1000), quiet: output.json },
    signal,
  );
  let scene: CaptureResult['scene'];
  if (args.add) {
    if (signal.aborted) throw new CliError('cancelled', 'cancelled: the page was captured, but no scene was added');
    scene = {
      type: 'still',
      image: relative(file.dir, out).split(sep).join('/'),
      duration: args.duration ?? DEFAULT_SCENE_SECONDS,
      motion: args.scroll ? 'scroll' : 'none',
      frame: 'browser-light',
    };
    file.raw.scenes = [...((file.raw.scenes as unknown[] | undefined) ?? []), scene];
    await writeProjectFile(file);
  }
  const result: CaptureResult = { project: file.path, ...shot, ...(scene && { scene }) };
  output.result(result, () => `captured ${shot.file} (${shot.width}×${shot.height})${scene ? `; appended a ${scene.duration} s still scene` : ''}`);
  return result;
}

/** A file name from a URL's host and path or a file's name. */
function nameOf(target: string): string {
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  }
  return basename(target, extname(target));
}

function slug(text: string): string {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 60) || 'page';
}
