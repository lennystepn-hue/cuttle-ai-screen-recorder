// Types of the take's mask helpers (take.js), which the kit's worker uses for `cuttle.take.frame`.

export type Rect = [x: number, y: number, width: number, height: number];
export interface TakeMask {
  from: number;
  to: number;
  rect: Rect;
  style: string;
  moves?: { at: number; rect: Rect }[];
}

export function maskRectAt(mask: TakeMask, t: number): Rect | null;
export function masksAt(masks: readonly TakeMask[], t: number, scale: number, width: number, height: number): { style: 'fill' | 'blur'; rect: Rect }[];
export function ringColor(data: ArrayLike<number>, width: number, inner: Rect): [number, number, number];
