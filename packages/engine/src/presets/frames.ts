import type { FrameStyle } from '@cuttle/project';

/** Window chrome per frame style. Sizes are in units (1 px at 1080p), colours are `#RRGGBB`. */
export interface FrameChrome {
  /** Title bar height; 0 means no title bar (the `none` style keeps radius and shadow). */
  titleBar: number;
  bar: string;
  /** Hairline between the title bar and the content. */
  line: string;
  title: string;
  trafficLights: boolean;
  /** Browser styles draw the title inside an address field. */
  address?: { fill: string };
}

export const FRAME_CHROME: Record<FrameStyle, FrameChrome> = {
  'mac-dark': { titleBar: 36, bar: '#2A2A2E', line: '#1A1A1D', title: '#D4D4D8', trafficLights: true },
  'mac-light': { titleBar: 36, bar: '#ECECEE', line: '#D4D4D8', title: '#3F3F46', trafficLights: true },
  'browser-light': {
    titleBar: 44,
    bar: '#F1F1F4',
    line: '#DCDCE0',
    title: '#52525B',
    trafficLights: true,
    address: { fill: '#FFFFFF' },
  },
  none: { titleBar: 0, bar: '#000000', line: '#000000', title: '#000000', trafficLights: false },
};

/** Close, minimise, zoom. */
export const TRAFFIC_LIGHTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

/** Traffic light radius, spacing and inset from the window's left edge, in units. */
export const TRAFFIC_LIGHT = { radius: 6, spacing: 20, inset: 20 } as const;

/** Address field size in units; its width is capped at half the window. */
export const ADDRESS_FIELD = { width: 560, height: 26, radius: 8 } as const;

/** Window shadow in units, and its opacity. */
export const WINDOW_SHADOW = { blur: 48, offset: 18, opacity: 0.5 } as const;
