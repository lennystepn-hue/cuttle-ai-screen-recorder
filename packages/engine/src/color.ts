export type Rgb = [r: number, g: number, b: number];

/** `#RRGGBB` to sRGB components in 0..1. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) throw new Error(`not a hex color: ${hex}`);
  const n = Number.parseInt(match[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
