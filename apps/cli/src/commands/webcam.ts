// `cuttle webcam background <mode>`: what shows behind the person in the camera, in the bubble and in
// every camera layout: `keep` the room as filmed, `blur`, `color` (`--color`), or `remove` (the person
// alone, without the bubble). A segmentation model finds the person in each frame, on this computer.
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { WEBCAM_BACKGROUNDS, type WebcamBackground } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

export async function webcamBackgroundCommand(projectDir: string, mode: string, args: { color?: string }, output: Output): Promise<{ background: WebcamBackground; backgroundColor?: string }> {
  if (!(WEBCAM_BACKGROUNDS as readonly string[]).includes(mode)) throw new CliError('usage', `"${mode}" is no background: ${WEBCAM_BACKGROUNDS.join(', ')}`);
  if (args.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(args.color)) throw new CliError('usage', `--color takes a hex colour like #26262b, not "${args.color}"`);
  if (args.color !== undefined && mode !== 'color') throw new CliError('usage', '--color goes with the background "color"');
  const file = await readProjectFile(projectDir);
  if (!file.project.sources.webcam) throw new CliError('invalid-project', `${file.path} has no webcam (sources.webcam): record with --webcam to show the camera`);
  const look = ((file.raw.look ??= {}) as Record<string, unknown>);
  const webcam = ((look.webcam ??= {}) as Record<string, unknown>);
  // as filmed: the fields left out, as a new project has them
  if (mode === 'keep') delete webcam.background;
  else webcam.background = mode;
  if (args.color !== undefined) webcam.backgroundColor = args.color.toUpperCase();
  if (mode !== 'color') delete webcam.backgroundColor;
  await writeProjectFile(file, 'webcam background');
  const result = { background: mode as WebcamBackground, ...(typeof webcam.backgroundColor === 'string' && { backgroundColor: webcam.backgroundColor }) };
  const shown = file.project.look.webcam.enabled || file.project.cameras.some((camera) => camera.enabled);
  output.result(result, () => `behind the person: ${mode}${result.backgroundColor ? ` ${result.backgroundColor}` : ''}${shown ? '' : ' (the camera shows nowhere yet: look.webcam.enabled, or a camera layout)'}`);
  return result;
}
