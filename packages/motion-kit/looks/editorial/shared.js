// Editorial: a light serif set large with room around it, one italic word in red, paper with grain; words come from grey to ink, the camera pushes in.
// Every page of the video imports it, so the scenes read as one film:
//   import { look, ground, enter, exit } from '../shared.js';
//   ground();
//   cuttle.onFrame((t) => { enter(title, t, { at: 0.2, by: 'word' }); exit(title, t, { at: cuttle.duration - 0.4 }); });
// It is this project's now (cuttle look apply wrote it): change it as the video needs.
import { at as progress, ease, mix, split } from 'cuttle';
import { shader } from 'cuttle/shader';

export const look = {
  name: 'editorial',
  palette: { ground: '#faf7f1', ink: '#191714', accent: '#b4321f', muted: '#8b857b', faint: '#d9d3c8' },
  type: { display: 'Fraunces', body: 'Inter' },
  ease: { enter: ease.out, move: ease.inOut, exit: ease.in },
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

/** The ground: paper, with a grain that moves as film does (`grain`: how much). */
export function ground({ grain = 0.035 } = {}) {
  const { canvas } = shader(`vec4 effect(vec2 uv) { return vec4(paper + grain(uv, time) * strength, 1.0); }`, { uniforms: { paper: look.palette.ground, strength: grain } });
  canvas.style.zIndex = '-1';
}

const words = new WeakMap();
/** Its words as spans, each where it was (an italic word stays in its <em>, and takes its colour). */
function wordsOf(element) {
  if (!words.has(element)) {
    const spans = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
    for (const text of texts) {
      const parts = (text.textContent ?? '').split(/(\s+)/);
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) fragment.append(part);
        else spans.push(fragment.appendChild(Object.assign(document.createElement('span'), { textContent: part })));
      }
      text.replaceWith(fragment);
    }
    words.set(element, spans);
  }
  return words.get(element);
}

const hex = (rgb) => `#${(rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`;
const inks = new WeakMap();

/** Each word from a faint grey to its own colour (the italic one to the accent), without moving. */
export function enter(element, t, { at = 0, by = 'word', each = 0.07 } = {}) {
  (by === 'word' ? wordsOf(element) : partsOf(element, by)).forEach((part, i) => {
    if (!inks.has(part)) inks.set(part, hex(getComputedStyle(part).color));
    const p = progress(t, at + i * each, 0.45, look.ease.enter);
    part.style.color = mix(look.palette.faint, inks.get(part), p);
    part.style.opacity = String(Math.min(1, p * 4));
  });
}

/** Fades. */
export function exit(element, t, { at = Infinity } = {}) {
  if (t >= at) element.style.opacity = String(1 - progress(t, at, 0.3, look.ease.exit));
}

/** The slow push of a camera into `element` (from 1 to `to` over the item). */
export function push(element, t, { to = 1.04 } = {}) {
  element.style.transform = `translateY(-50%) scale(${1 + (to - 1) * progress(t, 0, cuttle.duration, ease.inOut)})`;
}

/** A rule drawn across. */
export function rule(element, t, { at = 0 } = {}) {
  element.style.transform = `scaleX(${progress(t, at, 0.9, ease.inOut)})`;
}
