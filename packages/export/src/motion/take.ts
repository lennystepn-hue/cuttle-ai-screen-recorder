import type { CuttleProject, InputEvent, Marker, TranscriptWord } from '@cuttle/project';
import { applyCaptionFixes, createCursorTrack, cursorAt, sceneSpans } from '@cuttle/timeline';
import type { TakeData } from './runtime';

/** The pointer's path is sampled this often (source seconds); the page interpolates between. */
export const CURSOR_PATH_FPS = 30;
/** Moves closer together than this are left out of the page's events. */
const MOVE_GAP = 1 / 30;

/** What the take holds, as read from its files. */
export interface TakeInputs {
  events: readonly InputEvent[];
  words: readonly TranscriptWord[];
  markers: readonly Marker[];
}

/**
 * A file of the project as a motion page reaches it (its session serves the project at
 * `cuttle-motion://project/`), or null for one outside the project.
 */
export function projectFileUrl(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.');
  if (/^([a-z]:|[\\/])/i.test(path) || parts.length === 0 || parts.includes('..')) return null;
  return `cuttle-motion://project/${parts.map(encodeURIComponent).join('/')}`;
}

const tenth = (value: number) => Math.round(value * 10) / 10;
const milli = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The take as a motion page sees it (`cuttle.take`): its input, words and markers, the project's
 * zooms and masks, where its clips are in the video, the pointer's path as the video draws it, and
 * the screen recording's URL for its frames. `window` is an overlay's stretch of the take (source seconds).
 */
export function takeData(project: CuttleProject, inputs: TakeInputs, screen: { width: number; height: number }, window: { from: number; to: number } | null): TakeData {
  const events: TakeData['events'] = [];
  let lastMove = -Infinity;
  for (const event of [...inputs.events].sort((a, b) => a.t - b.t)) {
    if (event.type === 'click') events.push({ t: event.t, type: 'click', x: event.x, y: event.y, button: event.button });
    else if (event.type === 'keys') events.push({ t: event.t, type: 'keys', count: event.count });
    else if (event.type === 'scroll') events.push({ t: event.t, type: 'scroll', x: event.x, y: event.y, dx: event.dx, dy: event.dy });
    else if (event.type === 'move' && event.t - lastMove >= MOVE_GAP - 1e-9) {
      events.push({ t: event.t, type: 'move', x: event.x, y: event.y });
      lastMove = event.t;
    }
  }
  const clips = sceneSpans(project.scenes, project.cuts).flatMap((span) =>
    span.scene.type === 'clip' ? [{ start: milli(span.start), end: milli(span.end), from: span.scene.from, to: span.scene.to, speed: span.scene.speed }] : [],
  );
  return {
    screen: { width: screen.width, height: screen.height },
    events,
    words: applyCaptionFixes(inputs.words, project.captions.fixes).map(({ t, end, text }) => ({ t, end, text })),
    markers: inputs.markers.map(({ t, kind, label }) => ({ t, kind, ...(label !== undefined && { label }) })),
    zooms: project.zooms.filter((zoom) => zoom.enabled).map(({ at, duration, rect, label }) => ({ at, duration, rect, ...(label !== undefined && { label }) })),
    masks: project.masks.filter((mask) => mask.enabled).map(({ from, to, rect, style, moves }) => ({ from, to, rect, style, ...(moves?.length && { moves: moves.map(({ at, rect }) => ({ at, rect })) }) })),
    clips,
    cursor: cursorPath(inputs.events, project.look.cursor.smoothing),
    window,
    recording: project.sources.screen === undefined ? null : projectFileUrl(project.sources.screen),
  };
}

/** The pointer every 1/`CURSOR_PATH_FPS` s from its first move to its last, smoothed as the video draws it. */
function cursorPath(events: readonly InputEvent[], smoothing: number): TakeData['cursor'] {
  const track = createCursorTrack(events);
  if (track.moves.length === 0) return null;
  const start = track.moves[0]!.t;
  const end = track.moves.at(-1)!.t;
  const points: number[] = [];
  for (let i = 0; start + i / CURSOR_PATH_FPS <= end + 1e-9; i++) {
    const at = cursorAt(track, start + i / CURSOR_PATH_FPS, 1, smoothing);
    points.push(tenth(at!.x), tenth(at!.y));
  }
  if (points.length === 2) points.push(points[0]!, points[1]!);
  return { fps: CURSOR_PATH_FPS, start, points };
}
