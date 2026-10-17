// The editor's actions on the document (the timeline bar, the keys, the command menu and the tools
// call these): each is one step to undo. Where the playhead stands decides where things go.
import type { ClipScene, CuttleProject, Scene } from '@cuttle/project';
import { sceneSpans, TEXT_FADE_SECONDS, type SceneSpan } from '@cuttle/timeline';
import type { Command, ListName } from '../../shared/document';
import { outputTimesOf } from '../../shared/timeline-model';
import { bridge } from '../bridge';
import { edit, toast } from './doc';
import { currentPlayer, documentProject, select, setTool, store, type Selection, type Tool } from './session';

/** Output seconds a new zoom or caption lasts. */
export const NEW_OVERLAY_SECONDS = 3;
export const SPEEDS = [1, 2, 4, 8, 12, 20] as const;

export const LIST_OF: Record<Selection['kind'], ListName> = { scene: 'scenes', zoom: 'zooms', mask: 'masks', caption: 'texts' };
const NAMES: Record<ListName, string> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption' };

/** Where the playhead is: its scene and, in a clip, the source second it shows. */
export interface PlayheadPlace {
  t: number;
  span: SceneSpan;
  index: number;
  clip?: ClipScene;
  source?: number;
}

export function playheadPlace(t = currentPlayer()?.current().t ?? 0): PlayheadPlace | undefined {
  // the document's scenes, not the player's (it follows an edit a moment later)
  const project = documentProject();
  const spans = project ? sceneSpans(project.scenes) : [];
  const index = spans.findIndex((span) => t >= span.start && t < span.end);
  const at = index >= 0 ? index : spans.length - 1;
  const span = spans[at];
  if (!span) return undefined;
  if (span.scene.type !== 'clip') return { t, span, index: at };
  const clip = span.scene;
  return { t, span, index: at, clip, source: Math.min(clip.to, clip.from + (Math.min(t, span.end) - span.start) * clip.speed) };
}

/**
 * Why a zoom, mask or caption cannot be placed at the playhead (on a still, a card, inside a
 * crossfade), said for the tooltip; undefined where it can.
 */
export function overlayBlocked(t = currentPlayer()?.current().t ?? 0): string | undefined {
  const place = playheadPlace(t);
  if (!place) return 'There is nothing in the video yet';
  if (!place.clip) return place.span.scene.type === 'still' ? 'Not on a page: move the playhead onto a clip' : 'Not on a card: move the playhead onto a clip';
  if ((currentPlayer()?.clipsAt(t) ?? 1) > 1) return 'Not inside a crossfade: move the playhead a little';
  return undefined;
}

/** A tool by its key or the menu: Zoom, Mask and Caption say why when nothing can go at the playhead. */
export function chooseTool(tool: Tool): void {
  const blocked = tool === 'select' || store.get().tool === tool ? undefined : overlayBlocked();
  if (blocked) return toast(blocked, { tone: 'warning' });
  setTool(tool);
}

const screenSize = () => store.get().media?.screen.size ?? { width: 1920, height: 1080 };

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
  const list = LIST_OF[selection.kind];
  if (edit([{ type: 'delete', list, id: selection.id }], `Delete ${NAMES[list]}`)) select(undefined);
}

/** A copy of the selection right after it (an overlay a second later in its source). */
export function duplicateSelection(): void {
  const selection = store.get().selection;
  if (!selection) return;
  const list = LIST_OF[selection.kind];
  edit([{ type: 'duplicate', list, id: selection.id, ...(list !== 'scenes' && { shift: 1 }) }], `Duplicate ${NAMES[list]}`);
}

/** Sets a clip's speed (the selected clip, else the one under the playhead). */
export function setSpeed(speed: number, id = selectedOrCurrentClip()?.id): void {
  if (!id) return toast('Select a clip to change its speed.', { tone: 'warning' });
  edit([{ type: 'speed', id, speed }], `Speed ${speed}×`);
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

const itemIds = (project: CuttleProject | undefined) => (project ? [...project.scenes, ...project.zooms, ...project.masks, ...project.texts].map((item) => item.id!).filter(Boolean) : []);

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

/** Where a new caption goes: the first of bottom, top and middle that no caption shown at the playhead uses. */
export function freeCaptionPosition(): CaptionPosition {
  const source = playheadPlace()?.source;
  const used = new Set((documentProject()?.texts ?? []).filter((text) => text.enabled && source !== undefined && source >= text.at && source < text.at + text.duration).map((text) => text.position));
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

/** Replaces a still's image or the background's with one the person picks. */
export async function chooseImage(purpose: 'still' | 'background', id?: string): Promise<void> {
  const chosen = await bridge.invoke('project:import-image', { purpose });
  if (!chosen) return;
  if (purpose === 'still' && id) edit([{ type: 'set', list: 'scenes', id, fields: { image: chosen.path } }], 'Replace image');
  else edit([{ type: 'look', path: ['background'], value: { preset: 'image', image: chosen.path } }], 'Background image');
}

const KIND_OF: Record<ListName, Selection['kind']> = { scenes: 'scene', zooms: 'zoom', masks: 'mask', texts: 'caption' };

/** Selects an item and moves the playhead to where the video first shows it (the toast's "Show"). */
export function reveal(list: ListName, id: string): void {
  const project = documentProject();
  const item = project?.[list].find((candidate) => candidate.id === id);
  if (!project || !item) return;
  select({ kind: KIND_OF[list], id });
  const spans = sceneSpans(project.scenes);
  const at = list === 'scenes' ? spans.find((span) => span.scene === item)?.start : outputTimesOf(spans, 'at' in item ? item.at : 'from' in item ? item.from : 0)[0];
  if (at !== undefined) void currentPlayer()?.seek(at);
}

/** One clip over the whole take, instead of the cut (undo brings the cut back). */
export function showRawTake(): void {
  const media = store.get().media;
  if (!media) return;
  const scenes: Scene[] = [{ type: 'clip', from: Math.max(0, media.screen.start), to: media.screen.end, speed: 1 }];
  if (edit([{ type: 'scenes', scenes: scenes as unknown as Record<string, unknown>[] }], 'Show raw take')) select(undefined);
}
