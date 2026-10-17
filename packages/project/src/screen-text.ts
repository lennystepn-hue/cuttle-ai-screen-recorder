import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';
import { RectSchema } from './schema';

/** A word the screen showed, with its rect in source pixels of the screen track. */
const ScreenTextWordSchema = z.strictObject({ text: z.string(), rect: RectSchema });

/** A line of words, as the OCR read it; its rect holds all its words. */
const ScreenTextLineSchema = z.strictObject({ text: z.string(), rect: RectSchema, words: z.array(ScreenTextWordSchema) });

/**
 * One line of screen-text.jsonl: the text of the frame at `t` (source seconds), read by the OCR pass
 * where the picture changed. It is the person's screen: it stays on this computer.
 */
export const ScreenTextFrameSchema = z.strictObject({ t: z.number().nonnegative(), lines: z.array(ScreenTextLineSchema) });

export type ScreenTextWord = z.output<typeof ScreenTextWordSchema>;
export type ScreenTextLine = z.output<typeof ScreenTextLineSchema>;
export type ScreenTextFrame = z.output<typeof ScreenTextFrameSchema>;

/** Parses screen-text.jsonl: one frame per line, blank lines ignored, invalid ones reported as `line <n>`. */
export function parseScreenTextJsonl(text: string): { frames: ScreenTextFrame[]; issues: ProjectIssue[] } {
  const frames: ScreenTextFrame[] = [];
  const issues: ProjectIssue[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      issues.push({ path: `line ${index + 1}`, message: `Invalid JSON: ${(error as Error).message}` });
      return;
    }
    const result = ScreenTextFrameSchema.safeParse(value);
    if (result.success) frames.push(result.data);
    else for (const issue of result.error.issues) issues.push({ path: `line ${index + 1}${issue.path.length > 0 ? `.${formatPath(issue.path)}` : ''}`, message: issue.message });
  });
  return { frames, issues };
}
