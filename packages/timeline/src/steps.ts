// The take's way through the script: where it reached each step (its `step` markers, a slip of the
// step key left out), and a zoom on where each step happens. Pure: the chapters, and `suggest`'s
// step titles and step zooms, are made from these.
import type { InputEvent, Marker, Rect, ScriptStep } from '@cuttle/project';
import { zoomRectFor, type ClipSpan, type ZoomScreen } from './click-zooms';

/** A move to a step undone within this many seconds (the step key pressed by mistake, then back) is none. */
export const STEP_SLIP_SECONDS = 2;

/** A step's place in the take: the step, its number in the script (from 1), and the source second the take reached it. */
export interface StepMove {
  step: ScriptStep;
  number: number;
  t: number;
}

/**
 * Where the take reached each step, in source seconds: a move that the next one undoes within the
 * slip time (back to the step before it) is left out with its undoing; a step reached again later
 * (after another) is a move again; a move to the step it is at already, or to a step the script no
 * longer has, is none.
 */
export function stepMoves(script: readonly ScriptStep[], markers: readonly Marker[]): StepMove[] {
  const moves = markers.filter((marker) => marker.kind === 'step' && marker.label !== undefined).sort((a, b) => a.t - b.t);
  for (let i = 1; i + 1 < moves.length; ) {
    if (moves[i + 1]!.label === moves[i - 1]!.label && moves[i + 1]!.t - moves[i]!.t < STEP_SLIP_SECONDS) moves.splice(i, 2);
    else i++;
  }
  const result: StepMove[] = [];
  for (const move of moves) {
    const number = script.findIndex((step) => step.id === move.label) + 1;
    if (number === 0 || result.at(-1)?.step.id === move.label) continue;
    result.push({ step: script[number - 1]!, number, t: move.t });
  }
  return result;
}

/** The source second where the video shows source second `t`: `t` when a clip shows it, else where the clip that shows the take's next moment begins. */
export function shownFrom(clips: readonly Pick<ClipSpan, 'from' | 'to'>[], t: number): number | undefined {
  let next: number | undefined;
  for (const clip of clips) {
    if (t >= clip.from && t < clip.to) return t;
    if (clip.from > t && (next === undefined || clip.from < next)) next = clip.from;
  }
  return next;
}

/** How a step's zoom is found: its actions in this many seconds after the step begins, the zoom a little before the first and after the last. */
export const STEP_ZOOM = { look: 8, lead: 0.6, tail: 1.5, least: 1.5, most: 6, maxSpeed: 2 } as const;

export interface StepZoom {
  at: number;
  duration: number;
  rect: Rect;
  move: StepMove;
}

/**
 * A zoom on where each step happens: around its clicks and where it types (the caret) in its first
 * seconds, from a little before the first to a little after the last, ending before the next step.
 * None for a step without them, one the video speeds up (more than 2×), or where another zoom is.
 */
export function stepZooms(moves: readonly StepMove[], events: readonly InputEvent[], clips: readonly ClipSpan[], screen: ZoomScreen, avoid: readonly { at: number; duration: number }[] = []): StepZoom[] {
  const zooms: StepZoom[] = [];
  const shownSlowly = (t: number) => clips.some((clip) => t >= clip.from && t < clip.to && clip.speed <= STEP_ZOOM.maxSpeed);
  moves.forEach((move, i) => {
    const start = shownFrom(clips, move.t);
    if (start === undefined) return;
    const next = moves[i + 1]?.t ?? Infinity;
    const until = Math.min(next, start + STEP_ZOOM.look);
    const acts = events.filter((event): event is Extract<InputEvent, { type: 'click' | 'caret' }> => (event.type === 'click' || event.type === 'caret') && event.t >= start && event.t < until && shownSlowly(event.t));
    if (acts.length === 0) return;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const act of acts) {
      const [x, y, w, h] = act.type === 'caret' ? act.rect : [act.x, act.y, 0, 0];
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x + w);
      box.bottom = Math.max(box.bottom, y + h);
    }
    const at = Math.max(start, acts[0]!.t - STEP_ZOOM.lead);
    const end = Math.min(next, Math.max(at + STEP_ZOOM.least, acts.at(-1)!.t + STEP_ZOOM.tail), at + STEP_ZOOM.most);
    if (end - at < 0.5 || [...avoid, ...zooms].some((other) => at < other.at + other.duration && other.at < end)) return;
    zooms.push({ at: Math.round(at * 1000) / 1000, duration: Math.round((end - at) * 1000) / 1000, rect: zoomRectFor(box, screen), move });
  });
  return zooms;
}
