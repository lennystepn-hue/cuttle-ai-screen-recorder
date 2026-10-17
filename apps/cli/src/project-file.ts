import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CURRENT_VERSION, parseProject, parseProjectJson, type CuttleProject } from '@cuttle/project';
import { CliError } from './errors';

export const PROJECT_FILE = 'cuttle.json';

/**
 * cuttle.json as the user wrote it (`raw`: defaults not filled in, unknown order kept) and parsed
 * (`project`). Commands edit `raw` and write it back, so the file stays as short as it was.
 */
export interface ProjectFile {
  dir: string;
  path: string;
  raw: Record<string, unknown>;
  project: CuttleProject;
}

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

export async function readProjectFile(projectDir: string): Promise<ProjectFile> {
  const dir = resolve(projectDir);
  const path = join(dir, PROJECT_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError('invalid-project', `${path} does not exist; run "cuttle init" or "cuttle record" in the project folder (or pass -C <dir>)`);
    }
    throw new CliError('invalid-project', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new CliError('invalid-project', `${path} is not a valid project:\n${issuesText(parsed.issues)}`);
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return { dir, path, raw, project: parsed.project };
}

/** A new project that records into takes/1. */
export function newProjectFile(projectDir: string): ProjectFile {
  const dir = resolve(projectDir);
  const raw = { version: CURRENT_VERSION, sources: { screen: 'takes/1/screen.mp4' } };
  return { dir, path: join(dir, PROJECT_FILE), raw, project: parse(raw) };
}

export function projectExists(projectDir: string): boolean {
  return existsSync(join(resolve(projectDir), PROJECT_FILE));
}

/**
 * Checks `file.raw` again and writes it (temp file and rename, so a crash never leaves half a file),
 * creating the project folder when it is new.
 */
export async function writeProjectFile(file: ProjectFile): Promise<ProjectFile> {
  const project = parse(file.raw);
  await mkdir(file.dir, { recursive: true });
  const temp = `${file.path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(file.raw, null, 2)}\n`);
  await rename(temp, file.path);
  return { ...file, project };
}

function parse(raw: unknown): CuttleProject {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new CliError('invalid-project', `the edited project is not valid:\n${issuesText(parsed.issues)}`);
  return parsed.project;
}
