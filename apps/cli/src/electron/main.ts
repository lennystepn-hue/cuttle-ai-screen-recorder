// The CLI's Electron process: renders, previews and page captures (Chromium has WebGL2 and
// WebCodecs). Started by the Node CLI (electron-runner.ts) with one base64 JSON request and an IPC
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app } from 'electron';
import { exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse } from './protocol';

// The export window is the app's only window; closing it must not quit before the job is done.
app.on('window-all-closed', () => {});
// The CLI cancels over IPC (Ctrl+C in its console never reaches this process on Windows); a signal
// does the same where one arrives. A second one exits at once.
const cancel = new AbortController();
const onCancel = () => {
  if (cancel.signal.aborted) app.exit(130);
  cancel.abort();
};
process.on('message', (message: CancelMessage) => message?.type === 'cancel' && onCancel());
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, onCancel);

/** Progress for people on stderr, every 10 %. */
function progress(label: string): (done: number, total: number) => void {
  let shown = -1;
  return (done, total) => {
    const percent = Math.floor((done / total) * 10) * 10;
    if (percent === shown) return;
    shown = percent;
    process.stderr.write(`${label} ${done}/${total}\n`);
  };
}

function exportFormat(format: string | undefined): { format?: ExportFormat } {
  if (format === undefined) return {};
  if (!isExportFormat(format)) throw Object.assign(new Error(`unknown format "${format}" (16:9, 1:1 or 9:16)`), { code: 'usage' });
  return { format };
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
      return exportProject({
        projectDir: request.projectDir,
        out: request.out,
        ...exportFormat(request.format),
        ...(request.encoder !== undefined && { encoder: request.encoder as EncoderPreference }),
        signal: cancel.signal,
        onProgress: progress('frames'),
      });
    case 'preview':
      return renderStills({
        projectDir: request.projectDir,
        outDir: request.outDir,
        times: request.times,
        ...exportFormat(request.format),
        ...(request.sheet && { sheet: request.sheet }),
        signal: cancel.signal,
        onProgress: progress('stills'),
      });
    case 'capture-page':
      return capturePage(request);
  }
}

app.whenReady().then(async () => {
  let response: ElectronResponse;
  try {
    response = { ok: true, result: await handle(decodeRequest(process.argv.at(-1) ?? '')) };
  } catch (error) {
    response = failure(error);
  }
  finish(response);
});
