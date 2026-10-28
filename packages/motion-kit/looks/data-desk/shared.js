// Data desk: a newsroom's chart: white, thin rules, one blue for the point, numbers that count, the source under it.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, split } from 'cuttle';

export const look = {
  name: 'data-desk',
  palette: { ground: '#ffffff', ink: '#121212', accent: '#1550ff', muted: '#8a8f98', rule: '#e3e5e8' },
  type: { display: 'Inter', body: 'Inter' },
  ease: { enter: ease.outQuart, move: ease.inOut, exit: ease.in },
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

/** The ground: white, as a page of the paper. */
export function ground() {}

/** Comes in: rises 12 px as it shows, quickly. */
export function enter(element, t, { at = 0, by, each = 0.05 } = {}) {
  partsOf(element, by).forEach((part, i) => {
    const p = progress(t, at + i * each, 0.4, look.ease.enter);
    part.style.opacity = String(p);
    part.style.transform = `translateY(${(1 - p) * 12 * u()}px)`;
  });
}

/** Fades. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.opacity = String(1 - progress(t, at, 0.25, look.ease.exit));
}

/** Grows from its baseline (a bar: `axis` y) or its left (x). */
export function grow(element, t, { at = 0, duration = 0.8, axis = 'y' } = {}) {
  const p = progress(t, at, duration, look.ease.enter);
  element.style.transform = axis === 'y' ? `scaleY(${p})` : `scaleX(${p})`;
}

/** Counts from `from` to `to` as it grows (`decimals`, a `prefix` and `suffix`, the locale's separators). */
export function count(element, t, { at = 0, duration = 0.8, from = 0, to, decimals = 0, prefix = '', suffix = '' } = {}) {
  const value = from + (to - from) * progress(t, at, duration, look.ease.enter);
  element.textContent = `${prefix}${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
}
