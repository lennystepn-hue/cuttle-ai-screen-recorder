// Swiss grid: twelve columns, one grotesque, black, white and one red; things slide along the grid and snap.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, split } from 'cuttle';

export const look = {
  name: 'swiss',
  palette: { ground: '#f1efe9', ink: '#111111', accent: '#e30613', muted: '#6b6b6b' },
  type: { display: 'Inter', body: 'Inter' },
  ease: { enter: ease.outExpo, move: ease.inOut, exit: ease.inExpo },
};

/** One unit of the 1080 grid, from the page's short side. */
export const u = () => Math.min(innerWidth, innerHeight) / 1080;

const pieces = new WeakMap();
/** What moves one after another: the element itself, or its words or letters (split once). */
export function partsOf(element, by) {
  if (!by) return [element];
  if (!pieces.has(element)) pieces.set(element, split(element, by));
  return pieces.get(element);
}

/** One column of the grid, in px. */
const column = () => (innerWidth - 2 * 96 * u()) / 12;

/** The ground: the paper, and its columns' lines unless `grid` is false. */
export function ground({ grid = true } = {}) {
  if (grid && !document.querySelector('.look-grid')) document.body.prepend(Object.assign(document.createElement('div'), { className: 'look-grid' }));
}

/** Comes in a column's width from the left, revealed from its left edge, and snaps (`by`: word or char, `each` s apart). */
export function enter(element, t, { at = 0, by, each = 0.07 } = {}) {
  const shift = column();
  partsOf(element, by).forEach((part, i) => {
    const start = at + i * each;
    const p = progress(t, start, 0.6, look.ease.enter);
    part.style.visibility = t < start ? 'hidden' : 'visible';
    part.style.transform = `translateX(${(p - 1) * shift}px)`;
    part.style.clipPath = `inset(-20% ${(1 - p) * 100}% -20% 0)`;
  });
}

/** Leaves a column to the right, cut from its left edge. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t < at) return;
  const p = progress(t, at, 0.35, look.ease.exit);
  element.style.transform = `translateX(${p * column()}px)`;
  element.style.clipPath = `inset(-20% 0 -20% ${p * 100}%)`;
}

/** A rule drawn across from the left. */
export function rule(element, t, { at = 0, duration = 0.7 } = {}) {
  element.style.transform = `scaleX(${progress(t, at, duration, look.ease.enter)})`;
}
