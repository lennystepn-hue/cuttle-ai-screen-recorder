// Zine: photocopied paper, words cut out as labels and taped down, a highlighter, a handwritten note; hard cuts and a hand-made shiver.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, random, split } from 'cuttle';
import { shader } from 'cuttle/shader';

export const look = {
  name: 'zine',
  palette: { ground: '#eeeae1', ink: '#121212', accent: '#c7f000' },
  type: { display: 'Anton', body: 'Space Mono', hand: 'Caveat' },
  ease: { enter: ease.outQuart, move: ease.linear, exit: ease.linear },
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

/** The ground: a photocopy, its specks and its darker edges. */
export function ground({ specks = 0.09 } = {}) {
  const { canvas } = shader(
    `vec4 effect(vec2 uv) {
      float speck = step(0.996, hash(floor(uv * resolution / 2.0))) * strength * 6.0;
      vec3 copy = paper * vignette(uv, 0.22) + grain(uv, 0.0) * strength - speck;
      return vec4(copy, 1.0);
    }`,
    { uniforms: { paper: look.palette.ground, strength: specks } },
  );
  canvas.style.zIndex = '-1';
}

const shivers = new WeakMap();
const draw = random(11);
/** A piece's own turn and its shiver: a new tiny offset eight times a second, the same in every render. */
const shiver = (part, t) => {
  if (!shivers.has(part)) shivers.set(part, { turn: (draw() - 0.5) * 6, seed: Math.floor(draw() * 1000) });
  const { turn, seed } = shivers.get(part);
  const step = random(seed + Math.floor(t * 8));
  return `translate(${(step() - 0.5) * 3 * u()}px, ${(step() - 0.5) * 3 * u()}px) rotate(${turn + (step() - 0.5) * 0.8}deg)`;
};

/** Cut in hard, each word a label of its own (`by` word wraps them), shivering a little where it lies. */
export function enter(element, t, { at = 0, by, each = 0.1 } = {}) {
  partsOf(element, by).forEach((part, i) => {
    if (by === 'word') part.classList.add('look-cut');
    part.style.visibility = t < at + i * each ? 'hidden' : 'visible';
    part.style.transform = shiver(part, t);
  });
}

/** Gone on the cut. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.visibility = 'hidden';
}

/** A highlighter stroke swept under a `.look-marker`. */
export function marker(element, t, { at = 0 } = {}) {
  element.style.setProperty('--marker', String(progress(t, at, 0.3, ease.out)));
}
