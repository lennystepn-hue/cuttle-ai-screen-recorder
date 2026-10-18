// The CLI's Electron process: renders, previews and page captures (Chromium has WebGL2 and
// WebCodecs). Started by the Node CLI (electron-runner.ts) with one base64 JSON request and an IPC
// channel, which carries the answer back and a cancel in; progress and warnings go to stderr.
// Loaded by bootstrap.ts, which handles uncaught exceptions.
import { app, protocol } from 'electron';
import { MOTION_SCHEME_PRIVILEGES, SUBTITLE_FORMATS, checkMusic, exportProject, isExportFormat, renderStills, type EncoderPreference, type ExportFormat, type SubtitleFormat } from '@cuttle/export';
import { capturePage } from './capture-page';
import { failure, finish } from './finish';
import { decodeRequest, type CancelMessage, type ElectronRequest, type ElectronResponse, type MotionCheck } from './protocol';
import type { CuttleProject } from '@cuttle/project';

// Motion pages are served from a scheme of their own, which must be known before the app is ready.
protocol.registerSchemesAsPrivileged([MOTION_SCHEME_PRIVILEGES]);
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
// The CLI went away (killed): stop instead of rendering on for nobody. (On Windows the CLI's job
// object takes Electron with it anyway.)
process.on('disconnect', () => {
  if (!cancel.signal.aborted) cancel.abort();
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, onCancel);

/** Progress for people on stderr, every 10 %; nothing for --json. */
function progress(label: string, quiet: boolean | undefined): (done: number, total: number) => void {
  let shown = -1;
  return (done, total) => {
    if (quiet) return;
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

function subtitleFormats(formats: readonly string[]): SubtitleFormat[] {
  const unknown = formats.find((format) => !(SUBTITLE_FORMATS as readonly string[]).includes(format));
  if (unknown !== undefined) throw Object.assign(new Error(`unknown subtitle format "${unknown}" (srt or vtt)`), { code: 'usage' });
  return formats as SubtitleFormat[];
}

/** The project with the checked page as its only scene, or the checked overlay as its only one (its look and output stay). */
function motionCheckProject(project: CuttleProject, check: MotionCheck): CuttleProject {
  if (check.overlay !== undefined) {
    const overlay = project.overlays[check.overlay];
    return { ...project, overlays: overlay ? [overlay] : [] };
  }
  const { overlay: _overlay, ...page } = check;
  return { ...project, scenes: [{ type: 'motion', label: 'check', ...page }], overlays: [], cuts: [] };
}

async function handle(request: ElectronRequest): Promise<unknown> {
  switch (request.command) {
    case 'render':
      return exportProject({
        projectDir: request.projectDir,
        out: request.out,
        ...exportFormat(request.format),
        ...(request.encoder !== undefined && { encoder: request.encoder as EncoderPreference }),
        ...(request.captions !== undefined && { captions: request.captions }),
        ...(request.subtitles && { subtitles: subtitleFormats(request.subtitles) }),
        signal: cancel.signal,
        onProgress: progress('frames', request.quiet),
      });
    case 'preview':
      return renderStills({
        projectDir: request.projectDir,
        outDir: request.outDir,
        clean: request.clean ?? false,
        times: request.times,
        ...exportFormat(request.format),
        ...(request.sheet && { sheet: request.sheet }),
        ...(request.motion && { project: (project: CuttleProject) => motionCheckProject(project, request.motion!) }),
        signal: cancel.signal,
        onProgress: progress('stills', request.quiet),
      });
    case 'capture-page':
      return capturePage(request, cancel.signal);
    case 'music':
      return checkMusic({ projectDir: request.projectDir, out: request.out, ...(request.sheet && { sheet: request.sheet }), ...(request.src && { src: request.src }) });
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
