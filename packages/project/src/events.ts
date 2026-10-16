import { formatPath, type ProjectIssue } from './parse';
import { InputEventSchema, type InputEvent } from './schema';

/**
 * Parses events.jsonl: one input event per line, blank lines ignored. A recorder that crashed can
 * leave the last line cut off; an unterminated last line that is not valid JSON is dropped without
 * an issue. Every other invalid line becomes an issue with the path `line <n>` (1-based) and is
 * left out of `events`.
 */
export function parseEventsJsonl(text: string): { events: InputEvent[]; issues: ProjectIssue[] } {
  const events: InputEvent[] = [];
  const issues: ProjectIssue[] = [];
  const lines = text.split('\n');
  const unterminated = !text.endsWith('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    const path = `line ${index + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (unterminated && index === lines.length - 1) return;
      issues.push({ path, message: `Invalid JSON: ${(error as Error).message}` });
      return;
    }
    const result = InputEventSchema.safeParse(value);
    if (result.success) {
      events.push(result.data);
      return;
    }
    for (const issue of result.error.issues) {
      const field = issue.path.length > 0 ? `.${formatPath(issue.path)}` : '';
      issues.push({ path: `${path}${field}`, message: issue.message });
    }
  });
  return { events, issues };
}
