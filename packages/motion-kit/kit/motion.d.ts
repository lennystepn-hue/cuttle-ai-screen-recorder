// Types of Cuttle's motion helpers (motion.js), served with them at cuttle-motion://kit/motion.d.ts.

export type Curve = (t: number) => number;
export type KeyValue = number | string | number[];

export function clamp(value: number, min?: number, max?: number): number;
export function lerp(a: number, b: number, t: number): number;
export function bezier(x1: number, y1: number, x2: number, y2: number): Curve;
export function spring(seconds: number, options?: { stiffness?: number; damping?: number; mass?: number }): number;
export const ease: {
  linear: Curve;
  in: Curve;
  out: Curve;
  inOut: Curve;
  outQuart: Curve;
  outQuint: Curve;
  inExpo: Curve;
  outExpo: Curve;
  inOutExpo: Curve;
  outBack: Curve;
  inBack: Curve;
  outElastic: Curve;
  css: Curve;
  cssOut: Curve;
  smooth: Curve;
};
export function at(t: number, start: number, duration: number, curve?: Curve): number;
export function inOut(t: number, start: number, end: number, inFor?: number, outFor?: number, curve?: Curve): number;
export function mix(a: string, b: string, t: number): string;
export function alpha(color: string, a: number): string;
export function keys<T extends KeyValue>(t: number, frames: [time: number, value: T, curve?: Curve][]): T;
export function stagger(index: number, count: number, each: number, from?: 'start' | 'end' | 'center' | number): number;
export function frameAt(t: number, options?: { start?: number; fps?: number; count?: number }): number;
export function random(seed: number): () => number;
export function split(element: Element, by?: 'word' | 'char'): HTMLSpanElement[];
export function typed(text: string, t: number, options?: { start?: number; cps?: number; pause?: number }): string;
export function typedUntil(text: string, options?: { start?: number; cps?: number; pause?: number }): number;
export function highlight(code: string, language?: string): string;
export const HIGHLIGHT_CSS: string;
export function fit(element: HTMLElement, options: { width: number; max: number; min?: number }): number;
