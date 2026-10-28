// Poster: giant condensed capitals that fill the frame, two flat colours; words are stamped on the beat, never faded.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, fit, split } from 'cuttle';

export const look = {
  name: 'poster',
  palette: { ground: '#ffd23f', ink: '#141414', accent: '#ff3d2e' },
  type: { display: 'Anton', body: 'Bebas Neue' },
  ease: { enter: ease.outQuart, move: ease.inOutExpo, exit: ease.linear },
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

/** The ground: flat colour, and a disc of the accent unless `disc` is false. */
export function ground({ disc = true } = {}) {
  if (disc && !document.querySelector('.look-shape')) document.body.prepend(Object.assign(document.createElement('div'), { className: 'look-shape' }));
}

/** Each line of `element` (its children) as wide as the page, the size of its letters to match. */
export async function fill(element, { max = 420 } = {}) {
  await document.fonts.load('400 100px Anton');
  for (const line of element.children) fit(line, { width: element.parentElement.clientWidth, max: max * u(), min: 24 });
}

/** Stamped: there at once, a touch large and turned, landing in a tenth of a second (`each`: on the beat). */
export function enter(element, t, { at = 0, by = 'word', each = 0.12 } = {}) {
  partsOf(element, by).forEach((part, i) => {
    const start = at + i * each;
    const p = progress(t, start, 0.12, look.ease.enter);
    part.style.visibility = t < start ? 'hidden' : 'visible';
    part.style.transform = `scale(${1.14 - 0.14 * p}) rotate(${(1 - p) * -3}deg)`;
  });
}

/** Gone on the cut. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.visibility = 'hidden';
}
