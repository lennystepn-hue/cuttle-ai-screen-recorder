// Captions drawn into a sprite: one or two lines of words, the spoken word in the caption colour
// (karaoke, bold), on a dark box (subtitle, karaoke) or outlined (bold).
import type { CaptionStyle } from '@cuttle/project';
import { cssFont } from './sprites';

/** How a style draws a caption. Sizes are in units (1 px at 1080p). */
export interface CaptionLook {
  size: number;
  /** Line height, in ems. */
  lineHeight: number;
  /** Box behind the lines; without it the words are outlined. */
  fill?: string;
  padX: number;
  padY: number;
  radius: number;
  /** Outline of the words (no box), in units. */
  stroke?: number;
  shadow?: { blur: number; y: number; color: string };
  /** The spoken word in the caption colour. */
  highlight: boolean;
  upper: boolean;
  /** Share of the output width the caption may use. */
  maxWidth: number;
}

export const CAPTION_LOOKS: Record<CaptionStyle, CaptionLook> = {
  subtitle: { size: 38, lineHeight: 1.28, fill: 'rgba(8, 8, 10, 0.74)', padX: 22, padY: 12, radius: 12, highlight: false, upper: false, maxWidth: 0.86 },
  karaoke: { size: 38, lineHeight: 1.28, fill: 'rgba(8, 8, 10, 0.74)', padX: 22, padY: 12, radius: 12, highlight: true, upper: false, maxWidth: 0.86 },
  bold: {
    size: 74,
    lineHeight: 1.15,
    padX: 0,
    padY: 0,
    radius: 0,
    stroke: 9,
    shadow: { blur: 22, y: 6, color: 'rgba(0, 0, 0, 0.45)' },
    highlight: true,
    upper: true,
    maxWidth: 0.9,
  },
};

const WHITE = '#FFFFFF';

/**
 * Draws a caption's lines centred, at `scale` × the style's size, smaller where the widest line
 * would pass `maxWidth` px. `current`: the spoken word, counted over the lines.
 */
export function drawCaption(
  lines: readonly (readonly string[])[],
  current: number | undefined,
  style: CaptionStyle,
  color: string,
  unit: number,
  scale: number,
  maxWidth: number,
): { canvas: OffscreenCanvas; margin: number } {
  const look = CAPTION_LOOKS[style];
  const texts = lines.map((line) => line.map((word) => (look.upper ? word.toLocaleUpperCase() : word)));
  const padX = Math.round(look.padX * unit * scale);
  const padY = Math.round(look.padY * unit * scale);
  const stroke = look.stroke ? Math.max(1, Math.round(look.stroke * unit * scale)) : 0;
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  let fontPx = Math.max(1, Math.round(look.size * unit * scale));
  measure.font = cssFont(600, fontPx);
  const widest = Math.max(...texts.map((line) => measure.measureText(line.join(' ')).width));
  const room = maxWidth - 2 * padX - 2 * stroke;
  if (widest > room && widest > 0) {
    fontPx = Math.max(1, Math.floor((fontPx * room) / widest));
    measure.font = cssFont(600, fontPx);
  }
  const space = measure.measureText(' ').width;
  const widths = texts.map((line) => line.map((word) => measure.measureText(word).width));
  const lineWidths = widths.map((line) => line.reduce((sum, width) => sum + width, 0) + space * Math.max(0, line.length - 1));
  const lineHeight = Math.round(fontPx * look.lineHeight);
  const boxWidth = Math.max(1, Math.ceil(Math.max(...lineWidths)) + 2 * padX + 2 * stroke);
  const boxHeight = lineHeight * texts.length + 2 * padY + 2 * stroke;
  const shadow = look.shadow ? Math.ceil((look.shadow.blur + Math.abs(look.shadow.y)) * unit * scale) : 0;
  const margin = Math.max(shadow, Math.ceil(fontPx * 0.15));

  const canvas = new OffscreenCanvas(boxWidth + 2 * margin, boxHeight + 2 * margin);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(margin, margin);
  if (look.fill) {
    ctx.fillStyle = look.fill;
    ctx.beginPath();
    ctx.roundRect(0, 0, boxWidth, boxHeight, look.radius * unit * scale);
    ctx.fill();
  }
  ctx.font = cssFont(600, fontPx);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  let index = 0;
  texts.forEach((line, row) => {
    let x = (boxWidth - lineWidths[row]!) / 2;
    const y = padY + stroke + lineHeight * row + lineHeight / 2;
    line.forEach((word, i) => {
      const spoken = look.highlight && index === current;
      if (stroke > 0) {
        if (look.shadow) {
          ctx.shadowColor = look.shadow.color;
          ctx.shadowBlur = look.shadow.blur * unit * scale;
          ctx.shadowOffsetY = look.shadow.y * unit * scale;
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
        ctx.lineWidth = stroke * 2;
        ctx.strokeText(word, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = spoken ? color : WHITE;
      ctx.fillText(word, x, y);
      x += widths[row]![i]! + space;
      index++;
    });
  });
  return { canvas, margin };
}
