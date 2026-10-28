// Risograph: two inks on rough paper, blue and fluorescent pink overprinting, the pink plate off register, tones in halftone; printed plate by plate.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, split } from 'cuttle';
import { shader } from 'cuttle/shader';

export const look = {
  name: 'risograph',
  palette: { ground: '#f4efe3', ink: '#2b59c3', accent: '#ff4fa3' },
  type: { display: 'Rubik Mono One', body: 'Space Mono' },
  ease: { enter: ease.outQuart, move: ease.inOut, exit: ease.linear },
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

/** The ground: paper with grain, and a field of pink halftone dots falling off from a corner (`dots`). */
export function ground({ dots = true } = {}) {
  const { canvas } = shader(
    `vec4 effect(vec2 uv) {
      float tone = enabled * smoothstep(0.95, 0.0, length((uv - vec2(1.0, 0.0)) * vec2(aspect, 1.0)) / 1.2) * 0.85;
      float inked = halftone(uv, 14.0 * resolution.y / 1080.0, tone, 0.26);
      vec3 paper = ground + grain(uv, 0.0) * 0.05;
      return vec4(paper * mix(vec3(1.0), pink, inked), 1.0);
    }`,
    { uniforms: { ground: look.palette.ground, pink: look.palette.accent, enabled: dots } },
  );
  canvas.style.zIndex = '-1';
}

const plates = new WeakMap();
/** The pink plate over `element`: its text again, printed over it in the second ink (made once). */
export function plate(element) {
  if (!plates.has(element)) {
    const copy = Object.assign(document.createElement('span'), { className: 'look-plate', textContent: element.textContent });
    copy.setAttribute('aria-hidden', 'true');
    element.append(copy);
    plates.set(element, copy);
  }
  return plates.get(element);
}

/** Printed: the blue plate at once, the pink one a few frames later, landing off register. */
export function enter(element, t, { at = 0, offset = 6, gap = 0.12 } = {}) {
  const pink = plate(element);
  element.style.visibility = t < at ? 'hidden' : 'visible';
  // ink spreads for a frame as it hits the paper
  element.style.filter = `blur(${(1 - progress(t, at, 0.08, ease.out)) * 1.5}px)`;
  const p = progress(t, at + gap, 0.2, look.ease.enter);
  pink.style.visibility = t < at + gap ? 'hidden' : 'visible';
  pink.style.transform = `translate(${(offset + (1 - p) * 6) * u()}px, ${(offset * 0.7 + (1 - p) * 4) * u()}px)`;
}

/** Cut away. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.visibility = 'hidden';
}
