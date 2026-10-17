import { existsSync } from 'node:fs';
import { backupFile, type ProjectFile } from './project-file';

/** A take's files, relative to the project folder, and the screen track's length. */
export interface TakeFiles {
  screen: string;
  webcam?: string;
  mic?: string;
  events?: string;
  markers?: string;
  seconds: number;
}

/** Whether two absolute paths name the same file (Windows paths ignore case). */
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks and texts of the previous take (which
 * refer to its source times) are dropped. With `keepEdit` (recovering the take the project already
 * uses) they stay, and a clip over the whole take is added only when there are no scenes. When the
 * project had scenes or overlays, the previous cuttle.json is kept as a backup first; returns the
 * backup's path.
 */
export async function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): Promise<string | undefined> {
  const { scenes, zooms, masks, texts } = file.project;
  let backup: string | undefined;
  if (existsSync(file.path) && scenes.length + zooms.length + masks.length + texts.length > 0) backup = await backupFile(file.path);
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
    return backup;
  }
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  return backup;
}
