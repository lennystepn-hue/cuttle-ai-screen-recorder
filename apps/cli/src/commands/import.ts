import { hostname } from 'node:os';
import { editorLockOf, importTake, type ImportResult } from '@cuttle/core';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface ImportArgs {
  /** The second of the file to start at. */
  from?: number;
  /** The second of the file to end at. */
  to?: number;
  /** Import even when the project is open in the Cuttle app. */
  force?: boolean;
}

/** `cuttle import <file>`: a video made elsewhere as the project's next take, which it uses (see @cuttle/core's importTake). */
export async function importCommand(projectDir: string, file: string, args: ImportArgs, output: Output): Promise<ImportResult> {
  // The app would keep showing the take it has open, and save it over this one.
  const open = args.force ? undefined : await editorLockOf(projectDir);
  if (open) {
    const where = open.host === hostname() ? '' : ` on ${open.host}`;
    throw new CliError('project-open', `the project is open in the Cuttle app${where}: close it first (--force imports anyway)`);
  }
  output.info(`importing ${file} …`);
  const result = await importTake(projectDir, file, { ...(args.from !== undefined && { from: args.from }), ...(args.to !== undefined && { to: args.to }) });
  output.result(result, () =>
    [
      `imported ${result.file} as ${result.take}: ${result.seconds.toFixed(1)} s, ${result.width}×${result.height}, tracks: ${result.tracks.join(', ')}`,
      `${result.project} now uses this take${result.backup ? ` (previous version: ${result.backup})` : ''}`,
    ].join('\n'),
  );
  return result;
}
