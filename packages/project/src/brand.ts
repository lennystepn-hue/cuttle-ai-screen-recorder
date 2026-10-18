import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import { BackgroundSchema, CURSOR_STYLES, FRAME_STYLES, ThemeSchema, hexColor } from './schema';

/** The brand.json format version this build reads and writes. */
export const BRAND_VERSION = 1;

/**
 * A brand kit: `brand.json` in a folder of its own, with its files next to it (the logo, a
 * background image). It holds a project's theme and the parts of its look that are the brand's
 * (the background, the frame's style, the cursor's style and colour); applying it sets them in a
 * project with one click. Its files are named by the file name alone (`logo.png`).
 */
export const BrandKitSchema = z.strictObject({
  version: z.literal(BRAND_VERSION),
  name: z.string().trim().min(1).max(80),
  theme: ThemeSchema.omit({ kit: true }),
  look: z.strictObject({
    background: BackgroundSchema,
    frame: z.strictObject({ style: z.enum(FRAME_STYLES) }),
    cursor: z.strictObject({ style: z.enum(CURSOR_STYLES), color: hexColor }),
  }),
});

export type BrandKit = z.output<typeof BrandKitSchema>;

export type BrandKitParseResult = { ok: true; kit: BrandKit } | { ok: false; issues: ProjectIssue[] };

export function parseBrandKitJson(text: string): BrandKitParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = BrandKitSchema.safeParse(raw);
  if (result.success) return { ok: true, kit: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
