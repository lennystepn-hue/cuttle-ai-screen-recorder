// Lucide's icons (ISC, lucide.dev) in a motion page, without the network:
//   import { icon } from 'cuttle/icons';
//   cuttle.ready(icon('rocket', { size: 160, color: 'var(--cuttle-accent)' }).then((svg) => stage.append(svg)));
// `cuttle motion icons <words>` finds an icon's name by what it shows.

const SVG = 'http://www.w3.org/2000/svg';

/** Every icon's shapes by its name (a module of the kit, loaded the first time it is asked for). */
let shapes;
const load = () => (shapes ??= import('./icons/icons.js').then((module) => module.default));

/** The names of every icon. */
export async function iconNames() {
  return Object.keys(await load());
}

/**
 * An icon as an `<svg>` element: `size` in px (its box; 24 by default), `color` of its lines (any CSS
 * colour, `currentColor` by default), `stroke` their width in the icon's 24-unit grid (2), `fill`
 * inside its shapes (`none`).
 */
export async function icon(name, { size = 24, color = 'currentColor', stroke = 2, fill = 'none' } = {}) {
  const all = await load();
  const parts = all[name];
  if (!parts) throw new Error(`there is no icon "${name}" (cuttle motion icons <words> finds one)`);
  const svg = document.createElementNS(SVG, 'svg');
  const attributes = { xmlns: SVG, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, String(value));
  // as styles, so CSS variables work (`var(--cuttle-accent)`); an attribute would not take one
  svg.style.color = color;
  if (fill !== 'none') svg.style.fill = fill;
  for (const [tag, attrs] of parts) {
    const part = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, String(value));
    svg.append(part);
  }
  return svg;
}

/**
 * An icon as an image to draw on a canvas or in WebGL (`drawImage`, a texture): its SVG at `size` px,
 * decoded. Colours here are colours, not CSS variables.
 */
export async function iconImage(name, options = {}) {
  const svg = await icon(name, { color: '#ffffff', ...options });
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await image.decode();
  return image;
}
