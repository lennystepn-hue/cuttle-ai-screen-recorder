import { isColouredBackground } from './backgrounds';
import type { BackgroundPreset, Look } from './schema';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
  'sunset-sky': '#1b1c4a',
  aurora: '#050816',
  mesh: '#2a2140',
  solid: '#16161a',
  image: '#16161a',
  gradient: '#16161a',
  flow: '#0d0a24',
  bokeh: '#070b1a',
  dots: '#0b0d12',
};

const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** The darkest of `colors`, mixed `towardBlack` of the way to black, as `#rrggbb`. */
export function darkTone(colors: readonly string[], towardBlack: number): string {
  const darkest = [...colors].sort((a, b) => luminance(a) - luminance(b))[0]!;
  return `#${channels(darkest)
    .map((value) => Math.round(value * (1 - towardBlack)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The tone motion pages draw their own background in when the theme names none: a solid
 * background's colour, a dark tone of a background's own colours, else a dark tone of the preset.
 */
export function backgroundTone(background: Look['background']): string {
  if (background.preset === 'solid' && background.color) return background.color;
  if (background.colors && isColouredBackground(background.preset)) return darkTone(background.colors, 0.55);
  return BACKGROUND_TONES[background.preset];
}
