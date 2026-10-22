// A shortcut's badge drawn into a sprite: each key a cap of its own (⌘ ⇧ P, or Ctrl Shift P) and how
// often it was pressed after them (×3), on a dark rounded plate that reads over any picture.
import { cssFont } from './sprites';

/** Sizes in units (1 px at 1080p), at `look.keys.size` 1. */
const KEYS = {
  /** A cap's height; a single character's cap is as wide as it is high. */
  cap: 58,
  /** Space between the caps, before the count, and the plate's edge around them. */
  gap: 8,
  pad: 10,
  padX: 16,
  font: 27,
  /** A symbol (⌘, ←) or a single letter is set larger than a word (Ctrl, esc). */
  glyph: 31,
  radius: 12,
  /** The cap's lower edge, a shade darker: it reads as a key. */
  lip: 3,
  plate: { fill: 'rgba(16, 16, 20, 0.86)', edge: 'rgba(255, 255, 255, 0.1)', shadow: { blur: 24, y: 8, color: 'rgba(0, 0, 0, 0.35)' } },
  capFill: 'rgba(255, 255, 255, 0.11)',
  capEdge: 'rgba(255, 255, 255, 0.16)',
  lipFill: 'rgba(0, 0, 0, 0.3)',
  color: '#FFFFFF',
  countColor: 'rgba(255, 255, 255, 0.78)',
};

/** Draws the plate with the caps of `keys` and, from 2, `×count`, at `unit` × `size`. */
export function drawKeys(keys: readonly string[], count: number, unit: number, size: number): { canvas: OffscreenCanvas; margin: number } {
  const u = unit * size;
  const cap = Math.round(KEYS.cap * u);
  const gap = Math.round(KEYS.gap * u);
  const pad = Math.round(KEYS.pad * u);
  const padX = Math.round(KEYS.padX * u);
  const fontPx = (key: string) => Math.max(1, Math.round(([...key].length === 1 ? KEYS.glyph : KEYS.font) * u));
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  const widths = keys.map((key) => {
    measure.font = cssFont(600, fontPx(key));
    return Math.max(cap, Math.ceil(measure.measureText(key).width) + 2 * padX);
  });
  const countText = count > 1 ? `×${count}` : '';
  const countFont = cssFont(600, Math.round(KEYS.font * u));
  measure.font = countFont;
  const countWidth = countText ? gap + Math.ceil(measure.measureText(countText).width) + Math.round(4 * u) : 0;
  const width = widths.reduce((sum, w) => sum + w, 0) + gap * (keys.length - 1) + countWidth + 2 * pad;
  const height = cap + 2 * pad;
  const margin = Math.ceil((KEYS.plate.shadow.blur + KEYS.plate.shadow.y) * u);
  const canvas = new OffscreenCanvas(Math.max(1, width) + 2 * margin, height + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
  const line = Math.max(1, 1.5 * u);
  // the plate, with its shadow and a faint rim
  const plateRadius = (KEYS.radius + KEYS.pad) * u;
  ctx.save();
  ctx.shadowColor = KEYS.plate.shadow.color;
  ctx.shadowBlur = KEYS.plate.shadow.blur * u;
  ctx.shadowOffsetY = KEYS.plate.shadow.y * u;
  ctx.fillStyle = KEYS.plate.fill;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, plateRadius);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = KEYS.plate.edge;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.roundRect(line / 2, line / 2, width - line, height - line, plateRadius);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let x = pad;
  keys.forEach((key, i) => {
    const w = widths[i]!;
    const radius = KEYS.radius * u;
    // the cap, its darker lower edge and its light rim
    ctx.fillStyle = KEYS.capFill;
    ctx.beginPath();
    ctx.roundRect(x, pad, w, cap, radius);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = KEYS.lipFill;
    ctx.fillRect(x, pad + cap - KEYS.lip * u, w, KEYS.lip * u);
    ctx.restore();
    ctx.strokeStyle = KEYS.capEdge;
    ctx.beginPath();
    ctx.roundRect(x + line / 2, pad + line / 2, w - line, cap - line, radius);
    ctx.stroke();
    ctx.font = cssFont(600, fontPx(key));
    ctx.fillStyle = KEYS.color;
    ctx.fillText(key, x + w / 2, pad + (cap - KEYS.lip * u) / 2 + u);
    x += w + gap;
  });
  if (countText) {
    ctx.font = countFont;
    ctx.textAlign = 'left';
    ctx.fillStyle = KEYS.countColor;
    ctx.fillText(countText, x, pad + cap / 2);
  }
  return { canvas, margin };
}
