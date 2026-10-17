import { spawn } from 'node:child_process';
import { CliError } from './errors';

/** The ffmpeg executable: `CUTTLE_FFMPEG` when set, otherwise `ffmpeg` from PATH. */
export function ffmpegPath(): string {
  return process.env.CUTTLE_FFMPEG || 'ffmpeg';
}

/** Runs ffmpeg and returns stdout (bytes) and stderr (text); a non-zero exit is a CliError with the end of the log. */
export function runFfmpeg(args: readonly string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        error.code === 'ENOENT'
          ? new CliError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}"). Install it (Windows: winget install Gyan.FFmpeg) or set CUTTLE_FFMPEG.`)
          : error,
      ),
    );
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr });
      const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
      reject(new CliError('invalid-media', `ffmpeg failed (exit code ${code}):\n${tail}`));
    });
  });
}
