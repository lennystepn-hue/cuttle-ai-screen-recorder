import type { TextStyle } from '@cuttle/project';

/** How a piece of text is drawn into a sprite. Sizes are in units (1 px at 1080p); colours are CSS colours. */
export interface LabelStyle {
  size: number;
  weight: number;
  /** The font family, loaded before (default the engine's Inter). */
  family?: string;
  color: string;
  /** Box behind the text; without it only the text is drawn. */
  fill?: string;
  padX: number;
  padY: number;
  radius: number | 'pill';
  /** A bar along the box's left edge. */
  accent?: string;
  /** Shadow of the box, or of the text when there is no box. */
  shadow?: { blur: number; y: number; color: string };
  align: 'center' | 'left';
}

/** The three `texts[].style` presets. */
export const TEXT_LABELS: Record<TextStyle, LabelStyle> = {
  pill: {
    size: 28,
    weight: 600,
    color: '#18181B',
    fill: 'rgba(255, 255, 255, 0.94)',
    padX: 26,
    padY: 12,
    radius: 'pill',
    shadow: { blur: 18, y: 4, color: 'rgba(0, 0, 0, 0.28)' },
    align: 'center',
  },
  'lower-third': {
    size: 30,
    weight: 600,
    color: '#FFFFFF',
    fill: 'rgba(17, 17, 20, 0.88)',
    padX: 22,
    padY: 14,
    radius: 10,
    accent: '#D97757',
    shadow: { blur: 18, y: 4, color: 'rgba(0, 0, 0, 0.3)' },
    align: 'left',
  },
  caption: {
    size: 26,
    weight: 400,
    color: '#FFFFFF',
    fill: 'rgba(0, 0, 0, 0.72)',
    padX: 16,
    padY: 8,
    radius: 8,
    align: 'center',
  },
};

/** The speed badge ("12× speed"). */
export const BADGE_STYLE: LabelStyle = {
  size: 18,
  weight: 600,
  color: '#FFFFFF',
  fill: 'rgba(17, 17, 20, 0.78)',
  padX: 14,
  padY: 7,
  radius: 'pill',
  align: 'center',
};

/** Card scene title and subtitle. */
export const CARD_TITLE_STYLE: LabelStyle = {
  size: 72,
  weight: 600,
  color: '#FFFFFF',
  padX: 0,
  padY: 0,
  radius: 0,
  shadow: { blur: 24, y: 4, color: 'rgba(0, 0, 0, 0.35)' },
  align: 'center',
};

export const CARD_SUBTITLE_STYLE: LabelStyle = {
  size: 34,
  weight: 400,
  color: 'rgba(255, 255, 255, 0.8)',
  padX: 0,
  padY: 0,
  radius: 0,
  shadow: { blur: 16, y: 2, color: 'rgba(0, 0, 0, 0.3)' },
  align: 'center',
};

/** Window title; its colour comes from the frame style. */
/** A text watermark `height` px high (white, a soft shadow so it reads on any picture), at `unit`. */
export function watermarkStyle(height: number, unit: number): LabelStyle {
  return { size: Math.max(6, (height / unit) * 0.72), weight: 600, color: '#FFFFFF', padX: 0, padY: 0, radius: 0, shadow: { blur: 6, y: 1, color: 'rgba(0, 0, 0, 0.45)' }, align: 'left' };
}

export function windowTitleStyle(color: string): LabelStyle {
  return { size: 14, weight: 400, color, padX: 0, padY: 0, radius: 0, align: 'center' };
}
