// The open project in an editor window: its media, the player, what is selected and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { ExportEnd, ExportProgress, MediaState, ProjectInfo } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

export type Selection = { kind: 'scene' | OverlayKind; index: number };

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

/** Opens the window's project: its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    const [media, assets] = await Promise.all([openProjectMedia(info), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: media.project,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', info, media });
    await player.seek(0);
    if (new URLSearchParams(location.search).get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => applyMediaState(state));
    applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set({ exportEnd: end, exporting: false }));
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
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState }),
      pixels: () => canvas.toDataURL('image/png'),
    },
  });
}

let proxyInUse = false;

async function applyMediaState(state: MediaState): Promise<void> {
  if (state.seq < store.get().mediaState.seq) return;
  store.set({ mediaState: state });
  // Playback and scrubbing switch to the proxy once it is made. `?proxy=off` (CUTTLE_NO_PROXY=1)
  // lets the check compare the output view with the export's frames from the take itself.
  if (state.proxy.state === 'ready' && state.proxy.path && !proxyInUse && player && new URLSearchParams(location.search).get('proxy') !== 'off') {
    proxyInUse = true;
    try {
      player.useProxy(await openVideo(state.proxy.path, 'The proxy'));
    } catch {
      proxyInUse = false;
    }
  }
}

export function setFormat(format: ExportFormat | undefined): void {
  store.set({ format });
  const project = shownProject();
  if (project) player?.setProject(project);
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

export function openExport(): void {
  store.set({ exportOpen: true, ...(!store.get().exporting && { exportEnd: undefined, exportProgress: undefined }) });
}

export function closeExport(): void {
  store.set({ exportOpen: false });
}

export async function startExport(formats: ExportFormat[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined });
  try {
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
}

export function cancelExport(): void {
  void bridge.invoke('export:cancel');
}
