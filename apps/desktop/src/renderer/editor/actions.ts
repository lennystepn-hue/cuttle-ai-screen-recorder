// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import { MOTION_TEMPLATES, MUSIC_TEMPLATES } from '@cuttle/motion-kit';
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { clickZooms, sceneSpans, shownClicks, TEXT_FADE_SECONDS, type SceneSpan, type ZoomScreen } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit, projectAfter, toast } from './doc';
import { speedCommands } from '../../shared/speed';
import { currentPlayer, documentProject, select, setTool, store, type Selection, type Tool, selectedItems } from './session';

/** Output seconds a new zoom or caption lasts. */
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Exclude<Selection['kind'], 'music'>, ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts', annotation: 'annotations', motion: 'overlays', cut: 'cuts', crop: 'scenes', sound: 'sounds' };
/** What people call a scene of each type. */
const SCENE_NOUNS: Record<Scene['type'], string> = { clip: 'clip', still: 'page', card: 'card', motion: 'motion scene' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', annotations: 'annotation', overlays: 'motion overlay', cuts: 'cut', sounds: 'sound' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
  t: number;
  /** The span (a piece of a clip with cuts in it). */
  span: SceneSpan;
  /** The scene's index in the project's `scenes`. */
  index: number;
  clip?: ClipScene;
  source?: number;
}

export function playheadPlace(t = currentPlayer()?.current().t ?? 0): PlayheadPlace | undefined {
  // the document's scenes, not the player's (it follows an edit a moment later)
  const project = documentProject();
  const spans = project ? sceneSpans(project.scenes, project.cuts) : [];
  const found = spans.findIndex((span) => t >= span.start && t < span.end);
  const span = spans[found >= 0 ? found : spans.length - 1];
  if (!span) return undefined;
  const index = span.sceneIndex;
  const scene = project!.scenes[index]!;
  if (scene.type !== 'clip' || span.scene.type !== 'clip') return { t, span, index };
  // the clip as the project has it (for its id and edits), the source second from the piece shown
  const piece = span.scene;
  return { t, span, index, clip: scene, source: Math.min(piece.to, piece.from + (Math.min(t, span.end) - span.start) * piece.speed) };
}

/**
 * Why a zoom, mask or caption cannot be placed at the playhead (on a still, a card, inside a
 * crossfade), said for the tooltip; undefined where it can.
 */
export function overlayBlocked(t = currentPlayer()?.current().t ?? 0): string | undefined {
  const place = playheadPlace(t);
  if (!place) return 'There is nothing in the video yet';
  if (!place.clip) return `Zooms, masks and captions go on clips, not on a ${SCENE_NOUNS[place.span.scene.type]}: move the playhead onto a clip`;
  if ((currentPlayer()?.clipsAt(t) ?? 1) > 1) return 'Zooms, masks and captions do not go inside a crossfade: move the playhead a little';
  return undefined;
}

/** A tool by its key or the menu: Zoom, Mask and Caption say why when nothing can go at the playhead. */
export function chooseTool(tool: Tool): void {
  const blocked = tool === 'select' || store.get().tool === tool ? undefined : overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  setTool(tool);
}

/** The screen's size, and its scale when the take says one (zooms on clicks are sized by it, as suggest sizes them). */
const screenSize = (): ZoomScreen => {
  const media = store.get().media;
  return media ? { ...media.screen.size, ...(media.scale !== undefined && { scale: media.scale }) } : { width: 1920, height: 1080 };
};

/** Splits the clip under the playhead there (a continuous cut). */
export function split(): void {
  const place = playheadPlace();
  if (!place?.clip || place.source === undefined) return toast('Move the playhead onto a clip to split it.', { tone: 'warning' });
  const frame = place.clip.speed / (documentProject()?.output.fps ?? 30);
  if (place.source - place.clip.from < frame || place.clip.to - place.source < frame) return toast('The playhead is at the clip’s edge: nothing to split.', { tone: 'warning' });
  edit([{ type: 'split', id: place.clip.id!, at: place.source }], 'Split clip');
}

export function deleteSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  // several: all of them, one step to undo
  const items = selectedItems();
  if (items.length > 1) {
    const commands = items.map((item): Command => ({ type: 'delete', list: LIST_OF[item.kind as Exclude<Selection['kind'], 'music'>], id: item.id }));
    if (edit(commands, `Delete ${items.length} items`)) select(undefined);
    return;
  }
  if (selection.kind === 'music') {
    if (edit([{ type: 'music', fields: null }], 'Remove the music')) select(undefined);
    return;
  }
  // a crop belongs to its clip: deleting it shows the whole screen again
  if (selection.kind === 'crop') {
    if (edit([{ type: 'set', list: 'scenes', id: selection.id, fields: { crop: undefined } }], 'Remove crop')) select({ kind: 'scene', id: selection.id });
    return;
  }
  const list = LIST_OF[selection.kind];
  if (edit([{ type: 'delete', list, id: selection.id }], `Delete ${NAMES[list]}`)) select(undefined);
}

/** Turns the selected items on or off (those that can be: not a scene), one step to undo. */
export function switchSelection(on: boolean): void {
  const project = documentProject();
  if (!project) return;
  const commands = selectedItems().flatMap((item): Command[] => {
    if (item.kind === 'music') return project.music ? [{ type: 'music', fields: { enabled: on ? undefined : false } }] : [];
    if (item.kind === 'scene' || item.kind === 'crop') return [];
    return [{ type: 'set', list: LIST_OF[item.kind], id: item.id, fields: { enabled: on ? undefined : false } }];
  });
  if (commands.length > 0) edit(commands, on ? `Turn ${commands.length} items on` : `Turn ${commands.length} items off`);
}

/** A copy of the selection right after it (an overlay a second later in its source). */
export function duplicateSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const items = selectedItems();
  if (items.length > 1) {
    // a cut is cut once: the others are copied
    const copied = items.filter((item) => item.kind !== 'cut');
    if (copied.length === 0) return toast('A cut cannot be copied: the same stretch is cut once.', { tone: 'warning' });
    const commands = copied.map((item): Command => {
      const list = LIST_OF[item.kind as Exclude<Selection['kind'], 'music'>];
      return { type: 'duplicate', list, id: item.id, ...(list !== 'scenes' && { shift: 1 }) };
    });
    edit(commands, `Duplicate ${copied.length} items`);
    return;
  }
  if (selection.kind === 'cut') return toast('A cut cannot be copied: the same stretch is cut once.', { tone: 'warning' });
  if (selection.kind === 'crop') return toast('A crop belongs to its clip: duplicate the clip instead.', { tone: 'warning' });
  if (selection.kind === 'music') return toast('A video has one music: change its page or its params instead.', { tone: 'warning' });
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}

/** Sets a clip's speed (the selected clip, else the one under the playhead), with its zooms on clicks placed for it. */
export function setSpeed(speed: number, id = selectedOrCurrentClip()?.id): void {
  if (!id) return toast('Select a clip to change its speed.', { tone: 'warning' });
  const { media } = store.get();
  const project = documentProject();
  edit(project && media ? speedCommands(project, id, speed, media.events, screenSize(), projectAfter) : [{ type: 'speed', id, speed }], `Speed ${speed}×`);
}

/** R (`by` 1) and Shift+R (-1): the selected clip's (or the one at the playhead) next speed of the list. */
export function cycleSpeed(by: 1 | -1): void {
  const clip = selectedOrCurrentClip();
  if (!clip) return toast('Select a clip, or move the playhead onto one, to change its speed.', { tone: 'warning' });
  const at = SPEEDS.findIndex((speed) => speed >= clip.speed - 1e-9);
  const index = at < 0 ? SPEEDS.length : SPEEDS[at] === clip.speed ? at + by : by > 0 ? at : at - 1;
  const speed = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, index))]!;
  if (speed !== clip.speed) setSpeed(speed, clip.id);
}

export function selectedOrCurrentClip(): ClipScene | undefined {
  const project = documentProject();
  const selection = store.get().selection;
  if (selection?.kind === 'scene') {
    const scene = project?.scenes.find((item) => item.id === selection.id);
    if (scene?.type === 'clip') return scene;
  }
  return playheadPlace()?.clip;
}

/** The new item's id is known before the edit: the selection moves to it. */
function addAndSelect(command: Extract<Command, { type: 'add' }>, kind: Selection['kind'], label: string): void {
  const before = new Set(itemIds(documentProject()));
  if (!edit([command], label)) return;
  const added = itemIds(documentProject()).find((id) => !before.has(id));
  if (added) select({ kind, id: added });
}

const itemIds = (project: CuttleProject | undefined) =>
  project ? [...project.scenes, ...project.zooms, ...project.masks, ...project.texts, ...project.annotations, ...project.overlays].map((item) => item.id!).filter(Boolean) : [];

/** A zoom at the playhead: 3 output seconds (so it rests at full zoom for a while), on the middle half of the screen; then the source view to place it. */
export function addZoom(rect?: number[]): void {
  const blocked = overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  const place = playheadPlace()!;
  const clip = place.clip!;
  const screen = screenSize();
  const duration = Math.min(NEW_OVERLAY_SECONDS * clip.speed, clip.to - place.source!);
  addAndSelect({ type: 'add', list: 'zooms', item: { at: place.source!, duration, rect: rect ?? [screen.width / 4, screen.height / 4, screen.width / 2, screen.height / 2] } }, 'zoom', 'Add zoom');
  setTool('zoom');
}

/**
 * Zooms that follow the take's clicks (as `suggest` makes them), added where none is yet: one step
 * to undo. The zooms there, made by suggest or by hand, stay as they are; the new ones keep clear
 * of them and of their starts.
 */
export function autoZoomClicks(): void {
  const { doc, media } = store.get();
  const project = documentProject();
  if (!doc || !media || !project) return;
  if (doc.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  if (media.events.length === 0) return toast('This take has no clicks or keys recorded: there are no clicks to zoom on.', { tone: 'warning' });
  const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) => (span.scene.type === 'clip' ? [{ from: span.scene.from, to: span.scene.to, speed: span.scene.speed, start: span.start }] : []));
  const zooms = clickZooms(media.events, clips, screenSize(), project.zooms);
  if (zooms.length === 0) {
    // why, in one line (it stays on one line at the narrowest window)
    if (shownClicks(media.events, clips) === 0) return toast('There are no clicks in the video to zoom on.');
    const free = shownClicks(media.events, clips, project.zooms);
    if (free === 0) return toast('Every click is under a zoom already.');
    return toast(`No zoom fits ${free === 1 ? 'the click' : `the ${free} clicks`} left: sped up, or near a cut or a zoom.`);
  }
  const commands = zooms.map(
    (zoom) => ({ type: 'add', list: 'zooms', item: { label: zoom.clicks === 1 ? 'Click' : 'Clicks', at: zoom.at, duration: zoom.duration, rect: zoom.rect, ...(zoom.moves && { moves: zoom.moves }), auto: 'click' } }) as Command,
  );
  if (edit(commands, 'Zoom on clicks')) toast(`Added ${zooms.length} zoom${zooms.length === 1 ? '' : 's'} on clicks.`, { undo: true });
}

/**
 * Crops a clip to `rect` (source px): the window shows that part of the screen. The clip is `id`,
 * else the selected one, else the one at the playhead.
 */
export function cropClip(rect: number[], id = selectedOrCurrentClip()?.id): void {
  if (!id) return toast('Select a clip, or move the playhead onto one, to crop it.', { tone: 'warning' });
  if (edit([{ type: 'set', list: 'scenes', id, fields: { crop: { rect } } }], 'Crop clip')) select({ kind: 'crop', id });
}

/**
 * An annotation of the kind the Annotate tool draws (`annotationKind`) at the playhead, 3 output
 * seconds long: over `rect`, or an arrow from `from` to `to` (source px); without them, in the
 * middle of the screen. Then the source view to place it.
 */
export function addAnnotation(at?: { rect?: number[]; from?: number[]; to?: number[] }): void {
  const blocked = overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  const place = playheadPlace()!;
  const clip = place.clip!;
  const screen = screenSize();
  const kind = store.get().annotationKind;
  const duration = Math.min(NEW_OVERLAY_SECONDS * clip.speed, clip.to - place.source!);
  const shape =
    kind === 'arrow'
      ? { from: at?.from ?? [screen.width * 0.3, screen.height * 0.65], to: at?.to ?? [screen.width * 0.45, screen.height * 0.5] }
      : { rect: at?.rect ?? [screen.width * 0.4, screen.height * 0.4, screen.width * 0.2, screen.height * 0.15] };
  addAndSelect({ type: 'add', list: 'annotations', item: { kind, at: place.source!, duration, ...shape } }, 'annotation', 'Add annotation');
  setTool('annotate');
}

/** A mask from the playhead to the clip's end; then the source view to place it. */
export function addMask(rect?: number[]): void {
  const blocked = overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  const place = playheadPlace()!;
  const clip = place.clip!;
  const screen = screenSize();
  addAndSelect({ type: 'add', list: 'masks', item: { from: place.source!, to: clip.to, rect: rect ?? [screen.width * 0.35, screen.height * 0.45, screen.width * 0.3, screen.height * 0.1] } }, 'mask', 'Add mask');
  setTool('mask');
}

export type CaptionPosition = 'top' | 'center' | 'bottom';

/**
 * The command that adds a caption at the playhead (the caption tool previews it while typing);
 * undefined where none can go. It starts a fade earlier, so it is fully shown at the playhead, and
 * stays 3 output seconds after it.
 */
export function captionCommand(text: string, position: CaptionPosition): Extract<Command, { type: 'add' }> | undefined {
  if (overlayBlocked()) return undefined;
  const place = playheadPlace()!;
  const clip = place.clip!;
  const source = place.source!;
  const fps = documentProject()?.output.fps ?? 30;
  const at = Math.max(clip.from, source - (TEXT_FADE_SECONDS + 1 / fps) * clip.speed);
  const duration = Math.min(source - at + NEW_OVERLAY_SECONDS * clip.speed, clip.to - at);
  return { type: 'add', list: 'texts', item: { at, duration, text, position } };
}

/** The positions of the captions shown at the playhead (two at one position cover each other). */
export function captionPositionsAt(): Set<CaptionPosition> {
  const source = playheadPlace()?.source;
  return new Set((documentProject()?.texts ?? []).filter((text) => text.enabled && source !== undefined && source >= text.at && source < text.at + text.duration).map((text) => text.position));
}

/** Where a new caption goes: the first of bottom, top and middle that no caption shown at the playhead uses. */
export function freeCaptionPosition(): CaptionPosition {
  const used = captionPositionsAt();
  return (['bottom', 'top', 'center'] as const).find((position) => !used.has(position)) ?? 'bottom';
}

export function addCaption(text: string, position: CaptionPosition = 'bottom'): void {
  const command = captionCommand(text, position);
  if (!command) return toast(overlayBlocked() ?? 'A caption cannot go here.', { tone: 'warning' });
  addAndSelect(command, 'caption', 'Add caption');
}

/** Where a new scene goes: after the scene under the playhead. */
const insertIndex = () => (playheadPlace()?.index ?? -1) + 1;

export function addCard(): void {
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'card', title: 'Title', duration: 3 } }, 'scene', 'Add card');
}

/** A page: an image chosen by the person (copied into the project), scrolled through in a browser frame. */
export async function addPage(): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose: 'still' });
  if (!chosen) return;
  addAndSelect({ type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'still', image: chosen.path, duration: 4, motion: 'scroll', frame: 'browser-light' } }, 'scene', 'Add page');
}

/** "lower-third" (or "lower-third-2", a second copy) as a label: "Lower third". */
export const templateLabel = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-\d+$/, '').replace(/-/g, ' ')}`.replace(/ 3d\b/, ' 3D');

/**
 * A motion template of the kit: its page is copied into the project's `motion/` folder, and it goes
 * in as a scene after the scene under the playhead, or as an overlay on the clip there (one that
 * follows the take, over all the clips). The playhead moves to it.
 */
export async function addMotion(name: string): Promise<void> {
  const template = MOTION_TEMPLATES.find((candidate) => candidate.name === name);
  const project = documentProject();
  if (!template || !project) return;
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  const clips = project.scenes.filter((scene): scene is ClipScene => scene.type === 'clip');
  const place = playheadPlace();
  if (template.kind === 'overlay' && clips.length === 0) return toast('A motion overlay goes over a clip, and this video has none: add a motion scene instead.', { tone: 'warning' });
  if (template.kind === 'overlay' && !template.whole && !place?.clip) return toast('A motion overlay goes on a clip: move the playhead onto one.', { tone: 'warning' });
  let src: string;
  try {
    ({ src } = await bridge.invoke('motion:add-template', name));
  } catch (error) {
    return toast(`The template could not be copied: ${error instanceof Error ? error.message : String(error)}`, { tone: 'warning' });
  }
  const label = templateLabel(src.split('/')[1] ?? name);
  let command: Extract<Command, { type: 'add' }>;
  if (template.kind === 'scene') command = { type: 'add', list: 'scenes', index: insertIndex(), item: { type: 'motion', label, src, duration: template.duration } };
  else if (template.whole) {
    const at = Math.min(...clips.map((clip) => clip.from));
    command = { type: 'add', list: 'overlays', item: { label, src, at, duration: Math.max(...clips.map((clip) => clip.to)) - at } };
  } else {
    const clip = place!.clip!;
    const at = place!.source!;
    command = { type: 'add', list: 'overlays', item: { label, src, at, duration: Math.max(0.1, Math.min(template.duration * clip.speed, clip.to - at)) } };
  }
  const before = new Set(itemIds(documentProject()));
  if (!edit([command], `Add ${label}`)) return;
  const added = itemIds(documentProject()).find((id) => !before.has(id));
  if (added) reveal(command.list, added);
}

/**
 * Copies a music template into `music/<name>/` and makes it the video's music (its level and duck stay
 * when the video had music before); the music lane is selected.
 */
export async function addMusic(name: string): Promise<void> {
  if (!MUSIC_TEMPLATES.some((candidate) => candidate.name === name) || !documentProject()) return;
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  let src: string;
  try {
    ({ src } = await bridge.invoke('sound:add-template', name));
  } catch (error) {
    return toast(`The music template could not be copied: ${error instanceof Error ? error.message : String(error)}`, { tone: 'warning' });
  }
  if (edit([{ type: 'music', fields: { src, params: undefined, enabled: undefined } }], `Music: ${templateLabel(name)}`)) select({ kind: 'music', id: 'music' });
}

/**
 * A sound at the playhead: on a clip at the source second it shows (it plays wherever the video shows
 * that moment), elsewhere that many seconds into the scene; the sound is selected.
 */
export function addSound(sound = 'pop'): void {
  const project = documentProject();
  const place = playheadPlace();
  if (!project || !place) return toast('There is nothing in the video yet to put a sound on.', { tone: 'warning' });
  if (store.get().doc?.issues) return toast('cuttle.json has a mistake; fix it first (Claude or a text editor), then edit here again.', { tone: 'warning' });
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let item: Record<string, unknown>;
  if (place.clip && place.source !== undefined) item = { sound, at: round(place.source) };
  else {
    const scene = project.scenes[place.index]!;
    if (!scene.id) return;
    item = { sound, at: round(Math.max(0, place.t - place.span.start)), scene: scene.id };
  }
  const before = new Set(project.sounds.map((entry) => entry.id));
  if (!edit([{ type: 'add', list: 'sounds', item }], `Add sound: ${sound}`)) return;
  const added = documentProject()?.sounds.find((entry) => entry.id !== undefined && !before.has(entry.id));
  if (added?.id) select({ kind: 'sound', id: added.id });
}

/** Replaces a still's image, the background's, the brand's logo or the watermark's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background' | 'logo' | 'watermark', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else if (purpose === 'logo') edit([{ type: 'theme', fields: { logo: chosen.path } }], 'Logo');
  else if (purpose === 'watermark') edit([{ type: 'look', path: ['watermark', 'image'], value: chosen.path }], 'Watermark image');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

/** What selecting an item of each list selects. */
const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption', annotations: 'annotation', overlays: 'motion', cuts: 'cut', sounds: 'sound' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
  const project = documentProject();
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  select({ kind: KIND_OF[list], id });
  const spans = sceneSpans(project.scenes, project.cuts);
  const sceneIndex = list === 'scenes' ? project.scenes.indexOf(item as Scene) : -1;
  const at =
    list === 'scenes'
      ? spans.find((span) => span.sceneIndex === sceneIndex)?.start
      : list === 'cuts'
        ? cutShownAt(spans, item as { from: number; to: number; enabled: boolean })
        : outputTimesOf(spans, 'at' in item ? item.at : 'from' in item ? item.from : 0)[0];
  if (at !== undefined) void currentPlayer()?.seek(at);
}

/** Where the video shows a cut: the frame right after it (off: where it would start); undefined when no clip covers it. */
export function cutShownAt(spans: readonly SceneSpan[], cut: { from: number; to: number; enabled: boolean }): number | undefined {
  if (!cut.enabled) return outputTimesOf(spans, cut.from)[0];
  const after = spans.find((span) => span.scene.type === 'clip' && span.scene.from >= cut.to - 1e-6 && span.scene.from <= cut.to + 1e-6);
  return after?.start ?? outputTimesOf(spans, cut.to)[0] ?? outputTimesOf(spans, Math.max(0, cut.from - 1e-3))[0];
}

/** One clip over the whole take, instead of the cut (undo brings the cut back). */
export function showRawTake(): void {
  const media = store.get().media;
  if (!media) return;
  const scenes: Scene[] = [{ type: 'clip', from: Math.max(0, media.screen.start), to: media.screen.end, speed: 1 }];
  if (edit([{ type: 'scenes', scenes: scenes as unknown as Record<string, unknown>[] }], 'Show raw take')) select(undefined);
}
