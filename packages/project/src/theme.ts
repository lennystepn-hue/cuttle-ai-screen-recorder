import type { BackgroundPreset, Look } from './schema';

/** A dark tone of each background preset, for pages that draw their own background. */
const BACKGROUND_TONES: Record<BackgroundPreset, string> = {
  'sunset-sky': '#1b1c4a',
  aurora: '#050816',
  mesh: '#2a2140',
  solid: '#16161a',
  image: '#16161a',
};

/**
 * The tone motion pages draw their own background in when the theme names none: a solid
 * background's colour, else a dark tone of the preset.
 */
export function backgroundTone(background: Look['background']): string {
  return background.preset === 'solid' && background.color ? background.color : BACKGROUND_TONES[background.preset];
}
