// The open project in an editor window: its media, the player, what is selected and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

/** What is selected: a scene, or an overlay with the stretch of the video where it was clicked (an overlay can show more than once). */
export type Selection = { kind: 'scene' | OverlayKind; index: number; start?: number; end?: number };

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
  error?: string;
  info?: ProjectInfo;
  media?: EditorMedia;
  /** The output format the preview shows; undefined: the project's own output. */
  format?: ExportFormat;
  player: PlayerState;
  selection?: Selection;
  tab: 'selection' | 'look';
  mediaState: MediaState;
  exportOpen: boolean;
  exportProgress?: ExportProgress;
  exportEnd?: ExportEnd;
  exporting: boolean;
  /** When the running export started (epoch ms): it exports cuttle.json as saved then. */
  exportStarted?: number;
  /** An export ended while the sheet was closed: the title bar says so until the sheet shows it. */
  exportUnseen: boolean;
  /** Timeline scale; 0 until the timeline fits itself. */
  pxPerSecond: number;
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  tab: 'selection',
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  exportUnseen: false,
  pxPerSecond: 0,
});

let player: Player | undefined;

export function currentPlayer(): Player | undefined {
  return player;
}

let shown: { media: EditorMedia; format: ExportFormat | undefined; project: CuttleProject } | undefined;

/** The project as the preview shows it: the file's, or with the previewed output format (the same object until either changes). */
export function shownProject(state: EditorState = store.get()): CuttleProject | undefined {
  if (!state.media) return undefined;
  if (shown?.media !== state.media || shown.format !== state.format) shown = { media: state.media, format: state.format, project: withFormat(state.media.project, state.format) };
  return shown.project;
}

const query = new URLSearchParams(location.search);

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    store.set({ info });
    const [media, assets] = await Promise.all([openProjectMedia(info), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: media.project,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
    if (query.get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => void applyMediaState(state));
    void applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState, proxyInUse }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
        const proxy = store.get().mediaState.proxy;
        if (proxy.state === 'ready' && proxy.path) await switchToProxy(proxy.path);
        return proxyInUse;
      },
    },
  });
}

let proxyInUse = false;

async function switchToProxy(path: string): Promise<void> {
  if (proxyInUse || !player) return;
  proxyInUse = true;
  try {
    player.useProxy(await openVideo(path, 'The playback copy'));
  } catch {
    proxyInUse = false;
  }
}

async function applyMediaState(state: MediaState): Promise<void> {
  if (state.seq < store.get().mediaState.seq) return;
  store.set({ mediaState: state });
  // Playback and scrubbing switch to the proxy once it is made. `?proxy=off` (CUTTLE_NO_PROXY=1)
  // lets the check compare the output view with the export's frames from the take itself.
  if (state.proxy.state === 'ready' && state.proxy.path && query.get('proxy') !== 'off') await switchToProxy(state.proxy.path);
}

/** Makes the background media again after a failure (ffmpeg missing, say). */
export function retryMedia(): void {
  void bridge.invoke('media:retry');
}

export function setFormat(format: ExportFormat | undefined): void {
  store.set({ format });
  const project = shownProject();
  if (project) player?.setProject(project);
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen } = store.get();
  if (phase !== 'ready') return;
  store.set({ exportOpen: true, exportUnseen: false, ...(!exporting && !exportUnseen && { exportEnd: undefined, exportProgress: undefined }) });
}

export function closeExport(): void {
  store.set({ exportOpen: false });
}

export async function startExport(formats: ExportTarget[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
}

export function cancelExport(): void {
  void bridge.invoke('export:cancel');
}
