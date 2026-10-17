// What the editor's timeline draws, in output seconds: pure, so it is tested without a window.
import type { CuttleProject, InputEvent, Marker, MarkerKind } from '@cuttle/project';
import { occurrences, type SceneSpan } from '@cuttle/timeline';
import { formatDuration, formatSpeed } from './format';

export type OverlayKind = 'zoom' | 'mask' | 'caption';

export interface SceneBlock {
  index: number;
  kind: 'clip' | 'still' | 'card';
  /** Output seconds. */
  start: number;
  end: number;
  /** The label, or a name made from the scene. */
  title: string;
  /** Speed and lengths of a clip (`12× · 145 s → 12 s`), the motion of a still. */
  detail: string;
  speed?: number;
}

export interface OverlayBlock {
  kind: OverlayKind;
  /** Index in the project's `zooms`, `masks` or `texts`. */
  item: number;
  /** One occurrence, in output seconds. */
  start: number;
  end: number;
  enabled: boolean;
  title: string;
}

export interface OverlayLane {
  blocks: OverlayBlock[];
  /** Items no clip shows. */
  cutOut: number;
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
  lanes: Record<OverlayKind, OverlayLane>;
  markers: MarkerPin[];
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function sceneBlock(span: SceneSpan): SceneBlock {
  const { scene, index, start, end } = span;
  if (scene.type === 'clip') {
    const source = scene.to - scene.from;
    const detail = scene.speed === 1 ? formatDuration(source) : `${formatSpeed(scene.speed)} · ${formatDuration(source)} → ${formatDuration(end - start)}`;
    return { index, kind: 'clip', start, end, title: scene.label ?? (scene.speed > 1 ? 'Sped up' : 'Clip'), detail, speed: scene.speed };
  }
  if (scene.type === 'still') {
    const motion = scene.motion === 'none' ? '' : ` · ${scene.motion === 'kenburns' ? 'Ken Burns' : 'scroll'}`;
    return { index, kind: 'still', start, end, title: scene.label ?? baseName(scene.image), detail: `${formatDuration(scene.duration)}${motion}` };
  }
  return { index, kind: 'card', start, end, title: scene.label ?? scene.title, detail: formatDuration(scene.duration) };
}

function lane<T extends { enabled: boolean; label?: string }>(
  kind: OverlayKind,
  items: readonly T[],
  spans: readonly SceneSpan[],
  range: (item: T) => [number, number],
  title: (item: T) => string,
): OverlayLane {
  const blocks: OverlayBlock[] = [];
  let cutOut = 0;
  items.forEach((item, index) => {
    const [from, to] = range(item);
    const shown = [...new Set(occurrences(spans, from, to).filter((occurrence) => occurrence !== undefined))];
    if (shown.length === 0) cutOut++;
    for (const occurrence of shown) {
      blocks.push({ kind, item: index, start: occurrence.start, end: occurrence.end, enabled: item.enabled, title: item.label ?? title(item) });
    }
  });
  return { blocks, cutOut };
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
  return {
    duration: spans.at(-1)?.end ?? 0,
    scenes: spans.map(sceneBlock),
    lanes: {
      zoom: lane('zoom', project.zooms, spans, (zoom) => [zoom.at, zoom.at + zoom.duration], () => 'Zoom'),
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
    if (event.type === 'shape') continue;
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
