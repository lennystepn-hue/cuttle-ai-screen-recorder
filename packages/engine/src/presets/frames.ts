import type { FrameStyle } from '@cuttle/project';

/**
 * A device around the screen instead of a window: no title bar, a bezel all round and a camera over
 * the screen. Its sizes are shares of the screen's width (a phone's bezel and corners grow with it).
 */
export interface DeviceChrome {
  /** The bezel on every side. */
  bezel: number;
  /** The body's outer corner radius (the screen's is the body's less the bezel). */
  radius: number;
  /** The body, and the metal band around it with the side buttons. */
  body: string;
  edge: string;
  /** The Dynamic Island (a pill) or a punch-hole camera (a dot), at the screen's top centre. */
  camera: 'island' | 'punch';
}

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
  /** Windows' caption buttons on the right (minimise, maximise, close), in the title's colour; the title then sits on the left. */
  captionButtons?: boolean;
  /** A tab on the left that the title sits in (a terminal's), in this fill, with a prompt before the title. */
  tab?: { fill: string };
  /** A phone around the screen (`titleBar` is 0). */
  device?: DeviceChrome;
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
  'browser-dark': {
    titleBar: 44,
    bar: '#2B2B30',
    line: '#1C1C20',
    title: '#C8C8D0',
    trafficLights: true,
    address: { fill: '#1C1C20' },
  },
  'windows-light': { titleBar: 32, bar: '#F3F3F3', line: '#E5E5E5', title: '#1B1B1B', trafficLights: false, captionButtons: true },
  'windows-dark': { titleBar: 32, bar: '#202020', line: '#2B2B2B', title: '#F3F3F3', trafficLights: false, captionButtons: true },
  terminal: { titleBar: 38, bar: '#2B2B2B', line: '#0C0C0C', title: '#E6E6E6', trafficLights: false, captionButtons: true, tab: { fill: '#0C0C0C' } },
  iphone: {
    titleBar: 0,
    bar: '#000000',
    line: '#000000',
    title: '#000000',
    trafficLights: false,
    device: { bezel: 0.045, radius: 0.155, body: '#050506', edge: '#4A4A4F', camera: 'island' },
  },
  android: {
    titleBar: 0,
    bar: '#000000',
    line: '#000000',
    title: '#000000',
    trafficLights: false,
    device: { bezel: 0.035, radius: 0.12, body: '#08080A', edge: '#2E2F33', camera: 'punch' },
  },
  none: { titleBar: 0, bar: '#000000', line: '#000000', title: '#000000', trafficLights: false },
};

/** Close, minimise, zoom. */
export const TRAFFIC_LIGHTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

/** Traffic light radius, spacing and inset from the window's left edge, in units. */
export const TRAFFIC_LIGHT = { radius: 6, spacing: 20, inset: 20 } as const;

/** Address field size in units; its width is capped at half the window. */
export const ADDRESS_FIELD = { width: 560, height: 26, radius: 8 } as const;

/** Windows' caption buttons in units: each this wide, their glyphs this large; the title starts this far in. */
export const CAPTION_BUTTONS = { width: 46, glyph: 10, titleInset: 14 } as const;

/** A terminal's tab in units: its inset from the window's top left, its corner radius and padding. */
export const TAB = { inset: 8, radius: 8, pad: 14 } as const;

/** Window shadow in units, and its opacity. */
export const WINDOW_SHADOW = { blur: 48, offset: 18, opacity: 0.5 } as const;
