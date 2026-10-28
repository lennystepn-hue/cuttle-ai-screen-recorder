// This video's own look: its medium, in a line (write it here).
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// cuttle look new wrote its frame: the functions every page calls, with nothing decided. Decide
// how this medium moves (paper is laid down and lifted, ink is printed, light is switched on, glass
// slides, a terminal types) and write that, not a fade and a rise.
import { at as progress, ease, split } from 'cuttle';

export const look = {
  name: 'own',
  palette: { ground: '#000000', ink: '#ffffff', accent: '#ffffff' },
  // eases by role: an arrival lands on a long tail, a camera eases both ways, an exit accelerates
  ease: { enter: ease.outExpo, move: ease.inOut, exit: ease.in },
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

/** The ground under every page: its colour and its texture (a shader from 'cuttle/shader', a pattern, a picture). */
export function ground() {}

/** How a thing comes in, in this medium, at `at` seconds (its parts `each` apart). A pure function of `t`. */
export function enter(element, t, { at = 0, by, each = 0.08 } = {}) {
  partsOf(element, by).forEach((part, i) => {
    part.style.visibility = t < at + i * each ? 'hidden' : 'visible';
    part.style.opacity = String(progress(t, at + i * each, 0.4, look.ease.enter));
  });
}

/** How it leaves, from `at` seconds. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.visibility = 'hidden';
}
