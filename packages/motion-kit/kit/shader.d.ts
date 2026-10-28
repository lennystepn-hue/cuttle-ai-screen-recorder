// Types of the kit's shader (shader.js), served with it at cuttle-motion://kit/shader.d.ts.

/** A uniform's value: a number (float), 2 to 4 numbers (vec2 to vec4), a CSS colour (vec3) or a switch (1.0 or 0.0). */
export type UniformValue = number | [number, number] | [number, number, number] | [number, number, number, number] | string | boolean;

/** The GLSL library every effect has (noise, fbm, curl, grain, vignette, halftone, bayer, grade, luma, rotate, easing), for shaders of your own. */
export const GLSL: string;

/** Draws `source` (GLSL with `vec4 effect(vec2 uv)`) over the whole page every frame. */
export function shader(
  source: string,
  options?: { uniforms?: Record<string, UniformValue>; canvas?: HTMLCanvasElement },
): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; set(name: string, value: UniformValue): void };
