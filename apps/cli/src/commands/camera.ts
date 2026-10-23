// `cuttle camera <layout>`: the camera in another layout for a while (source seconds, as a caption):
// `full` over the whole video (a talking-head intro or outro), `side` beside the screen (below it on
// a tall video), `large` a big bubble in its corner. The bubble turns into it and back.
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { CAMERA_LAYOUTS, newId, usedIds, type CameraLayout } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface CameraArgs {
  at: number;
  duration?: number;
  label?: string;
}

export async function cameraCommand(projectDir: string, layout: string, args: CameraArgs, output: Output): Promise<{ camera: Record<string, unknown> }> {
  if (!(CAMERA_LAYOUTS as readonly string[]).includes(layout)) throw new CliError('usage', `"${layout}" is no camera layout: ${CAMERA_LAYOUTS.join(', ')}`);
  const file = await readProjectFile(projectDir);
  if (!file.project.sources.webcam) throw new CliError('invalid-project', `${file.path} has no webcam (sources.webcam): record with --webcam to show the camera`);
  const camera: Record<string, unknown> = {
    id: newId('cameras', usedIds(file.raw)),
    ...(args.label !== undefined && { label: args.label }),
    layout: layout as CameraLayout,
    at: args.at,
    duration: args.duration ?? 3,
  };
  file.raw.cameras = [...((file.raw.cameras as unknown[] | undefined) ?? []), camera];
  await writeProjectFile(file, 'camera');
  output.result({ camera }, () => `the camera ${layout} from source ${args.at} s for ${String(camera.duration)} s (${String(camera.id)})`);
  return { camera };
}
