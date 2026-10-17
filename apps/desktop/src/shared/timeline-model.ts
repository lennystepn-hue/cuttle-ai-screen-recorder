// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { AutoKind, CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  /** The scene's index in the project's `scenes`. */
  index: number;
  /** The scene's id (`#<index>` for one without). */
  id: string;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
  end: number;
  /** The label, or a name made from the scene. */
  title: string;
  /** Speed and lengths of a clip (`12× · 145 s → 12 s`), the motion of a still. */
  detail: string;
  speed?: number;
  /**
   * A clip's pieces, where cuts take parts out: each one's output start and end and the source
   * second it starts at. One piece without cuts.
   */
  pieces?: ClipPiece[];
}

export interface ClipPiece {
  start: number;
  end: number;
  from: number;
}

/** Where cuts show on the video lane: a notch at the output second a clip jumps (or would, for cuts that are off). */
export interface CutNotch {
  t: number;
  /** The cuts there, by id. */
  ids: string[];
  /** Whether they take the stretch out (off: the video plays it). */
  enabled: boolean;
  /** Their kind, when they are automatic and share one. */
  auto?: AutoKind;
  /** The first one's label, or what it is. */
  title: string;
}

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** The item's id (`#<index>` for one without). */
  id: string;
  /** One occurrence, in output seconds. */
  start: number;
  end: number;
  /** The scene (index) where the occurrence starts: its speed turns a drag into source seconds. */
  span: number;
  enabled: boolean;
  title: string;
  /** The row inside its lane: blocks that overlap in time go to separate rows. */
  row: number;
  /** Where a zoom that follows moves on, in output seconds. */
  marks?: number[];
}

/** Rows a lane grows to; blocks beyond overlap in the last one. */
export const MAX_LANE_ROWS = 3;

export interface OverlayLane {
  blocks: OverlayBlock[];
  /** Rows the lane needs (at least 1, at most `MAX_LANE_ROWS`). */
  rows: number;
  /** Items no clip shows. */
  cutOut: number;
  /** Those items, to list them (their id, and their name as the lane shows it). */
  cutOutItems: { id: string; title: string }[];
}

export interface MarkerPin {
  /** Output seconds; a marker shown by several clips has a pin for each. */
  t: number;
  source: number;
  kind: MarkerKind;
  label?: string;
}

export interface TimelineModel {
  duration: number;
  scenes: SceneBlock[];
  cuts: CutNotch[];
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** One block per scene: a clip's pieces (the spans with its `sceneIndex`) make one block. */
function sceneBlock(pieces: readonly SceneSpan[], project: CuttleProject): SceneBlock {
  const first = pieces[0]!;
  const index = first.sceneIndex;
  const start = first.start;
  const end = pieces.at(-1)!.end;
  const scene = project.scenes[index] ?? first.scene;
  const id = scene.id ?? `#${index}`;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const shown = end - start;
    // the source it plays, and how long the video shows it when sped up or cut
    const detail = Math.abs(shown - source) < 1e-6 ? formatDuration(source) : `${formatDuration(source)} → ${formatDuration(shown)}`;
    const own = pieces.map((piece) => ({ start: piece.start, end: piece.end, from: piece.scene.type === 'clip' ? piece.scene.from : scene.from }));
    // The speed shows once, in front of the title (`12× Claude at work`): an unlabelled sped-up clip has no title.
    return { index, id, kind: 'clip', start, end, title: scene.label ?? (scene.speed === 1 ? 'Clip' : ''), detail, speed: scene.speed, pieces: own };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, id, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, id, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string; id?: string }>(
  kind: OverlayKind,
  items: readonly T[],
  spans: readonly SceneSpan[],
  range: (item: T) => [number, number],
  title: (item: T) => string,
  marks?: (item: T) => number[],
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  const cutOutItems: OverlayLane['cutOutItems'] = [];
  items.forEach((item, index) => {
    const [from, to] = range(item);
    const each = occurrences(spans, from, to);
    const shown = [...new Set(each.filter((occurrence) => occurrence !== undefined))];
    if (shown.length === 0) cutOutItems.push({ id: item.id ?? `#${index}`, title: item.label ?? title(item) });
    for (const occurrence of shown) {
      blocks.push({
        kind,
        item: index,
        id: item.id ?? `#${index}`,
        start: occurrence.start,
        end: occurrence.end,
        span: each.indexOf(occurrence),
        enabled: item.enabled,
        title: item.label ?? title(item),
        row: 0,
        ...(marks && { marks: marks(item).flatMap((t) => outputTimesOf(spans, t)).filter((t) => t >= occurrence.start && t < occurrence.end) }),
      });
    }
  });
  // Greedy interval packing: each block goes to the first row that is free at its start.
  blocks.sort((a, b) => a.start - b.start || b.end - a.end);
  const ends: number[] = [];
  for (const block of blocks) {
    let row = ends.findIndex((end) => end <= block.start + 1e-9);
    if (row < 0) row = ends.length < MAX_LANE_ROWS ? ends.length : MAX_LANE_ROWS - 1;
    ends[row] = Math.max(ends[row] ?? 0, block.end);
    block.row = row;
  }
  return { blocks, cutOut: cutOutItems.length, cutOutItems, rows: Math.max(1, ends.length) };
}

/** The source second a clip block shows at output second `t` (past its last piece: on at its speed). */
export function blockSourceAt(block: SceneBlock, t: number): number {
  const pieces = block.pieces ?? [];
  const speed = block.speed ?? 1;
  const piece = pieces.find((candidate) => t < candidate.end) ?? pieces.at(-1);
  return piece ? piece.from + (t - piece.start) * speed : 0;
}

/** The notches of the cuts: on, where a clip's piece starts after them or a clip lost its start or end; off, where they would cut. */
function cutNotches(project: CuttleProject, spans: readonly SceneSpan[]): CutNotch[] {
  const notches: CutNotch[] = [];
  const add = (t: number, cuts: CuttleProject['cuts']) => {
    if (cuts.length === 0) return;
    const there = notches.find((notch) => Math.abs(notch.t - t) < 1e-6 && notch.enabled === cuts[0]!.enabled);
    const ids = cuts.map((cut) => cut.id ?? `#${project.cuts.indexOf(cut)}`);
    if (there) {
      there.ids.push(...ids.filter((id) => !there.ids.includes(id)));
      return;
    }
    const kinds = new Set(cuts.map((cut) => cut.auto));
    const auto = kinds.size === 1 ? cuts[0]!.auto : undefined;
    notches.push({ t, ids, enabled: cuts[0]!.enabled, ...(auto !== undefined && { auto }), title: cuts[0]!.label ?? 'Cut' });
  };
  const on = project.cuts.filter((cut) => cut.enabled);
  const touching = (from: number, to: number) => on.filter((cut) => cut.from < to + 1e-6 && cut.to > from - 1e-6);
  spans.forEach((span, i) => {
    const scene = span.scene;
    if (scene.type !== 'clip') return;
    const original = project.scenes[span.sceneIndex];
    const previous = spans[i - 1];
    if (span.cutBefore && previous?.scene.type === 'clip') add(span.start, touching(previous.scene.to, scene.from));
    // the clip's own start or end taken out
    if (!span.cutBefore && original?.type === 'clip' && scene.from > original.from + 1e-6) add(span.start, touching(original.from, scene.from));
    const next = spans[i + 1];
    const lastPiece = !(next?.cutBefore && next.sceneIndex === span.sceneIndex);
    if (lastPiece && original?.type === 'clip' && scene.to < original.to - 1e-6) add(span.end, touching(scene.to, original.to));
  });
  for (const cut of project.cuts) {
    if (cut.enabled) continue;
    const t = outputTimesOf(spans, cut.from)[0];
    if (t !== undefined) add(t, [cut]);
  }
  return notches.sort((a, b) => a.t - b.t);
}

/** The output seconds at which the clips show source second `t` (none when it is cut out). */
export function outputTimesOf(spans: readonly SceneSpan[], t: number): number[] {
  const times: number[] = [];
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || t < scene.from || t >= scene.to) continue;
    times.push(span.start + (t - scene.from) / scene.speed);
  }
  return times;
}

export function timelineModel(project: CuttleProject, spans: readonly SceneSpan[], markers: readonly Marker[] = []): TimelineModel {
  // a clip with cuts in it is several spans in a row with one sceneIndex: one block
  const groups: SceneSpan[][] = [];
  for (const span of spans) {
    const last = groups.at(-1);
    if (last && last[0]!.sceneIndex === span.sceneIndex) last.push(span);
    else groups.push([span]);
  }
  return {
    duration: spans.at(-1)?.end ?? 0,
    scenes: groups.map((group) => sceneBlock(group, project)),
    cuts: cutNotches(project, spans),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom', (zoom) => (zoom.moves ?? []).map((move) => move.at)),
      mask: lane('mask', project.masks, spans, (mask) => [mask.from, mask.to], () => 'Mask'),
      caption: lane('caption', project.texts, spans, (text) => [text.at, text.at + text.duration], (text) => text.text),
    },
    markers: markers
      .flatMap((marker) => outputTimesOf(spans, marker.t).map((t) => ({ t, source: marker.t, kind: marker.kind, ...(marker.label !== undefined && { label: marker.label }) })))
      .sort((a, b) => a.t - b.t),
  };
}

/** Pins closer than `minGap` output seconds that are tool calls merge into one pin with a count. */
export interface PinGroup {
  t: number;
  kind: MarkerKind;
  pins: MarkerPin[];
}

/** A pin group's name: Prompt, Answer, the marker's label, the tool (`Bash ×2`), or `5 tool calls` for different tools. */
export function pinGroupName(group: PinGroup): string {
  const first = group.pins[0]!;
  if (group.kind === 'prompt') return 'Prompt';
  if (group.kind === 'answer') return 'Answer';
  if (group.kind === 'manual') return first.label ?? 'Marker';
  if (group.kind === 'retake') return 'Retake';
  if (group.pins.length === 1) return first.label ?? 'Tool';
  const tools = new Set(group.pins.map((pin) => pin.label ?? 'Tool'));
  return tools.size === 1 ? `${first.label ?? 'Tool'} ×${group.pins.length}` : `${group.pins.length} tool calls`;
}

/** A pin group's details for a tooltip: each tool's count (`Read 9 · Bash 4`), or each marker with its source second. */
export function pinGroupDetail(group: PinGroup): string {
  if (group.kind !== 'tool' || group.pins.length === 1) return group.pins.map((pin) => `${pin.label ?? pin.kind} at source ${pin.source.toFixed(1)} s`).join(' · ');
  const counts = new Map<string, number>();
  for (const pin of group.pins) counts.set(pin.label ?? 'Tool', (counts.get(pin.label ?? 'Tool') ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `${tool} ${count}`)
    .join(' · ');
}

export function groupPins(pins: readonly MarkerPin[], minGap: number): PinGroup[] {
  const groups: PinGroup[] = [];
  for (const pin of pins) {
    const last = groups.at(-1);
    if (last && pin.kind === 'tool' && last.kind === 'tool' && pin.t - last.pins.at(-1)!.t < minGap) last.pins.push(pin);
    else groups.push({ t: pin.t, kind: pin.kind, pins: [pin] });
  }
  return groups;
}

/**
 * Input activity per output-time column: how many input events (clicks, keys, scrolls and moves)
 * the clips show in each of `columns` equal slices of `[from, to)` output seconds, scaled to 0–1 by
 * the busiest column.
 */
export function activityColumns(events: readonly InputEvent[], spans: readonly SceneSpan[], from: number, to: number, columns: number): number[] {
  const counts = new Array<number>(columns).fill(0);
  const width = (to - from) / columns;
  if (!(width > 0)) return counts;
  for (const event of events) {
    if (event.type === 'shape' || event.type === 'caret') continue;
    const weight = event.type === 'move' ? 0.25 : event.type === 'keys' ? event.count : 1;
    for (const t of outputTimesOf(spans, event.t)) {
      const column = Math.floor((t - from) / width);
      if (column >= 0 && column < columns) counts[column]! += weight;
    }
  }
  const most = Math.max(0, ...counts);
  return most === 0 ? counts : counts.map((count) => count / most);
}

/** The mic's loudness: one peak (0–255) per `1 / rate` seconds of the mic, which starts `offset` seconds after the screen. */
export interface Peaks {
  rate: number;
  offset: number;
  data: Uint8Array;
}

/**
 * The mic's peak (0–1) per output-time column of `[from, to)`: each column takes the loudest peak of
 * the source seconds the clips play there; still and card scenes, and clips that are silent in the
 * export (`muted(speed)`), are 0.
 */
export function waveformColumns(peaks: Peaks, spans: readonly SceneSpan[], from: number, to: number, columns: number, muted: (speed: number) => boolean): number[] {
  const out = new Array<number>(columns).fill(0);
  const width = (to - from) / columns;
  if (!(width > 0)) return out;
  for (const span of spans) {
    const scene = span.scene;
    if (scene.type !== 'clip' || muted(scene.speed) || span.end <= from || span.start >= to) continue;
    const first = Math.max(0, Math.floor((span.start - from) / width));
    const last = Math.min(columns - 1, Math.ceil((span.end - from) / width) - 1);
    for (let column = first; column <= last; column++) {
      const outStart = Math.max(span.start, from + column * width);
      const outEnd = Math.min(span.end, from + (column + 1) * width);
      if (outEnd <= outStart) continue;
      // Mic seconds of this column; none before the mic started or after it ended.
      const micStart = scene.from + (outStart - span.start) * scene.speed - peaks.offset;
      const micEnd = scene.from + (outEnd - span.start) * scene.speed - peaks.offset;
      if (micEnd <= 0 || micStart * peaks.rate >= peaks.data.length) continue;
      const a = Math.max(0, Math.floor(micStart * peaks.rate));
      const b = Math.min(peaks.data.length, Math.max(a + 1, Math.ceil(micEnd * peaks.rate)));
      let peak = 0;
      for (let i = a; i < b; i++) peak = Math.max(peak, peaks.data[i]!);
      out[column] = Math.max(out[column]!, peak / 255);
    }
  }
  return out;
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * What the export sheet asks people to look at again before exporting: masks that are off (what
 * they cover shows), overlays no clip shows, captions on screen for less than a second, and clips at
 * another speed with sound, which the preview plays higher or lower while the export keeps the pitch.
 */
export function exportChecks(project: CuttleProject, spans: readonly SceneSpan[]): string[] {
  const model = timelineModel(project, spans);
  const checks: string[] = [];
  const off = project.masks.filter((mask) => !mask.enabled).length;
  if (off > 0) checks.push(`${count(off, 'mask')} ${off === 1 ? 'is off: what it covers shows' : 'are off: what they cover shows'} in the video.`);
  const cut = (['zoom', 'mask', 'caption'] as const).filter((kind) => model.lanes[kind].cutOut > 0);
  const cutTotal = cut.reduce((sum, kind) => sum + model.lanes[kind].cutOut, 0);
  if (cutTotal > 0) {
    checks.push(`${list(cut.map((kind) => count(model.lanes[kind].cutOut, kind)))} ${cutTotal === 1 ? 'is cut out: no clip shows it' : 'are cut out: no clip shows them'}.`);
  }
  const shortest = new Map<number, number>();
  for (const block of model.lanes.caption.blocks) shortest.set(block.item, Math.min(shortest.get(block.item) ?? Infinity, block.end - block.start));
  for (const [item, seconds] of shortest) {
    const text = project.texts[item]!;
    if (text.enabled && seconds < 1) checks.push(`Caption "${text.label ?? text.text}" is on screen for only ${formatDuration(seconds)}.`);
  }
  const { audio } = project.look;
  const heard = (speed: number) => audio.enabled && speed !== 1 && !(audio.muteSpedUp && speed > 1);
  if (project.scenes.some((scene) => scene.type === 'clip' && heard(scene.speed))) {
    checks.push('Clips at another speed keep the pitch of their sound in the export; the preview plays them higher or lower.');
  }
  return checks;
}
