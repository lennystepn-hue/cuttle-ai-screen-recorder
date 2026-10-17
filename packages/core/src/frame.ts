import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { readProjectFile } from './project-file';
import { probeScreen } from './suggest/media';

export interface FrameOptions {
  /** A pixel grid with numbers over the frame, for reading the rects of masks and zooms. */
  grid?: boolean;
  /** PNG to write (default frames/<t>s.png, or frames/<t>s-grid.png, in the project). */
  out?: string;
  /** A warning for people (the grid without numbers). */
  onWarning?: (text: string) => void;
}

export interface FrameResult {
  /** Source seconds of the frame. */
  t: number;
  file: string;
  /** The screen track's size: the PNG's size, and the pixels rects are given in. */
  width: number;
  height: number;
  grid: boolean;
  /** Whether the grid lines carry their pixel numbers (they need a system font). */
  labels: boolean;
}

/** Grid lines every this many source pixels, stronger every `GRID_MAJOR`. */
export const GRID_STEP = 100;
const GRID_MAJOR = 500;

/** Fonts ffmpeg's drawtext can use for the grid numbers, by platform (drawtext needs a font file). */
function fonts(): string[] {
  const windows = (process.env.WINDIR ?? 'C:/Windows').replace(/\\/g, '/');
  if (process.platform === 'win32') return [`${windows}/Fonts/arial.ttf`, `${windows}/Fonts/segoeui.ttf`];
  if (process.platform === 'darwin') return ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'];
  return ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'];
}

function labelFont(): string | undefined {
  return fonts().find((font) => existsSync(font));
}

/** The grid as an ffmpeg filter chain: lines every GRID_STEP px (stronger every GRID_MAJOR), numbered when there is a font. */
export function gridFilter(width: number, height: number, font: string | undefined): string {
  const lines = [`drawgrid=w=${GRID_STEP}:h=${GRID_STEP}:t=1:c=0xFF00FF@0.35`, `drawgrid=w=${GRID_MAJOR}:h=${GRID_MAJOR}:t=3:c=0xFF00FF@0.7`];
  if (font === undefined) return lines.join(',');
  // drawtext's options are `:`-separated: escape the drive letter's colon.
  const fontfile = font.replace(/\\/g, '/').replace(/:/g, '\\:');
  const size = Math.max(12, Math.round(height / 80));
  const label = (value: number, x: number, y: number) =>
    `drawtext=fontfile='${fontfile}':text=${value}:x=${x}:y=${y}:fontsize=${size}:fontcolor=white:box=1:boxcolor=0xFF00FF@0.7:boxborderw=2`;
  const labels: string[] = [];
  for (let x = 0; x < width; x += GRID_STEP) labels.push(label(x, x + 3, 3));
  for (let y = GRID_STEP; y < height; y += GRID_STEP) labels.push(label(y, 3, y + 3));
  return [...lines, ...labels].join(',');
}

/**
 * The screen track's frame at a source second as a PNG at full size, in
 * the pixels masks and zooms use; with `grid` a numbered pixel grid to read rects from.
 */
export async function grabFrame(projectDir: string, at: number, args: FrameOptions = {}): Promise<FrameResult> {
  const file = await readProjectFile(projectDir);
  const screen = resolve(file.dir, file.project.sources.screen);
  if (!existsSync(screen)) throw new CoreError('missing-file', `the screen track ${screen} does not exist`);
  const { width, height, duration } = await probeScreen(screen);
  if (at >= duration) throw new CoreError('usage', `the screen track is ${duration.toFixed(2)} s long; ${at} s is past its end`);
  const out = args.out ? resolve(args.out) : join(file.dir, 'frames', `${at.toFixed(2)}s${args.grid ? '-grid' : ''}.png`);
  await mkdir(dirname(out), { recursive: true });
  if (existsSync(out) && statSync(out).isDirectory()) throw new CoreError('usage', `the frame's file (-o) needs a file name, not the folder ${out}`);
  // An older file there must not pass for the new frame when ffmpeg writes none.
  await rm(out, { force: true });
  // -update 1: one picture, so a `%d` in the path is not read as a frame-number pattern.
  const grab = (filter: string[]) => runFfmpeg(['-ss', at.toFixed(3), '-i', screen, '-frames:v', '1', ...filter, '-update', '1', '-y', out]);
  let font = args.grid ? labelFont() : undefined;
  if (args.grid && font === undefined) args.onWarning?.('no font for the grid numbers was found: the grid has lines only (every 100 px, stronger every 500 px)');
  try {
    await grab(args.grid ? ['-vf', gridFilter(width, height, font)] : []);
  } catch (error) {
    // An ffmpeg built without drawtext (no FreeType) can still draw the lines.
    if (font === undefined || !String((error as Error).message).includes('drawtext')) throw error;
    args.onWarning?.('this ffmpeg cannot draw text: the grid has lines only (every 100 px, stronger every 500 px)');
    font = undefined;
    await grab(['-vf', gridFilter(width, height, undefined)]);
  }
  if (!existsSync(out)) {
    throw new CoreError('usage', `no frame starts at or after ${at} s (the screen track ends at ${duration.toFixed(2)} s); take an earlier time`);
  }
  const result: FrameResult = { t: at, file: out, width, height, grid: args.grid ?? false, labels: font !== undefined };
  return result;
}
