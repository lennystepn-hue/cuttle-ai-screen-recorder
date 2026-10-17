import { GRID_STEP, grabFrame, type FrameResult } from '@cuttle/core';
import type { Output } from '../output';

/** `cuttle frame <source-seconds>`: a frame of the screen track at full size (see @cuttle/core's grabFrame). */
export async function frameCommand(projectDir: string, at: number, args: { grid?: boolean; out?: string }, output: Output): Promise<FrameResult> {
  const result = await grabFrame(projectDir, at, { ...args, onWarning: (text) => output.warn(text) });
  output.result(result, () => `${result.file} (${result.width}×${result.height} source pixels${result.grid ? `, a grid every ${GRID_STEP} px` : ''})`);
  return result;
}
