// Paper cut: coloured paper on kraft with real shadows; things are laid into place from above on a spring, and lifted away.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, random, split, spring } from 'cuttle';
import { shader } from 'cuttle/shader';

export const look = {
  name: 'paper-cut',
  palette: { ground: '#efe2cf', ink: '#2b2119', accent: '#e4572e', papers: ['#e4572e', '#2e6f6a', '#f3c14b'] },
  type: { display: 'Bricolage Grotesque', body: 'Bricolage Grotesque' },
  ease: { enter: ease.outBack, move: ease.inOut, exit: ease.inBack },
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

/** The ground: kraft paper, its fibres in a soft noise. */
export function ground({ fibres = 0.06 } = {}) {
  const { canvas } = shader(
    `vec4 effect(vec2 uv) {
      float f = fbm(uv * vec2(aspect, 1.0) * vec2(90.0, 6.0)) - 0.5;
      return vec4(kraft * (1.0 + f * strength) + grain(uv, 0.0) * 0.02, 1.0);
    }`,
    { uniforms: { kraft: look.palette.ground, strength: fibres } },
  );
  canvas.style.zIndex = '-1';
}

const rests = new WeakMap();
const turn = random(7);
/** Where a piece rests: turned a little, its own way. */
const restOf = (part) => {
  if (!rests.has(part)) rests.set(part, (turn() - 0.5) * 3);
  return rests.get(part);
};
/** The shadow of paper lifted `lift` (0 on the table, 1 high). */
const shadow = (lift) => `drop-shadow(0 ${(3 + 22 * lift) * u()}px ${(4 + 26 * lift) * u()}px rgba(43, 33, 25, ${0.28 - 0.1 * lift}))`;

/** Laid into place from above: it drops, settles on a spring, its shadow closing in as it lands. */
export function enter(element, t, { at = 0, by, each = 0.09 } = {}) {
  partsOf(element, by).forEach((part, i) => {
    const start = at + i * each;
    const s = spring(t - start, { stiffness: 190, damping: 15 });
    const lift = Math.max(0, 1 - s);
    part.style.visibility = t < start ? 'hidden' : 'visible';
    part.style.transform = `translateY(${-lift * 70 * u()}px) rotate(${restOf(part) - lift * 6}deg) scale(${1 + lift * 0.04})`;
    part.style.filter = shadow(lift);
  });
}

/** Lifted away upward, its shadow growing as it leaves the table. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t < at) return;
  const p = progress(t, at, 0.5, look.ease.exit);
  element.style.transform = `translateY(${-p * 1.2 * innerHeight}px) rotate(${restOf(element) + p * 8}deg)`;
  element.style.filter = shadow(Math.min(1, p * 3));
}
