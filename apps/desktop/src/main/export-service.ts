import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportProjects, ExportError, type EncoderPreference, type ExportCodec, type ExportSize } from '@cuttle/export';
import type { ExportEnd, ExportFile, ExportFileKind, ExportProgress, ExportTarget, SUBTITLE_FILES } from '../shared/ipc';
import { bundlePath } from './protocols';
import { speakNarration } from './voice';

type Format = ExportTarget;

/** How a run exports: the encoder, the file, whether the subtitles are burned in, and the subtitle files beside each video. */
export interface ExportSettings {
  encoder: EncoderPreference;
  /** An MP4 (default), or a transparent WebM (VP9 with alpha) or MOV (ProRes 4444). */
  file?: ExportFileKind;
  /** 4K instead of the format's size; another frame rate than the project's; HEVC instead of H.264. */
  size?: ExportSize;
  fps?: number;
  codec?: ExportCodec;
  captions?: boolean;
  subtitles?: readonly (typeof SUBTITLE_FILES)[number][];
}

/** The file a format is exported to, inside the project's `out/`, named as the CLI names it (`export.mp4` for the project's own size). */
export function exportPath(projectDir: string, format: Format, file: ExportFileKind = 'mp4'): string {
  return join(projectDir, 'out', `${format === 'project' ? 'export' : format.replace(':', 'x')}.${file}`);
}

/** Progress events at most this often. */
const PROGRESS_MS = 100;

/**
 * One export run of an editor: its formats in one go (their frames one after another, the sound once,
 * made meanwhile), with progress, cancel and the files it wrote. `exportProjects` reads cuttle.json
 * from disk, so the run exports what was saved when it started; a failure or a cancel leaves none.
 */
export class ExportRun {
  private readonly controller = new AbortController();
  readonly done: Promise<ExportEnd>;

  constructor(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void) {
    this.done = this.run(projectDir, formats, settings, onProgress);
  }

  private async run(projectDir: string, formats: readonly Format[], settings: ExportSettings, onProgress: (progress: ExportProgress) => void): Promise<ExportEnd> {
    const started = Date.now();
    // the narration's lines not spoken yet are spoken first (the export reads them from voiceover/)
    try {
      await speakNarration(projectDir);
    } catch (error) {
      return { state: 'failed', files: [], format: formats[0]!, code: 'voice', message: `the narration could not be spoken: ${error instanceof Error ? error.message : String(error)}` };
    }
    let last = 0;
    // the format being rendered: each has the same number of frames
    let position = 0;
    try {
      const results = await exportProjects({
        projectDir,
        targets: formats.map((format) => ({ ...(format !== 'project' && { format }), out: exportPath(projectDir, format, settings.file) })),
        ...(settings.file && settings.file !== 'mp4' && { transparent: true }),
        ...(settings.size && { size: settings.size }),
        ...(settings.fps && { fps: settings.fps }),
        ...(settings.codec && { codec: settings.codec }),
        encoder: settings.encoder,
        ...(settings.captions !== undefined && { captions: settings.captions }),
        ...(settings.subtitles && settings.subtitles.length > 0 && { subtitles: settings.subtitles }),
        pageDir: bundlePath('main', 'export-page'),
        signal: this.controller.signal,
        onProgress: (done, total) => {
          const each = total / formats.length;
          position = Math.min(formats.length - 1, Math.floor(done / each));
          const now = Date.now();
          if (done < total && now - last < PROGRESS_MS) return;
          last = now;
          onProgress({ format: formats[position]!, position, formats: formats.length, done: done - position * each, total: each, elapsed: (now - started) / 1000 });
        },
      });
      const files: ExportFile[] = [];
      for (const [index, result] of results.entries()) {
        files.push({
          format: formats[index]!,
          out: result.out,
          seconds: result.seconds,
          bytes: (await stat(result.out)).size,
          ...(result.subtitles && { subtitles: result.subtitles }),
          ...(result.chapters && { chapters: result.chapters }),
          ...(result.loudness && { loudness: { target: result.loudness.target, lufs: result.loudness.video.lufs, truePeak: result.loudness.video.truePeak } }),
        });
      }
      return { state: 'done', files };
    } catch (error) {
      if (error instanceof ExportError && error.code === 'cancelled') return { state: 'cancelled', files: [] };
      const code = error instanceof ExportError ? error.code : 'internal';
      return { state: 'failed', files: [], format: formats[position]!, code, message: error instanceof Error ? error.message : String(error) };
    }
  }

  cancel(): void {
    this.controller.abort();
  }
}
