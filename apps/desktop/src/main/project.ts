import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EDITOR_LOCK, readProjectFile, samePath, type ProjectFile } from '@cuttle/core';
import { parseTakeJson, trackOffset, type CuttleProject, type TakeFile } from '@cuttle/project';
import type { ProjectInfo } from '../shared/ipc';

/** The editor's folder inside the project: its lock, and the cached proxy, thumbnails and peaks. */
export const CACHE_DIR = '.cuttle';

/** The take.json next to the screen track, when it describes that very file. */
async function screenTake(dir: string, project: CuttleProject): Promise<TakeFile | undefined> {
  const screen = resolve(dir, project.sources.screen);
  const text = await readFile(join(dirname(screen), 'take.json'), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseTakeJson(text);
  return parsed?.ok && samePath(resolve(dirname(screen), parsed.take.tracks.screen.file), screen) ? parsed.take : undefined;
}

/**
 * Seconds after the screen track that the webcam, the mic and the system audio started, from the take.json next to
 * the screen track, used only where take.json describes those very files (as the export does);
 * 0 otherwise.
 */
function trackOffsets(dir: string, project: CuttleProject, take: TakeFile | undefined): ProjectInfo['offsets'] {
  if (!take) return { webcam: 0, mic: 0, system: 0 };
  const screen = resolve(dir, project.sources.screen);
  const offset = (track: 'webcam' | 'mic' | 'system') => {
    const source = project.sources[track];
    const entry = take.tracks[track];
    if (source === undefined || !entry || !samePath(resolve(dirname(screen), entry.file), resolve(dir, source))) return 0;
    return trackOffset(take, track) ?? 0;
  };
  return { webcam: offset('webcam'), mic: offset('mic'), system: offset('system') };
}

export async function projectInfo(file: ProjectFile): Promise<ProjectInfo> {
  const take = await screenTake(file.dir, file.project);
  return { dir: file.dir, name: basename(file.dir), raw: file.raw, hash: file.hash ?? '', offsets: trackOffsets(file.dir, file.project, take), ...(take?.scale !== undefined && { scale: take.scale }) };
}

/** Reads the project for an editor; throws the core's readable error for a missing or invalid cuttle.json. */
export function openProjectFile(dir: string): Promise<ProjectFile> {
  return readProjectFile(dir);
}

/** The project is open in Cuttle on another computer (a synced or shared folder). */
export class LockedError extends Error {
  constructor(readonly host: string) {
    super(`the project is open in Cuttle on ${host}`);
    this.name = 'LockedError';
  }
}

/**
 * Marks the project as open in this app (`.cuttle/editor.lock` with the computer's name), so the
 * CLI's `record` and Cuttle on another computer (a synced folder) can see it. A lock from this
 * computer is always taken over: only one Cuttle runs per user, so it was left by one that is gone
 * (a crash, a power cut). A lock from another computer refuses with `LockedError` unless `force`.
 * Returns the release.
 */
export async function lockProject(dir: string, options: { force?: boolean } = {}): Promise<() => Promise<void>> {
  const path = join(dir, EDITOR_LOCK);
  // A lock that does not parse (a power cut during its write leaves it empty) is stale too.
  const held = await readFile(path, 'utf8').then(
    (text) => {
      try {
        return JSON.parse(text) as { host?: unknown } | null;
      } catch {
        return undefined;
      }
    },
    () => undefined,
  );
  if (!options.force && held && typeof held.host === 'string' && held.host !== hostname()) throw new LockedError(held.host);
  await mkdir(dirname(path), { recursive: true });
  const lock = `${JSON.stringify({ host: hostname(), pid: process.pid, opened: new Date().toISOString() })}\n`;
  await writeFile(path, lock);
  // Only our own lock is removed: another computer may have taken it over meanwhile.
  return async () => {
    if ((await readFile(path, 'utf8').catch(() => '')) === lock) await rm(path, { force: true });
  };
}
