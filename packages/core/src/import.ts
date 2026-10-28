// A video made elsewhere (a phone, OBS, a download) as a take of the project: its picture becomes a
// screen track as the recorder writes one (30 fps, H.264, BT.709, a key frame every 2 s) and its
// sound the mic track, so suggest, zooms, masks, the look and the export work on it as on a recording.
// It has no input events and no markers: suggest cuts it by what the picture and the sound do.
import { existsSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { MARKERS_VERSION, TAKE_VERSION, type TakeFile } from '@cuttle/project';
import { allocateTake, VIDEO_CHAIN } from '@cuttle/recorder';
import { CoreError } from './errors';
import { runFfmpeg } from './ffmpeg';
import { newProjectFile, projectExists, readProjectFile, writeProjectFile } from './project-file';
import { parseAnalysis, streamSeconds } from './suggest/media';
import { useTake } from './use-take';

/** The screen track's frame rate, as the recorder's; and its longest side, larger pictures are scaled down to it. */
export const IMPORT_RULES = { fps: 30, maxSide: 3840 };

/** The recorder's H.264 (recorder/args.ts), at a slower preset: an import need not keep up with a screen. */
const VIDEO_CODEC = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
  '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];

export interface ImportOptions {
  /** The second of the file to start at (default 0). */
  from?: number;
  /** The second of the file to end at (default its end). */
  to?: number;
}

export interface ImportResult {
  project: string;
  /** The take folder, relative to the project. */
  take: string;
  /** The file imported, as given. */
  file: string;
  seconds: number;
  width: number;
  height: number;
  tracks: string[];
  /** The previous cuttle.json, when the take replaced scenes or overlays. */
  backup?: string;
}

/**
 * Imports `file` (a video, read relative to the current folder) as the next take of the project (made
 * when missing) and points the project at it, as a recording does: one clip over the whole take, and
 * the previous take's edits kept in the backup. `from` and `to` take a stretch of the file.
 */
export async function importTake(projectDir: string, file: string, options: ImportOptions = {}): Promise<ImportResult> {
  const path = resolve(file);
  if (!existsSync(path) || !statSync(path).isFile()) throw new CoreError('missing-file', `${file} does not exist`, { path });
  // about its length: ffmpeg's progress time stops at its last frame's start, or a little before
  const length = await streamSeconds(path, 'v');
  if (length <= 0) throw new CoreError('invalid-media', `${file} has no video that ffmpeg can read`, { path });
  const from = options.from ?? 0;
  if (!(Number.isFinite(from) && from >= 0)) throw new CoreError('usage', 'from must be a second of the file, 0 or more');
  if (from >= length) throw new CoreError('usage', `from (${from} s) is past the end of ${file} (${length.toFixed(1)} s)`);
  if (options.to !== undefined && !(Number.isFinite(options.to) && options.to > from)) throw new CoreError('usage', `to must come after from (${from} s)`);
  // to the end of the file, unless the stretch ends before it
  const to = options.to !== undefined && options.to < length ? options.to : undefined;
  // Read (or created) now, so a broken project stops the command before anything is converted.
  if (projectExists(projectDir)) await readProjectFile(projectDir);
  else await writeProjectFile(newProjectFile(projectDir), 'import');

  const project = resolve(projectDir);
  const dir = allocateTake(project);
  const rel = relative(project, dir).split(sep).join('/');
  const stretch = ['-ss', from.toFixed(3), ...(to === undefined ? [] : ['-t', (to - from).toFixed(3)]), '-i', path];
  const hasSound = (await streamSeconds(path, 'a')) > 0;
  try {
    // the picture: 30 fps, at most IMPORT_RULES.maxSide on its longest side, an even size (yuv420p), BT.709
    const max = IMPORT_RULES.maxSide;
    const size = `scale=w='min(iw,${max})':h='min(ih,${max})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    await runFfmpeg([...stretch, '-map', '0:v:0', '-vf', `fps=${IMPORT_RULES.fps},${size},${VIDEO_CHAIN}`, ...VIDEO_CODEC, '-an', '-movflags', '+faststart', '-y', join(dir, 'screen.mp4')]);
    if (hasSound) await runFfmpeg([...stretch, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '160k', '-y', join(dir, 'mic.m4a')]);
    // Its length to the end of its last frame, from the frames it has (ffmpeg's progress time stops
    // before that frame ends): the clip over the take shows each of them.
    const { stderr } = await runFfmpeg(['-i', join(dir, 'screen.mp4'), '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
    const { width, height } = parseAnalysis(stderr);
    const seconds = Number([...stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? 0) / IMPORT_RULES.fps;
    // Picture and sound start together: take.json gives them one start, on the clock of the import.
    const start = Date.now() / 1000;
    const take: TakeFile = {
      version: TAKE_VERSION,
      tracks: { screen: { file: 'screen.mp4', start }, ...(hasSound && { mic: { file: 'mic.m4a', start } }) },
    };
    await writeFile(join(dir, 'take.json'), `${JSON.stringify(take, null, 2)}\n`);
    await writeFile(join(dir, 'events.jsonl'), '');
    await writeFile(join(dir, 'markers.json'), `${JSON.stringify({ version: MARKERS_VERSION, markers: [] }, null, 2)}\n`);

    // Read again: the project may have changed while the file was converted; that version gets the take.
    const projectFile = await readProjectFile(projectDir);
    const hadEdit = useTake(projectFile, {
      screen: `${rel}/screen.mp4`,
      ...(hasSound && { mic: `${rel}/mic.m4a` }),
      events: `${rel}/events.jsonl`,
      markers: `${rel}/markers.json`,
      seconds,
    });
    const { backup } = await writeProjectFile(projectFile, 'import', { backup: hadEdit });
    return { project: projectFile.path, take: rel, file, seconds, width, height, tracks: hasSound ? ['screen', 'mic'] : ['screen'], ...(backup && { backup }) };
  } catch (error) {
    // nothing half-made stays: the next import or recording takes the number again
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * A video file made as `import` makes a take's picture (30 fps, BT.709 H.264, an even size at most
 * `maxSide` on its longest side, without sound): stock footage a page plays with `cuttle.video`.
 */
export async function convertVideo(input: string, output: string, maxSide = IMPORT_RULES.maxSide): Promise<void> {
  const size = `scale=w='min(iw,${maxSide})':h='min(ih,${maxSide})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await runFfmpeg(['-i', input, '-map', '0:v:0', '-vf', `fps=${IMPORT_RULES.fps},${size},${VIDEO_CHAIN}`, ...VIDEO_CODEC, '-an', '-movflags', '+faststart', '-y', output]);
}
