// Blueprint: white lines on a blue sheet with its grid, a condensed headline, mono labels; drawings draw themselves, labels type in.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, split, typed } from 'cuttle';

export const look = {
  name: 'blueprint',
  palette: { ground: '#0d3b82', ink: '#e8f0ff', accent: '#ffd34d' },
  type: { display: 'Archivo', body: 'JetBrains Mono' },
  ease: { enter: ease.inOut, move: ease.inOut, exit: ease.in },
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

/** The ground: the sheet and its grid (in shared.css). */
export function ground() {}

/** Revealed from the left as a pen would write it (a headline), or typed in (a `.look-label`). */
export function enter(element, t, { at = 0, by, each = 0.08 } = {}) {
  if (element.classList.contains('look-label')) {
    if (!element.dataset.text) element.dataset.text = element.textContent;
    element.textContent = typed(element.dataset.text, t, { start: at, cps: 28 });
    return;
  }
  partsOf(element, by).forEach((part, i) => {
    const p = progress(t, at + i * each, 0.6, look.ease.enter);
    part.style.clipPath = `inset(-10% ${(1 - p) * 100}% -10% 0)`;
  });
}

/** Fades. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.opacity = String(1 - progress(t, at, 0.3, look.ease.exit));
}

const lengths = new WeakMap();
/** Every line of an SVG drawing draws itself, one after another (`each` s apart, `duration` each). */
export function draw(svg, t, { at = 0, duration = 0.6, each = 0.12 } = {}) {
  [...svg.querySelectorAll('path, line, polyline, polygon, circle, rect, ellipse')].forEach((shape, i) => {
    if (!lengths.has(shape)) lengths.set(shape, shape.getTotalLength());
    const length = lengths.get(shape);
    shape.style.strokeDasharray = `${length}`;
    shape.style.strokeDashoffset = `${length * (1 - progress(t, at + i * each, duration, ease.inOut))}`;
  });
}
