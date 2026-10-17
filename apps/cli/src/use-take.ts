import { copyFile } from 'node:fs/promises';
import type { ProjectFile } from './project-file';

/** A take's files, relative to the project folder, and the screen track's length. */
export interface TakeFiles {
  screen: string;
  webcam?: string;
  mic?: string;
  events?: string;
  markers?: string;
  seconds: number;
}

/**
 * Points the project at a take: `sources` names its files and the take becomes one clip scene. A
 * project is one take: scenes, zooms, masks and texts of the previous take refer to its source
 * times, so they are dropped, and the previous cuttle.json is kept as cuttle.json.bak when it had any.
 * Returns the backup's path, if one was written.
 */
export async function useTake(file: ProjectFile, take: TakeFiles): Promise<string | undefined> {
  const { scenes, zooms, masks, texts } = file.project;
  let backup: string | undefined;
  if (scenes.length + zooms.length + masks.length + texts.length > 0) {
    backup = `${file.path}.bak`;
    await copyFile(file.path, backup);
  }
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
  };
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  return backup;
}
