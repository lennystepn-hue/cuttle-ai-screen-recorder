import type { ProjectFile } from './project-file';

/** A take's files, relative to the project folder, and the screen track's length. */
export interface TakeFiles {
  screen: string;
  webcam?: string;
  mic?: string;
  /** What the computer played, when the take recorded it. */
  system?: string;
  events?: string;
  markers?: string;
  /** What the mic said (`transcript.json`), when the take was transcribed. */
  transcript?: string;
  /** The cleaned-up mic, made with the transcription. */
  cleanMic?: string;
  seconds: number;
}

/** Whether two absolute paths name the same file (Windows paths ignore case). */
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Points the project at a take: `sources` names its files. A project is one take: by default the
 * take becomes one clip scene, and the scenes, zooms, masks, texts, motion overlays and cuts of the
 * previous take (which refer to its source times) are dropped; a take with a camera switches the
 * webcam bubble on. With `keepEdit` (recovering the take the project already uses) they stay, and a
 * clip over the whole take is added only when there are no scenes. Returns whether the project had
 * scenes or overlays, so the caller keeps the previous cuttle.json as a backup when it writes
 * (`writeProjectFile`'s `backup`).
 */
export function useTake(file: ProjectFile, take: TakeFiles, keepEdit = false): boolean {
  const { scenes, zooms, masks, texts, overlays, cuts } = file.project;
  const hadEdit = scenes.length + zooms.length + masks.length + texts.length + overlays.length + cuts.length > 0;
  file.raw.sources = {
    screen: take.screen,
    ...(take.webcam && { webcam: take.webcam }),
    ...(take.mic && { mic: take.mic }),
    ...(take.system && { system: take.system }),
    ...(take.events && { events: take.events }),
    ...(take.markers && { markers: take.markers }),
    ...(take.transcript && { transcript: take.transcript }),
    ...(take.cleanMic && { cleanMic: take.cleanMic }),
  };
  if (keepEdit) {
    if (scenes.length === 0) file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
    return hadEdit;
  }
  // Milliseconds rounded down: the clip must end inside the screen track.
  file.raw.scenes = [{ type: 'clip', from: 0, to: Math.floor(take.seconds * 1000) / 1000 }];
  // A take with a camera shows it: the bubble comes on (it is off by default), drawn as it was set.
  if (take.webcam) {
    const look = (file.raw.look ?? {}) as Record<string, unknown>;
    file.raw.look = { ...look, webcam: { ...((look.webcam as Record<string, unknown> | undefined) ?? {}), enabled: true } };
  }
  delete file.raw.zooms;
  delete file.raw.masks;
  delete file.raw.texts;
  delete file.raw.overlays;
  delete file.raw.cuts;
  return hadEdit;
}
