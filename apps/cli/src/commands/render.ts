import { join, resolve } from 'node:path';
import { runInElectron } from '../electron-runner';
import type { Output } from '../output';
import { readProjectFile } from '../project-file';

export interface RenderArgs {
  format?: string;
  out?: string;
  encoder?: string;
}

/** What @cuttle/export's exportProject returns (the CLI does not import the Electron package). */
export interface RenderResult {
  out: string;
  frames: number;
  seconds: number;
  stats: { gpu: string; codec: string; hardwareAcceleration: string; bitrate: number; totalMs: number } & Record<string, unknown>;
}

/** `cuttle render`: the project as an MP4 (default out/<format>.mp4 in the project). */
export async function renderCommand(projectDir: string, args: RenderArgs, output: Output, signal: AbortSignal): Promise<RenderResult> {
  const file = await readProjectFile(projectDir); // fails fast, before Electron starts, on a broken project
  const out = args.out ? resolve(args.out) : join(file.dir, 'out', `${(args.format ?? 'export').replace(':', 'x')}.mp4`);
  output.info(`rendering ${out} …`);
  const result = await runInElectron<RenderResult>(
    {
      command: 'render',
      projectDir: file.dir,
      out,
      ...(args.format !== undefined && { format: args.format }),
      ...(args.encoder !== undefined && { encoder: args.encoder }),
    },
    signal,
  );
  output.result(result, () => `rendered ${result.out}: ${result.frames} frames, ${result.seconds.toFixed(2)} s, in ${(result.stats.totalMs / 1000).toFixed(1)} s`);
  return result;
}
