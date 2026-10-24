import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import { BackgroundSchema, FRAME_STYLES, RectSchema } from './schema';

/** The shot.json format version this build reads and writes. */
export const SHOT_VERSION = 1;
/** A shot's file in its folder, beside its image (`source.png`) and its last render (`shot.png`). */
export const SHOT_FILE = 'shot.json';

/** A ratio such as `16:9` or `1.91:1`: the canvas grows to it around the shot. */
const RATIO = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

/** The width over the height of a ratio such as `16:9`; undefined when it is none (or has a 0 in it). */
export function shotRatio(size: string): number | undefined {
  const match = RATIO.exec(size);
  if (!match) return undefined;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
}

/** Output pixels a side may have at most (Chromium's canvas and most GPUs' textures). */
export const SHOT_MAX_SIDE = 16384;

/**
 * The canvas: `auto` (the framed shot and its padding, pixel for pixel), a ratio the canvas grows to
 * around it (`16:9`), or pixels the framed shot is fitted into (made smaller, never larger).
 */
const ShotSizeSchema = z.union([
  z.literal('auto'),
  z.string().refine((size) => shotRatio(size) !== undefined, 'a size is "auto", a ratio like "16:9", or { "width": 1200, "height": 630 }'),
  z.strictObject({ width: z.number().int().min(16).max(SHOT_MAX_SIDE), height: z.number().int().min(16).max(SHOT_MAX_SIDE) }),
]);

const ShotFrameSchema = z.strictObject({
  /** The window around the shot; `none` keeps the corners and the shadow (the shot alone, rounded). */
  style: z.enum(FRAME_STYLES).default('none'),
  /** The title bar's text: a window's title, a browser's address, a terminal's path. */
  title: z.string().default(''),
  /** The corner radius in points. */
  radius: z.number().nonnegative().default(12),
  shadow: z.boolean().default(true),
});

/**
 * shot.json: a screenshot framed as the videos are (a frame, a background, a shadow), kept beside
 * its image so it can be changed and drawn again. Sizes are points: the image's pixels over its
 * `scale`, so a shot from a Retina display gets its frame, padding and shadow at 2× and keeps every
 * pixel of the image.
 */
export const ShotSchema = z.strictObject({
  version: z.literal(SHOT_VERSION),
  /** The image: a path from the shot's folder (`source.png`) or an absolute one. */
  source: z.string().min(1),
  /** The image's pixels per point: 2 from a Retina display, 1.5 from a display at 150 %. */
  scale: z.number().positive().max(8).default(1),
  /** The part of the image the shot shows, in image pixels; without it, all of it. */
  crop: RectSchema.optional(),
  /** Space between the framed shot and the canvas's edge, in points. */
  padding: z.number().min(0).max(1000).default(64),
  size: ShotSizeSchema.default('auto'),
  background: BackgroundSchema.default({ preset: 'sunset-sky' }),
  /** The framed shot and its shadow on nothing instead of the background (a PNG or WebP keeps it; a JPEG cannot). */
  transparent: z.boolean().default(false),
  frame: ShotFrameSchema.prefault({}),
});

export type Shot = z.output<typeof ShotSchema>;
export type ShotInput = z.input<typeof ShotSchema>;
export type ShotSize = Shot['size'];

export type ShotParseResult = { ok: true; shot: Shot } | { ok: false; issues: ProjectIssue[] };

export function parseShot(raw: unknown): ShotParseResult {
  const result = ShotSchema.safeParse(raw);
  if (result.success) return { ok: true, shot: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}

export function parseShotJson(text: string): ShotParseResult {
  let raw: unknown;
  try {
    // A UTF-8 byte order mark (U+FEFF), as Windows editors and PowerShell 5.1 write one, is not JSON.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  return parseShot(raw);
}
