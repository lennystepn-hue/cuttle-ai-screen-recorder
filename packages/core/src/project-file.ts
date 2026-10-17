import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CURRENT_VERSION, parseProject, parseProjectJson, type CuttleProject } from '@cuttle/project';
import { CoreError } from './errors';

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
  /**
   * SHA-256 of the file's bytes as last read or written; none for a project not on disk yet.
   * Writing refuses when the file on disk no longer has it.
   */
  hash?: string;
}

const hashOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const issuesText = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');

export async function readProjectFile(projectDir: string): Promise<ProjectFile> {
  const dir = resolve(projectDir);
  const path = join(dir, PROJECT_FILE);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CoreError('invalid-project', `${path} does not exist; run "cuttle init" or "cuttle record" in the project folder (or pass -C <dir>)`);
    }
    throw new CoreError('invalid-project', `cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  const text = bytes.toString('utf8');
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new CoreError('invalid-project', `${path} is not a valid project:\n${issuesText(parsed.issues)}`);
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return { dir, path, raw, project: parsed.project, hash: hashOf(bytes) };
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

export interface WriteOptions {
  /** Keep the file on disk as a backup first (`backupFile`), once the check has passed. */
  backup?: boolean;
}

export interface WriteResult {
  /** The project as written: its `project` and `hash` describe what is on disk now. */
  file: ProjectFile;
  /** The backup made first (`options.backup`). */
  backup?: string;
}

/** Writes in this process wait for each other, per file: check, backup and rename are one step. */
const writing = new Map<string, Promise<unknown>>();
let temps = 0;

/** The SHA-256 of a file's bytes as `ProjectFile.hash` holds it, so a watcher can tell its own write. */
export const projectHash = (bytes: Buffer | string): string => hashOf(bytes);

/**
 * Checks `file.raw` again and writes it as 2-space JSON (temp file and rename, so a crash never
 * leaves half a file), creating the project folder when it is new. Refuses with `conflict` when the
 * file on disk is no longer the one `file` was read from or last written as (or appeared, for a new
 * project), so it never overwrites what another program saved meanwhile; `operation` names what
 * ran, for the message. The check runs again before each retry of the rename. Writes from one
 * process run one at a time per file; between processes a window of milliseconds remains. Returns
 * the written file (a new object; `file` is left as it was) and the backup.
 */
export async function writeProjectFile(file: ProjectFile, operation: string, options: WriteOptions = {}): Promise<WriteResult> {
  const project = parse(file.raw);
  const text = `${JSON.stringify(file.raw, null, 2)}\n`;
  const key = process.platform === 'win32' ? file.path.toLowerCase() : file.path;
  const previous = writing.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async (): Promise<WriteResult> => {
    await mkdir(file.dir, { recursive: true });
    const unchanged = async () => {
      const onDisk = await readFile(file.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw new CoreError('invalid-project', `cannot read ${file.path}: ${error.message}`, { cause: error });
      });
      if ((onDisk && hashOf(onDisk)) !== file.hash) {
        throw new CoreError('conflict', `${file.path} changed while ${operation} ran, so it was left as it is; run ${operation} again`, { path: file.path });
      }
    };
    await unchanged();
    const backup = options.backup && existsSync(file.path) ? await backupFile(file.path) : undefined;
    const temp = `${file.path}.${process.pid}-${++temps}.tmp`;
    await writeFile(temp, text);
    try {
      await renameWhenFree(temp, file.path, unchanged);
    } catch (error) {
      await rm(temp, { force: true });
      if (error instanceof CoreError) throw error;
      throw new CoreError('invalid-project', `cannot write ${file.path}: ${(error as Error).message}`, { cause: error });
    }
    return { file: { ...file, project, hash: hashOf(text) }, ...(backup && { backup }) };
  });
  writing.set(key, run);
  try {
    return await run;
  } finally {
    if (writing.get(key) === run) writing.delete(key);
  }
}

/** Backups kept per file: `<file>.bak` is the newest, then `<file>.bak.1` … `<file>.bak.4`. */
export const BACKUPS = 5;

/**
 * Copies `path` to `<path>.bak` before a command changes it, moving older backups one step down
 * (`.bak` → `.bak.1` …, the oldest is dropped). A backup with the same bytes is not repeated, so
 * running a command twice keeps the older versions. Returns the backup's path.
 */
export async function backupFile(path: string): Promise<string> {
  const bak = `${path}.bak`;
  const current = await readFile(path);
  if (existsSync(bak)) {
    if ((await readFile(bak)).equals(current)) return bak;
    for (let n = BACKUPS - 1; n >= 1; n--) {
      const from = n === 1 ? bak : `${bak}.${n - 1}`;
      if (existsSync(from)) await renameWhenFree(from, `${bak}.${n}`);
    }
  }
  await writeFile(bak, current);
  return bak;
}

/**
 * A rename that waits a moment for a file another program holds (OneDrive, a virus scanner, an
 * editor); `beforeRetry` runs before each new attempt (and may throw to give up).
 */
async function renameWhenFree(from: string, to: string, beforeRetry?: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((done) => setTimeout(done, 100 * attempt));
      await beforeRetry?.();
    }
  }
}

function parse(raw: unknown): CuttleProject {
  const parsed = parseProject(raw);
  if (!parsed.ok) throw new CoreError('invalid-project', `the edited project is not valid:\n${issuesText(parsed.issues)}`);
  return parsed.project;
}
