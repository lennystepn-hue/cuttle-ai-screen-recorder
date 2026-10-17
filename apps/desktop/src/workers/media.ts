// The media worker: a utility process (no Electron APIs here) that runs ffmpeg for the editor's
// proxies, thumbnails and waveforms, away from the main process. One job at a time per request;
// the main process queues them.
import { spawn, type ChildProcess } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { ffmpegPath, probeScreen, streamSeconds } from '@cuttle/core';
import {
  PEAKS_SAMPLE_RATE,
  PeakFolder,
  peaksArgs,
  progressOf,
  proxyArgs,
  thumbnailsArgs,
  thumbnailsMeta,
  type MediaJob,
  type ThumbnailsMeta,
  type WorkerCancel,
  type WorkerReply,
  type WorkerRequest,
} from '../shared/media-jobs';

interface ParentPort {
  on(event: 'message', listener: (message: { data: WorkerRequest | WorkerCancel }) => void): void;
  postMessage(message: WorkerReply): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
const running = new Map<number, ChildProcess>();
const cancelled = new Set<number>();

const reply = (message: WorkerReply) => port.postMessage(message);

/** Runs ffmpeg; `onLine` gets each stdout line (`-progress` output), `onData` raw stdout instead. */
function ffmpeg(id: number, args: string[], handlers: { onLine?: (line: string) => void; onData?: (chunk: Buffer) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.set(id, child);
    let stderr = '';
    let buffered = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (handlers.onData) return handlers.onData(chunk);
      buffered += chunk.toString('utf8');
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) handlers.onLine?.(line);
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-4000)));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      running.delete(id);
      if (cancelled.has(id)) return reject(new Error('cancelled'));
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split(/\r?\n/).slice(-4).join(' / ')}`));
    });
  });
}

/** Writes to `<output>.part` and renames it when the job succeeded, so a half-made file never passes for a done one. */
async function into<T>(output: string, make: (part: string) => Promise<T>): Promise<T> {
  const part = `${output}.part`;
  try {
    const result = await make(part);
    await rename(part, output);
    return result;
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    throw error;
  }
}

async function run(id: number, job: MediaJob): Promise<ThumbnailsMeta | undefined> {
  switch (job.job) {
    case 'proxy': {
      const { duration } = await probeScreen(job.input);
      await into(job.output, (part) =>
        ffmpeg(id, proxyArgs(job.input, part), {
          onLine(line) {
            const progress = progressOf(line, duration);
            if (progress !== undefined) reply({ id, progress });
          },
        }),
      );
      return undefined;
    }
    case 'thumbnails': {
      const { duration } = await probeScreen(job.input);
      const meta = thumbnailsMeta(duration);
      await into(job.output, (part) =>
        ffmpeg(id, thumbnailsArgs(job.input, part, meta), {
          onLine(line) {
            const progress = progressOf(line, duration);
            if (progress !== undefined) reply({ id, progress });
          },
        }),
      );
      return meta;
    }
    case 'peaks': {
      const seconds = await streamSeconds(job.input, 'a');
      const folder = new PeakFolder();
      let samples = 0;
      await ffmpeg(id, peaksArgs(job.input), {
        onData(chunk) {
          folder.push(chunk);
          samples += chunk.length / 2;
          if (seconds > 0) reply({ id, progress: Math.min(1, samples / PEAKS_SAMPLE_RATE / seconds) });
        },
      });
      await into(job.output, (part) => writeFile(part, folder.finish()));
      return undefined;
    }
  }
}

port.on('message', ({ data }) => {
  if (data.cancel) {
    cancelled.add(data.id);
    running.get(data.id)?.kill();
    return;
  }
  const { id, ...job } = data;
  run(id, job as MediaJob).then(
    (meta) => reply({ id, done: true, ...(meta && { meta }) }),
    (error: Error) => reply({ id, error: error.message, ...(cancelled.has(id) && { cancelled: true }) }),
  );
});
