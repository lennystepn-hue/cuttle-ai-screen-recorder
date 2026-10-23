import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProject, ExportError, type EncoderPreference } from '@cuttle/export';
import type { ExportEnd, ExportFile, ExportProgress, ExportTarget, SUBTITLE_FILES } from '../shared/ipc';
import { bundlePath } from './protocols';
import { speakNarration } from './voice';

type Format = ExportTarget;

/** How a run exports: the encoder, whether the subtitles are burned in, and the subtitle files beside each video. */
export interface ExportSettings {
  encoder: EncoderPreference;
  captions?: boolean;
  subtitles?: readonly (typeof SUBTITLE_FILES)[number][];
}

/** The file a format is exported to, inside the project's `out/`, named as the CLI names it (`export.mp4` for the project's own size). */
export function exportPath(projectDir: string, format: Format): string {
  return join(projectDir, 'out', `${format === 'project' ? 'export' : format.replace(':', 'x')}.mp4`);
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

  constructor(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, settings, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const files: ExportFile[] = [];
    const started = Date.now();
    // the narration's lines not spoken yet are spoken first (the export reads them from voiceover/)
    try {
      await speakNarration(projectDir);
    } catch (error) {
      return { state: 'failed', files, format: formats[0]!, code: 'voice', message: `the narration could not be spoken: ${error instanceof Error ? error.message : String(error)}` };
    }
    for (const [position, format] of formats.entries()) {
      let last = 0;
      try {
        const out = exportPath(projectDir, format);
        const result = await exportProject({
          projectDir,
          ...(format !== 'project' && { format }),
          out,
          encoder: settings.encoder,
          ...(settings.captions !== undefined && { captions: settings.captions }),
          ...(settings.subtitles && settings.subtitles.length > 0 && { subtitles: settings.subtitles }),
          pageDir: bundlePath('main', 'export-page'),
          signal: this.controller.signal,
          onProgress: (done, total) => {
            const now = Date.now();
            if (done < total && now - last < PROGRESS_MS) return;
            last = now;
            onProgress({ format, position, formats: formats.length, done, total, elapsed: (now - started) / 1000 });
          },
        });
        files.push({ format, out: result.out, seconds: result.seconds, bytes: (await stat(result.out)).size, ...(result.subtitles && { subtitles: result.subtitles }), ...(result.chapters && { chapters: result.chapters }),
          ...(result.loudness && { loudness: { target: result.loudness.target, lufs: result.loudness.video.lufs, truePeak: result.loudness.video.truePeak } }),
        });
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
