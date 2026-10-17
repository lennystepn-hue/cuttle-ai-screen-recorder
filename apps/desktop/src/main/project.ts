import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readProjectFile, samePath, type ProjectFile } from '@cuttle/core';
import { parseTakeJson, trackOffset, type CuttleProject } from '@cuttle/project';
import type { ProjectInfo } from '../shared/ipc';
import { CACHE_DIR } from './media-service';

/**
 * Seconds after the screen track that the webcam and the mic started, from the take.json next to
 * the screen track, used only where take.json describes those very files (as the export does);
 * 0 otherwise.
 */
export async function trackOffsets(dir: string, project: CuttleProject): Promise<ProjectInfo['offsets']> {
  const screen = resolve(dir, project.sources.screen);
  const text = await readFile(join(dirname(screen), 'take.json'), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseTakeJson(text);
  if (!parsed?.ok || !samePath(resolve(dirname(screen), parsed.take.tracks.screen.file), screen)) return { webcam: 0, mic: 0 };
  const take = parsed.take;
  const offset = (track: 'webcam' | 'mic') => {
    const source = project.sources[track];
    const entry = take.tracks[track];
    if (source === undefined || !entry || !samePath(resolve(dirname(screen), entry.file), resolve(dir, source))) return 0;
    return trackOffset(take, track) ?? 0;
  };
  return { webcam: offset('webcam'), mic: offset('mic') };
}

export async function projectInfo(file: ProjectFile): Promise<ProjectInfo> {
  return { dir: file.dir, name: basename(file.dir), raw: file.raw, hash: file.hash ?? '', offsets: await trackOffsets(file.dir, file.project) };
}

/** Reads the project for an editor; throws the core's readable error for a missing or invalid cuttle.json. */
export function openProjectFile(dir: string): Promise<ProjectFile> {
  return readProjectFile(dir);
}

const LOCK = 'editor.lock';

/** Whether a process with this id runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Marks the project as open in this app (`.cuttle/editor.lock` with the process id), so another
 * Cuttle does not open it too and the CLI's `record` can refuse it. Throws when another running
 * Cuttle holds it; a lock left by a process that is gone is taken over. Returns the release.
 */
export async function lockProject(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, CACHE_DIR, LOCK);
  const held = await readFile(path, 'utf8').then((text) => JSON.parse(text) as { pid?: unknown }, () => undefined);
  if (held && typeof held.pid === 'number' && held.pid !== process.pid && alive(held.pid)) {
    throw new Error(`${basename(dir)} is open in another Cuttle window (process ${held.pid})`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ pid: process.pid, opened: new Date().toISOString() })}\n`);
  return () => rm(path, { force: true });
}
