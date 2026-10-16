import { spawn } from 'node:child_process';
import { ExportError } from '../errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Lines of ffmpeg's stderr kept for an error message. */
const STDERR_TAIL_LINES = 12;

/** Fails fast with `ffmpeg-missing` before minutes of rendering, instead of at the audio step. */
export function checkFfmpeg(): Promise<void> {
  return runFfmpeg(['-hide_banner', '-version']);
}

/**
 * Runs ffmpeg and resolves when it exits with 0; otherwise rejects with the end of its stderr.
 * `signal` stops it (the child is killed) and rejects with `cancelled`.
 */
export function runFfmpeg(args: readonly string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ExportError('cancelled', 'the export was cancelled'));
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.name === 'AbortError') {
        reject(new ExportError('cancelled', 'the export was cancelled', { cause: error }));
      } else if (error.code === 'ENOENT') {
        reject(
          new ExportError(
            'ffmpeg-missing',
            `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg) or set CUTTLE_FFMPEG to its path.`,
            { cause: error },
          ),
        );
      } else {
        reject(new ExportError('render', `ffmpeg could not start: ${error.message}`, { cause: error }));
      }
    });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (signal?.aborted) return reject(new ExportError('cancelled', 'the export was cancelled'));
      const tail = stderr.trim().split(/\r?\n/).slice(-STDERR_TAIL_LINES).join('\n');
      reject(new ExportError('render', `ffmpeg exited with code ${code}:\n${tail}`));
    });
  });
}
