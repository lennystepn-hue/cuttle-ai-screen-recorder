import { applyLengthFit, CoreError, type LengthApplied } from '@cuttle/core';
import type { Output } from '../output';

/**
 * `cuttle fit <seconds>`: fits the video to a length where it rests, after the hand edits (see
 * @cuttle/core's applyLengthFit); `--off` takes the fit out.
 */
export async function fitCommand(projectDir: string, seconds: number | undefined, off: boolean, output: Output): Promise<LengthApplied> {
  if (seconds === undefined && !off) throw new CoreError('usage', 'give the length in seconds (cuttle fit 45), or --off to take the fit out');
  if (seconds !== undefined && off) throw new CoreError('usage', 'give a length or --off, not both');
  const result = await applyLengthFit(projectDir, off ? undefined : seconds);
  output.result(result, () =>
    [
      ...result.notes.map((note) => `- ${note}`),
      result.written ? `written: ${result.length.toFixed(1)} s of video` : 'cuttle.json unchanged',
      'next: cuttle preview',
    ].join('\n'),
  );
  return result;
}
