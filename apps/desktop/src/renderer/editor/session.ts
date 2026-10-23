// The open project in an editor window: the document, its media, the player, the tool and the
// selection, and the export.
import { loadEngineAssets, type EngineAssets } from '@cuttle/engine';
import { withFormat, type ExportFormat } from '@cuttle/export/formats';
import type { CuttleProject, AnnotationKind } from '@cuttle/project';
import type { Command, EditLimits } from '../../shared/document';
import type { ExportEnd, ExportProgress, ExportTarget, MediaState, MotionStatusView, ProjectInfo, ProjectStatus, SoundStatusView } from '../../shared/ipc';
import type { OverlayKind } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { beforeClose, dismissToast, edit, flush, offerUndoRestart, openDocument, outsideChange, redo, toast, undo, type DocState } from './doc';
import { ensureMedia, openProjectMedia, openVideo, unspokenLines, type EditorMedia } from './media';
import { Player, type PlayerState } from './player';
import type { Soundtrack } from './soundtrack';
import { createStore } from './store';

/** What is selected: a scene or an overlay by id, an overlay with the stretch of the video where it was clicked. */
/** What is selected; a `crop` is a clip's (its id is the clip's); the `music` is the project's one (its id is `music`). */
export type Selection = { kind: 'scene' | OverlayKind | 'cut' | 'crop' | 'music'; id: string; start?: number; end?: number };

/** The tools: V selects; Z and M draw zooms and masks in the source view; T adds a caption. */
export type Tool = 'select' | 'zoom' | 'mask' | 'caption' | 'crop' | 'annotate';

/** The look's parts, as the Look tab lists them. */
export type LookSection = 'brand' | 'watermark' | 'background' | 'window' | 'cursor' | 'keys' | 'camera' | 'subtitles' | 'sound' | 'video';

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
  /** The other selected items, besides `selection` (Shift- or Ctrl/⌘-click, a rubber band on the timeline): edited together. */
  also: Selection[];
  tool: Tool;
  tab: 'selection' | 'auto' | 'transcript' | 'voice' | 'look';
  /** The part of the look that is open (one at a time; none once it is closed). */
  lookSection?: LookSection;
  /** The inspector's Advanced fields are open (they stay so from one selection to the next). */
  advancedOpen: boolean;
  /** The inspector is hidden (the video and the timeline take its room); kept by layout.tsx. */
  inspectorHidden: boolean;
  /** Ctrl+F asked for the Transcript tab's find field (a new number each time). */
  findRequest?: number;
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
  /** The motion items' pages in the preview: loading, ready or failed, and what they said. */
  motionStatus: MotionStatusView[];
  /** Counts the changes to the project's files (a motion page edited): what was read from them is read again. */
  motionFiles: number;
  /** The music and sounds: rendering, ready or failed, and what the music page said. */
  soundStatus: SoundStatusView;
  /** The soundtrack rendered last (it plays while a newer one renders). */
  soundtrack?: Soundtrack;
  /** What the Annotate tool draws. */
  annotationKind: AnnotationKind;
  /** The narration: its lines being spoken, or why they could not be (a voice to download, ElevenLabs' key). */
  voiceStatus: { state: 'idle' | 'speaking' | 'failed'; message?: string };
}

export const store = createStore<EditorState>({
  phase: 'loading',
  player: { t: 0, playing: false },
  also: [],
  tool: 'select',
  tab: 'selection',
  lookSection: 'background',
  advancedOpen: false,
  inspectorHidden: false,
  snap: true,
  mediaState: { seq: -1, proxy: { state: 'none' }, thumbnails: { state: 'none' }, peaks: { state: 'none' } },
  exportOpen: false,
  exporting: false,
  exportUnseen: false,
  pxPerSecond: 0,
  menuOpen: false,
  motionStatus: [],
  motionFiles: 0,
  soundStatus: { state: 'none', errors: [], console: [], skipped: [] },
  voiceStatus: { state: 'idle' },
  annotationKind: 'arrow',
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
  // The window closes once the last edits are written (from the first moment: a project that is
  // still opening has none).
  bridge.on('project:closing', () => void beforeClose().finally(() => void bridge.invoke('project:closed')));
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
    engineAssets = assets;
    player = new Player({
      canvas,
      media,
      assets,
      project: shownProject()!,
      onChange: (state) => store.set({ player: state }),
      // the check compares the editor's motion frames with the export's
      fullSizeMotion: query.get('check') === '1',
    });
    // the check's hook before "ready", which the check waits for (the first frame's seek comes after)
    if (query.get('check') === '1') exposeCheckHook(canvas);
    store.set({ phase: 'ready', media });
    player.setSoundtrack(store.get().soundtrack);
    await player.seek(0);
    followDocument();
    // lines written while the editor was closed (by Claude, the CLI) are spoken now
    if (unspokenLines(media, shownProject()!).length > 0) speakSoon();
    bridge.on('media:state', (state) => void applyMediaState(state));
    void applyMediaState(await bridge.invoke('media:state'));
    bridge.on('export:progress', (progress) => store.set({ exportProgress: progress }));
    bridge.on('export:end', (end) => store.set((state) => ({ exportEnd: end, exporting: false, exportUnseen: !state.exportOpen })));
    // (another take reloads the editor: outsideChange asks the main process)
    bridge.on('project:file', (event) => void outsideChange(event));
    // A restarted take: the one before it is kept aside, and can be the take again.
    bridge.on('project:restarted', ({ discarded }) => offerUndoRestart(discarded));
    // a motion page changed (Claude edited it): its frames, params and errors anew
    bridge.on('motion:status', (statuses) => store.set({ motionStatus: statuses }));
    // the music and sounds: each version of the project renders in the main process, and plays here once it is in
    bridge.on('sound:status', (status) => void applySoundStatus(status));
    followSound();
    void bridge.invoke('sound:status').then(applySoundStatus);
    bridge.on('motion:changed', ({ files }) => {
      store.set({ motionFiles: files });
      player?.motionFilesChanged();
    });
    // what happened to the take (an undone restart), once it is in
    bridge.on('project:note', ({ text }) => toast(text));
  } catch (error) {
    store.set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

const LISTS = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', annotation: 'annotations', motion: 'overlays', cut: 'cuts', crop: 'scenes', sound: 'sounds' } as const;

/** Whether the selected item is still in the project. */
function stillThere(selection: Selection, project: CuttleProject): boolean {
  if (selection.kind === 'music') return project.music !== undefined;
  return (project[LISTS[selection.kind]] as { id?: string }[]).some((item) => item.id === selection.id);
}

/**
 * Whether a project may have music or sounds (to render, or to stop rendering once it has none): its
 * own, or ones its motion pages ask for.
 */
const hasSound = (project: CuttleProject) =>
  project.music !== undefined ||
  project.sounds.length > 0 ||
  project.overlays.length > 0 ||
  project.scenes.some((scene) => scene.type === 'motion' || scene.transition !== undefined);

/** The document's project goes to the main process at each edit: it renders its music and sounds a moment later. */
function followSound(): void {
  let last: CuttleProject | undefined;
  let version = 0;
  const send = () => {
    const project = store.get().doc?.project;
    if (!project || project === last) return;
    const before = last;
    last = project;
    if (!hasSound(project) && !(before && hasSound(before))) return;
    void bridge.invoke('sound:project', { version: ++version, raw: project as unknown as Record<string, unknown> }).catch(() => {});
  };
  store.subscribe(send);
  send();
}

/** A new state of the soundtrack: a new render is fetched and plays from then on; none stops it. */
async function applySoundStatus(status: SoundStatusView): Promise<void> {
  store.set({ soundStatus: status });
  if (status.state === 'none') {
    store.set({ soundtrack: undefined });
    player?.setSoundtrack(undefined);
    return;
  }
  if (!status.key || status.key === store.get().soundtrack?.key) return;
  const track = await bridge.invoke('sound:soundtrack', status.key).catch(() => null);
  if (!track || store.get().soundStatus.key !== track.key) return;
  store.set({ soundtrack: track });
  player?.setSoundtrack(track);
}

/** The player follows the document (edits, previews, outside changes) and the previewed format. */
function followDocument(): void {
  let last = shownProject();
  let running = Promise.resolve();
  store.subscribe(() => {
    // a selection whose item an undo or an outside change removed is cleared
    const { selection, also, doc } = store.get();
    if (selection && doc && !stillThere(selection, doc.project)) select(undefined);
    else if (doc && also.some((item) => !stillThere(item, doc.project))) store.set({ also: also.filter((item) => stillThere(item, doc.project)) });
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
      // lines written or changed are spoken once the typing rests
      if (unspokenLines(media, next).length > 0) speakSoon();
    });
  });
}

/** What a failed request says, without Electron's "Error invoking remote method …: Error:" before it. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

/** Lines are spoken this long after the last edit (typing a line speaks it once, at its end). */
const SPEAK_AFTER_MS = 800;
let speakTimer: ReturnType<typeof setTimeout> | undefined;
let speaking = false;
let speakAgain = false;

/** Speaks the narration's lines not spoken yet, soon. */
export function speakSoon(): void {
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => void speakNow(), SPEAK_AFTER_MS);
}

/**
 * Has the main process speak the lines not spoken yet (of the project as edited here), then reads
 * them: the player plays them and the captions show their words. One run at a time; an edit while it
 * speaks runs it again after.
 */
async function speakNow(): Promise<void> {
  if (speaking) return void (speakAgain = true);
  speaking = true;
  try {
    do {
      speakAgain = false;
      const { doc, media } = store.get();
      if (!doc || !media || unspokenLines(media, doc.project).length === 0) break;
      store.set({ voiceStatus: { state: 'speaking' } });
      try {
        await bridge.invoke('voice:speak', { raw: doc.raw });
      } catch (error) {
        store.set({ voiceStatus: { state: 'failed', message: messageOf(error) } });
        break;
      }
      store.set({ voiceStatus: { state: 'idle' } });
      const project = shownProject();
      if (project && player && (await ensureMedia(media, project))) {
        player.update(project, { redrawOnly: true });
        store.set({ media: { ...media } });
      }
    } while (speakAgain);
  } finally {
    speaking = false;
  }
}

/** What the end-to-end check drives and reads (only with `?check=1`). */
function exposeCheckHook(canvas: HTMLCanvasElement): void {
  Object.assign(window, {
    __cuttleCheck: {
      seek: (t: number) => player?.seek(t),
      playback: () => player?.stats(),
      state: () => ({
        ...store.get().player,
        duration: player?.duration ?? 0,
        mediaState: store.get().mediaState,
        proxyInUse,
        selection: store.get().selection,
        tool: store.get().tool,
        motion: { status: store.get().motionStatus, files: store.get().motionFiles },
        sound: { status: store.get().soundStatus, track: store.get().soundtrack?.key, seconds: store.get().soundtrack ? store.get().soundtrack!.music.length / 2 / store.get().soundtrack!.rate : 0 },
      }),
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
        return { raw: doc.raw, hash: doc.hash, saving: doc.saving, problem: doc.problem, issues: doc.issues, toast: doc.toast, draftNote: doc.draftNote, restartNote: doc.restartNote, undo: doc.undoLabel, redo: doc.redoLabel };
      },
      edit: (commands: Command[], label: string) => edit(commands, label),
      undo,
      redo,
      flush,
      select: (selection: Selection | undefined) => select(selection),
      /** The timeline's scale: pixels a second. */
      pps: () => store.get().pxPerSecond,
      tool: (tool: Tool) => setTool(tool),
    },
  });
}

/** The engine's fonts and images, once the project opened (the Look tab's swatches draw with them). */
export let engineAssets: EngineAssets | undefined;

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
  dismissWarning();
  store.set({ selection, also: [], ...(selection && { tab: 'selection' as const }) });
}

const same = (a: Selection, b: Selection) => a.kind === b.kind && a.id === b.id;

/** What can be selected with others: anything but the music and a clip's crop (each is one of its own). */
export const groupable = (item: Selection) => item.kind !== 'music' && item.kind !== 'crop';

/** Adds an item to the selection, or takes it out when it is in (Shift- or Ctrl/⌘-click on the timeline). */
export function toggleSelect(item: Selection): void {
  const { selection, also } = store.get();
  if (!selection || !groupable(item) || !groupable(selection)) return select(item);
  dismissWarning();
  if (same(selection, item)) {
    const [next, ...rest] = also;
    return store.set({ selection: next, also: rest });
  }
  if (also.some((each) => same(each, item))) return store.set({ also: also.filter((each) => !same(each, item)) });
  // the one clicked last is the one the inspector would show alone
  store.set({ selection: item, also: [...also, selection], tab: 'selection' });
}

/** Selects these items together (a rubber band); none leaves nothing selected. */
export function selectMany(items: readonly Selection[]): void {
  const kept = items.filter(groupable);
  if (kept.length <= 1) return select(kept[0]);
  dismissWarning();
  store.set({ selection: kept.at(-1), also: kept.slice(0, -1), tab: 'selection' });
}

/** Every selected item: the selection, then the others. */
export const selectedItems = (state: Pick<EditorState, 'selection' | 'also'> = store.get()): Selection[] => (state.selection ? [state.selection, ...state.also] : []);

/** A warning (an edit that was not possible) is about what was being done: a new selection or tool ends it. */
function dismissWarning(): void {
  if (store.get().doc?.toast?.tone === 'warning') dismissToast();
}

/** The stage shows the source view: paused, with the Zoom or Mask tool on or a zoom or mask selected (playing shows the video). */
export const sourceViewShown = (state: EditorState): boolean =>
  !state.player.playing &&
  (state.tool === 'zoom' ||
    state.tool === 'mask' ||
    state.tool === 'crop' ||
    state.tool === 'annotate' ||
    state.selection?.kind === 'zoom' ||
    state.selection?.kind === 'mask' ||
    state.selection?.kind === 'crop' ||
    state.selection?.kind === 'annotation');

/** Picks a tool; Esc goes back to Select. Zoom, Mask, Crop and Annotate show the source view. */
export function setTool(tool: Tool): void {
  dismissWarning();
  // the Annotate tool's picker (what it draws) is in the selection's tab
  store.set({ tool, ...(tool === 'annotate' && { tab: 'selection' as const }) });
}

/** Opens the export sheet: on the running export or one that ended unseen, else on a new one. */
export function openExport(): void {
  const { phase, exporting, exportUnseen, doc } = store.get();
  // nothing to export without a scene (the title bar's Export is off then too)
  if (phase !== 'ready' || (!exporting && (doc?.project.scenes.length ?? 0) === 0)) return;
  store.set({ exportOpen: true, exportUnseen: false, ...(!exporting && !exportUnseen && { exportEnd: undefined, exportProgress: undefined }) });
}

export function closeExport(): void {
  store.set({ exportOpen: false });
}

/** Exports what is saved: every edit is written first (the export reads the file). */
export async function startExport(
  formats: ExportTarget[],
  encoder: 'auto' | 'hardware' | 'software',
  subtitles: { captions?: boolean; files?: ('srt' | 'vtt')[] } = {},
): Promise<void> {
  store.set({ exporting: true, exportEnd: undefined, exportProgress: undefined, exportStarted: Date.now() });
  try {
    if (!(await flush())) throw new Error(`your latest edits are not saved (${store.get().doc?.problem ?? 'cuttle.json has a mistake'}), so the export would not have them. Save them first (Try again in the title bar).`);
    await bridge.invoke('export:start', {
      formats,
      encoder,
      ...(subtitles.captions !== undefined && { captions: subtitles.captions }),
      ...(subtitles.files && subtitles.files.length > 0 && { subtitles: subtitles.files }),
    });
  } catch (error) {
    store.set({ exporting: false, exportEnd: { state: 'failed', files: [], format: formats[0]!, code: 'internal', message: (error as Error).message } });
  }
}

export function cancelExport(): void {
  void bridge.invoke('export:cancel');
}
