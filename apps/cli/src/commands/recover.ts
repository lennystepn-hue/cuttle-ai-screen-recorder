import { recoverTake, type RecoverResult } from '@cuttle/core';
import type { Output } from '../output';

/** `cuttle recover <take>`: makes a take usable after a crash and uses it (see @cuttle/core's recoverTake). */
export async function recoverCommand(projectDir: string, takeDir: string, output: Output): Promise<RecoverResult> {
  const result = await recoverTake(projectDir, takeDir);
  output.result(result, () =>
    [
      `${result.take}: ${result.seconds.toFixed(1)} s, tracks: ${result.tracks.join(', ')}`,
      ...(result.repaired.length > 0 ? result.repaired.map((note) => `- ${note}`) : ['nothing needed repair']),
      result.keptEdit
        ? `${result.project} already used this take: scenes and overlays kept`
        : `${result.project} now uses this take${result.backup ? ` (previous version: ${result.backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
