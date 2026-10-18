import type { BackgroundPreset, ColouredBackground, Look } from './schema';

/**
 * The colours a coloured background draws in without its own `colors`: mesh's four points, the
 * flow's, the bokeh's lights and the dots' glow (a new gradient starts with these).
 */
export const BACKGROUND_PALETTES: Record<ColouredBackground, readonly string[]> = {
  gradient: ['#7C5CFF', '#FF7AB6'],
  mesh: ['#7C5CFF', '#FF7AB6', '#4CC9F0', '#FFB86B'],
  flow: ['#1A1446', '#5B3FC0', '#D6457F', '#F3A55B'],
  bokeh: ['#3A6DF0', '#A45CF0', '#F56B9B', '#F5B26B'],
  dots: ['#7C5CFF', '#4CC9F0'],
};

/** The fields each background reads (beside `preset`). */
export const BACKGROUND_FIELDS: Record<BackgroundPreset, readonly string[]> = {
  'sunset-sky': [],
  aurora: [],
  mesh: ['colors'],
  solid: ['color'],
  image: ['image', 'blur', 'dim'],
  gradient: ['colors', 'angle', 'kind'],
  flow: ['colors'],
  bokeh: ['colors'],
  dots: ['colors'],
};

/** A solid background's colour when it has none yet. */
export const SOLID_DEFAULT = '#1C1C22';

export const isColouredBackground = (preset: BackgroundPreset): preset is ColouredBackground => preset in BACKGROUND_PALETTES;

/** The colours a background draws in: its own, else its preset's (none for the others). */
export function backgroundColors(background: Look['background']): readonly string[] {
  if (!isColouredBackground(background.preset)) return [];
  return background.colors ?? BACKGROUND_PALETTES[background.preset];
}

/**
 * Another preset for a background, keeping what the new one reads (a gradient's colours stay the
 * flow's): a gradient without colours gets its preset's, a solid one a dark grey. An image needs its
 * `image` still.
 */
export function switchBackground(background: Readonly<Record<string, unknown>>, preset: BackgroundPreset): Record<string, unknown> {
  const next: Record<string, unknown> = { preset };
  for (const field of BACKGROUND_FIELDS[preset]) if (background[field] !== undefined) next[field] = background[field];
  if (preset === 'gradient' && next.colors === undefined) next.colors = [...BACKGROUND_PALETTES.gradient];
  if (preset === 'solid' && next.color === undefined) next.color = SOLID_DEFAULT;
  return next;
}
