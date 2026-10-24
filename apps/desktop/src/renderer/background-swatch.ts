import type { CSSProperties } from 'react';
import type { BackgroundPreset } from '@cuttle/project';

/**
 * The swatch of the current gradient or mesh in its own colours (a gradient as laid out); the
 * others keep their picture.
 */
export function swatchStyle(background: { preset: BackgroundPreset; colors?: readonly string[]; kind?: 'linear' | 'radial'; angle?: number }, preset: BackgroundPreset): CSSProperties | undefined {
  if ((preset !== 'gradient' && preset !== 'mesh') || !background.colors || background.preset !== preset) return undefined;
  const stops = background.colors.join(', ');
  if (preset === 'mesh') return { backgroundImage: `linear-gradient(135deg in oklab, ${stops})` };
  return { backgroundImage: background.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${background.angle ?? 135}deg in oklab, ${stops})` };
}
