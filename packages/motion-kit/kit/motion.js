// Cuttle's helpers for motion pages: import { at, ease, keys, stagger, split, typed, highlight } from 'cuttle';
//
// Everything here is a pure function of time. A page that draws from `cuttle.onFrame((t) => …)` with
// them shows the right picture on every frame, also after a jump, in every render.

/** `value` kept between `min` and `max`. */
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** From `a` to `b` by `t` (0 to 1). */
export const lerp = (a, b, t) => a + (b - a) * t;

/** A CSS-style cubic Bézier easing (`cubic-bezier(x1, y1, x2, y2)`), solved for x. */
export function bezier(x1, y1, x2, y2) {
  const coordinate = (t, a, b) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (t, a, b) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = coordinate(t, x1, x2) - x;
      if (Math.abs(error) < 1e-6) return coordinate(t, y1, y2);
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30 && Math.abs(coordinate(t, x1, x2) - x) > 1e-6; i++) {
      if (coordinate(t, x1, x2) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return coordinate(t, y1, y2);
  };
}

/**
 * A spring from 0 to 1, `seconds` after it starts (it may overshoot): `stiffness`, `damping` and
 * `mass` as in physics (the defaults settle in about 0.6 s with a small overshoot).
 */
export function spring(seconds, { stiffness = 170, damping = 20, mass = 1 } = {}) {
  if (seconds <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * seconds) * (Math.cos(wd * seconds) + ((zeta * w0) / wd) * Math.sin(wd * seconds));
  }
  return 1 - Math.exp(-w0 * seconds) * (1 + w0 * seconds);
}

/** Easing curves: each maps 0..1 to 0..1 (`outBack` and `outElastic` overshoot). */
export const ease = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  outQuint: (t) => 1 - (1 - t) ** 5,
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  inBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  /** The web's `ease`, `ease-out`, and the smooth curve of most product animation. */
  css: bezier(0.25, 0.1, 0.25, 1),
  cssOut: bezier(0, 0, 0.58, 1),
  smooth: bezier(0.2, 0.8, 0.2, 1),
};

/**
 * How far an animation that starts at `start` and lasts `duration` seconds is at time `t`, eased:
 * 0 before it, 1 after it.
 */
export function at(t, start, duration, curve = ease.out) {
  if (!(duration > 0)) return t >= start ? 1 : 0;
  return curve(clamp((t - start) / duration));
}

/** In and out: 0 before `start`, rising over `inFor` seconds, 1, falling over `outFor` to 0 at `end`. */
export function inOut(t, start, end, inFor = 0.4, outFor = inFor, curve = ease.out) {
  return Math.min(at(t, start, inFor, curve), 1 - at(t, end - outFor, outFor, (x) => 1 - curve(1 - x)));
}

const HEX = /^#([0-9a-f]{6})$/i;
const toRgb = (hex) => {
  const match = HEX.exec(hex);
  if (!match) throw new Error(`not a colour like #d97757: ${hex}`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const toHex = (rgb) => `#${rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Colour `a` mixed with `b` by `t` (both `#rrggbb`). */
export const mix = (a, b, t) => {
  const to = toRgb(b);
  return toHex(toRgb(a).map((c, i) => lerp(c, to[i], t)));
};

/** A colour (`#rrggbb`) at an opacity, for CSS and the canvas: `rgba(r, g, b, a)`. */
export const alpha = (color, a) => `rgba(${toRgb(color).join(', ')}, ${a})`;

/**
 * A value through keyframes at time `t`: `[[time, value, curve?], …]` in time order; a keyframe's
 * curve leads into it (default `ease.inOut`). Values are numbers, lists of numbers or colours.
 */
export function keys(t, frames) {
  if (frames.length === 0) throw new Error('keys: no keyframes');
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [time, value, curve = ease.inOut] = frames[i];
    if (t >= time) continue;
    const [before, from] = frames[i - 1];
    const f = curve(clamp((t - before) / (time - before)));
    if (typeof from === 'number') return lerp(from, value, f);
    if (typeof from === 'string') return mix(from, value, f);
    return from.map((v, j) => lerp(v, value[j], f));
  }
  return frames[frames.length - 1][1];
}

/**
 * When item `index` of `count` starts, `each` seconds after its neighbour: counted from the first
 * (`'start'`), the last (`'end'`), the middle (`'center'`), or an index outward.
 */
export function stagger(index, count, each, from = 'start') {
  const origin = from === 'start' ? 0 : from === 'end' ? count - 1 : from === 'center' ? (count - 1) / 2 : from;
  return Math.abs(index - origin) * each;
}

/** A seeded random number generator (mulberry32): `random(7)` gives the same numbers every time. */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Splits an element's text into spans to animate, one per word or per character (`by`), each word
 * kept whole so lines still break between words. The spans are `display: inline-block`.
 */
export function split(element, by = 'word') {
  const text = element.textContent ?? '';
  element.textContent = '';
  const parts = [];
  for (const chunk of text.split(/(\s+)/)) {
    if (chunk === '') continue;
    if (/^\s+$/.test(chunk)) {
      element.append(document.createTextNode(chunk));
      continue;
    }
    const word = document.createElement('span');
    word.style.display = 'inline-block';
    word.style.whiteSpace = 'nowrap';
    if (by === 'word') {
      word.textContent = chunk;
      parts.push(word);
    } else {
      for (const char of chunk) {
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.textContent = char;
        word.append(span);
        parts.push(span);
      }
    }
    element.append(word);
  }
  return parts;
}

const pauseAfter = (char, pause) => (char === '\n' ? pause * 1.5 : /[.,;:!?)}\]]/.test(char) ? pause * 0.5 : 0);

/**
 * How much of `text` is typed at time `t`, typing from `start` at `cps` characters a second with a
 * person's rhythm: a pause after punctuation and at each line's end.
 */
export function typed(text, t, { start = 0, cps = 30, pause = 0.12 } = {}) {
  let clock = start;
  for (let i = 0; i < text.length; i++) {
    clock += 1 / cps;
    if (clock > t) return text.slice(0, i);
    clock += pauseAfter(text[i], pause);
  }
  return text;
}

/** When `typed` has typed all of `text` (the same rhythm). */
export function typedUntil(text, { start = 0, cps = 30, pause = 0.12 } = {}) {
  let clock = start;
  for (const char of text) clock += 1 / cps + pauseAfter(char, pause);
  return clock;
}

const KEYWORDS = {
  js: 'await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield async',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
  bash: 'if then else elif fi for in do done while case esac function return export local echo cd exit set unset source npm pnpm npx git',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  sql: 'select from where and or not insert into values update set delete create table index join left right inner outer on group by order having limit as null is in distinct count primary key SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE JOIN ON GROUP BY ORDER LIMIT AS',
  css: 'important',
  json: 'true false null',
};
KEYWORDS.ts = `${KEYWORDS.js} interface type enum implements private public protected readonly declare namespace abstract as keyof satisfies`;

const ALIASES = { javascript: 'js', jsx: 'js', mjs: 'js', typescript: 'ts', tsx: 'ts', sh: 'bash', shell: 'bash', zsh: 'bash', py: 'python', rs: 'rust' };

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `code` as HTML with its tokens in spans (`tok-keyword`, `tok-string`, `tok-number`, `tok-comment`,
 * `tok-function`, `tok-type`, `tok-tag`, `tok-attr`, `tok-punct`) for `language`: js, ts, json,
 * python, bash, go, rust, sql, css or html. `HIGHLIGHT_CSS` colours them.
 */
export function highlight(code, language = 'ts') {
  const lang = ALIASES[language] ?? language;
  if (lang === 'html') return highlightHtml(code);
  const words = new Set((KEYWORDS[lang] ?? KEYWORDS.ts).split(' ').filter(Boolean));
  const comment = lang === 'python' || lang === 'bash' ? /#[^\n]*/y : lang === 'sql' ? /--[^\n]*/y : lang === 'json' ? null : /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;
  const patterns = [
    ['comment', comment],
    ['string', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y],
    ['number', /\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy],
    ['attr', lang === 'css' ? /[a-z-]+(?=\s*:)/y : null],
    ['word', /[A-Za-z_$][\w$-]*/y],
    ['punct', /[{}()[\];,.:<>=+\-*/%!&|^~?@#]+/y],
    ['space', /\s+/y],
  ].filter(([, pattern]) => pattern !== null);
  let html = '';
  let i = 0;
  while (i < code.length) {
    let matched = false;
    for (const [kind, pattern] of patterns) {
      pattern.lastIndex = i;
      const match = pattern.exec(code);
      if (!match || match[0] === '') continue;
      let text = match[0];
      let cls = kind;
      if (kind === 'word') {
        // a dash belongs to a word in css and bash flags only
        if (lang !== 'css' && lang !== 'bash') text = /^[A-Za-z_$][\w$]*/.exec(text)[0];
        const after = code.slice(i + text.length);
        cls = words.has(text) ? 'keyword' : /^\s*\(/.test(after) ? 'function' : /^[A-Z]/.test(text) ? 'type' : '';
      } else if (kind === 'string' && lang === 'json' && /^\s*:/.test(code.slice(i + text.length))) {
        cls = 'attr';
      } else if (kind === 'space') {
        cls = '';
      }
      html += cls ? `<span class="tok-${cls}">${escape(text)}</span>` : escape(text);
      i += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      html += escape(code[i]);
      i++;
    }
  }
  return html;
}

function highlightHtml(code) {
  return escape(code).replace(/(&lt;\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?&gt;)/g, (_, open, tag, attrs, close) => {
    const coloured = attrs.replace(/([\w-]+)(=)("[^"]*"|'[^']*')/g, '<span class="tok-attr">$1</span><span class="tok-punct">$2</span><span class="tok-string">$3</span>');
    return `<span class="tok-punct">${open}</span><span class="tok-tag">${tag}</span>${coloured}<span class="tok-punct">${close}</span>`;
  });
}

/** Colours for `highlight`'s spans: a dark editor theme. */
export const HIGHLIGHT_CSS = `
.tok-keyword { color: #ff7ab2; }
.tok-string { color: #ffb86b; }
.tok-number { color: #d9c97c; }
.tok-comment { color: #7f8c98; font-style: italic; }
.tok-function { color: #67b7f7; }
.tok-type { color: #5dd8ff; }
.tok-tag { color: #ff7ab2; }
.tok-attr { color: #b281eb; }
.tok-punct { color: #a9b1bd; }
`;

/** Shrinks `element`'s font from `max` down to `min` px until its text fits `width` px on one line. */
export function fit(element, { width, max, min = 8 }) {
  let size = max;
  element.style.fontSize = `${size}px`;
  while (size > min && element.scrollWidth > width) {
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
  return size;
}
