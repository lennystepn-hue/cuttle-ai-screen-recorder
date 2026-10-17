// The open project in an editor window: the document, its media, the player, the tool and the
// selection, and the export.
import { loadEngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, ProjectInfo, ProjectStatus } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit, flush, openDocument, outsideChange, redo, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
export type Selection = { kind: 'scene' | OverlayKind; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption';

export interface EditorState {
  phase: 'loading' | 'ready' | 'failed';
  error?: string;
  info?: ProjectInfo;
  media?: EditorMedia;
  /** The document: cuttle.json as edited here. */
  doc?: DocState;
  /** The output format the preview shows; undefined: the project's own output. */
  format?: ExportFormat;
  player: PlayerState;
  selection?: Selection;
  tool: Tool;
  tab: 'selection' | 'look';
  /** Snapping on the timeline (Ctrl while dragging turns it off for that drag). */
  snap: boolean;
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
  /** What the main process is doing to the project ("Cutting the take…", or that it could not). */
  status?: ProjectStatus;
  /** The command menu (Ctrl+K) is open. */
  menuOpen: boolean;
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  tool: 'select',
  tab: 'selection',
  snap: true,
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  exportUnseen: false,
  pxPerSecond: 0,
  menuOpen: false,
});

let player: Player | undefined;

export function currentPlayer(): Player | undefined {
  return player;
}

let shown: { project: CuttleProject; format: ExportFormat | undefined; result: CuttleProject } | undefined;

/** The project as the editor shows it: the document (or a drag's preview of it), in the previewed output format. */
export function shownProject(state: EditorState = store.get()): CuttleProject | undefined {
  const project = state.doc?.preview ?? state.doc?.project;
  if (!project) return undefined;
  if (shown?.project !== project || shown.format !== state.format) shown = { project, format: state.format, result: withFormat(project, state.format) };
  return shown.result;
}

/** The document's project as saved (no preview), in its own format. */
export const documentProject = (): CuttleProject | undefined => store.get().doc?.project;

/** What edits clamp to: the take's length, the screen's size, the output's frame rate. */
export function editLimits(): EditLimits {
  const { media, doc } = store.get();
  return {
    ...(media && { sourceEnd: media.screen.end, screen: media.screen.size }),
    ...(doc && { fps: doc.project.output.fps }),
  };
}

const query = new URLSearchParams(location.search);

/** Opens the window's project: the document, its media through the protocol, the engine's assets, the player. */
export async function openSession(canvas: HTMLCanvasElement): Promise<void> {
  // The status comes before the project is open (the window opens while the take is cut).
  bridge.on('project:status', (status) => {
    store.set({ status: status.text ? status : undefined });
    // A new take records while this editor is hidden: its sound must not reach the mic.
    if (status.state === 'recording') player?.pause();
  });
  try {
    const info = await bridge.invoke('project:info');
    document.title = `${info.name} · Cuttle`;
    const doc = openDocument(info.raw, info.hash, editLimits);
    store.set({ info, doc });
    const [media, assets] = await Promise.all([openProjectMedia(info, doc.project), loadEngineAssets()]);
    player = new Player({
      canvas,
      media,
      assets,
      project: shownProject()!,
      onChange: (state) => store.set({ player: state }),
    });
    store.set({ phase: 'ready', media });
    await player.seek(0);
    followDocument();
    if (query.get('check') === '1') exposeCheckHook(canvas);
    bridge.on('media:state', (state) => void applyMediaState(state));
    void applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
    bridge.on('project:file', (event) => {
      // Another take: its media are opened anew.
      if ('raw' in event && JSON.stringify((event.raw as { sources?: unknown }).sources) !== JSON.stringify(store.get().info?.raw.sources)) {
        location.reload();
        return;
      }
      void outsideChange(event);
    });
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts' } as const;

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
  let last = shownProject();
  let running = Promise.resolve();
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, doc } = store.get();
    if (selection && doc && !doc.project[LISTS[selection.kind]].some((item) => item.id === selection.id)) select(undefined);
    const next = shownProject();
    if (next === last || !next) return;
    last = next;
    running = running.then(async () => {
      const media = store.get().media;
      if (!media || !player) return;
      // An edit that needs a new image, the webcam or the mic shows once they are open.
      const added = await ensureMedia(media, next);
      if (last !== next) return;
      player.update(next, { redrawOnly: added });
      if (added) store.set({ media: { ...media } });
    });
  });
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({ ...store.get().player, duration: player?.duration ?? 0, mediaState: store.get().mediaState, proxyInUse, selection: store.get().selection, tool: store.get().tool }),
      pixels: () => canvas.toDataURL('image/png'),
      /** Switches to the proxy (the check runs with `?proxy=off` to compare frames of the take first). */
      useProxy: async () => {
        const proxy = store.get().mediaState.proxy;
        if (proxy.state === 'ready' && proxy.path) await switchToProxy(proxy.path);
        return proxyInUse;
      },
      /** The document as edited, and whether it is saved. */
      doc: () => {
        const doc = store.get().doc!;
        return { raw: doc.raw, hash: doc.hash, saving: doc.saving, problem: doc.problem, issues: doc.issues, toast: doc.toast, undo: doc.undoLabel, redo: doc.redoLabel };
      },
      edit: (commands: Command[], label: string) => edit(commands, label),
      undo,
      redo,
      flush,
      select: (selection: Selection | undefined) => select(selection),
      tool: (tool: Tool) => setTool(tool),
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
}

export function select(selection: Selection | undefined): void {
  store.set({ selection, ...(selection && { tab: 'selection' as const }) });
}

/** The stage shows the source view: paused, with the Zoom or Mask tool on or a zoom or mask selected (playing shows the video). */
export const sourceViewShown = (state: EditorState): boolean =>
  !state.player.playing && (state.tool === 'zoom' || state.tool === 'mask' || state.selection?.kind === 'zoom' || state.selection?.kind === 'mask');

/** Picks a tool; Esc goes back to Select. Zoom and Mask show the source view. */
export function setTool(tool: Tool): void {
  store.set({ tool });
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

/** Exports what is saved: every edit is written first (the export reads the file). */
export async function startExport(formats: ExportTarget[], encoder: 'auto' | 'hardware' | 'software'): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    await flush();
    await bridge.invoke('export:start', { formats, encoder });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
}

export function cancelExport(): void {
  void bridge.invoke('export:cancel');
}
