import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProject, ExportError, type EncoderPreference } from '@cuttle/export';
import type { EXPORT_FORMATS, ExportEnd, ExportFile, ExportProgress } from '../shared/ipc';
import { bundlePath } from './protocols';

type Format = (typeof EXPORT_FORMATS)[number];

/** The file a format is exported to, inside the project's `out/` (as the CLI does). */
export function exportPath(projectDir: string, format: Format): string {
  return join(projectDir, 'out', `${format.replace(':', 'x')}.mp4`);
}

/** Progress events at most this often. */
const PROGRESS_MS = 100;

/**
 * One export run of an editor: its formats one after another, with progress, cancel and the files
 * it wrote. `exportProject` reads cuttle.json from disk, so the run exports what was saved when it
 * started.
 */
export class ExportRun {
  private readonly controller = new AbortController();
  readonly done: Promise<ExportEnd>;

  constructor(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, encoder, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], encoder: EncoderPreference, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const files: ExportFile[] = [];
    const started = Date.now();
    for (const [position, format] of formats.entries()) {
      let last = 0;
      try {
        const out = exportPath(projectDir, format);
        const result = await exportProject({
          projectDir,
          format,
          out,
          encoder,
          pageDir: bundlePath('main', 'export-page'),
          signal: this.controller.signal,
          onProgress: (done, total) => {
            const now = Date.now();
            if (done < total && now - last < PROGRESS_MS) return;
            last = now;
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size });
      } catch (error) {
        if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files };
        const code = error instanceof ExportError ? error.code : 'internal';
        return { state: 'failed', files, format, code, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return { state: 'done', files };
  }

  cancel(): void {
    this.controller.abort();
  }
}
