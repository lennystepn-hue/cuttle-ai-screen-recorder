import { ProjectSchema, type CuttleProject } from './schema';

export const CURRENT_VERSION = 1;

export interface ProjectIssue {
  path: string;
  message: string;
}

export type ParseResult = { ok: true; project: CuttleProject } | { ok: false; issues: ProjectIssue[] };

export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((out, key) => {
    if (typeof key === 'number') return `${out}[${key}]`;
    return out === '' ? String(key) : `${out}.${String(key)}`;
  }, '');
}

function versionOf(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return undefined;
  return (raw as { version: unknown }).version;
}

// Version 1 is the only format so far. When version 2 exists, upgrade older input here
// before validating, and never write the upgraded file back without the user asking.
export function parseProject(raw: unknown): ParseResult {
  const version = versionOf(raw);
  if (typeof version === 'number' && version > CURRENT_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: 'version',
          message: `cuttle.json is version ${version}, this Cuttle reads up to version ${CURRENT_VERSION}. Update Cuttle.`,
        },
      ],
    };
  }
  const result = ProjectSchema.safeParse(raw);
  if (result.success) return { ok: true, project: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
  };
}

export function parseProjectJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  return parseProject(raw);
}
