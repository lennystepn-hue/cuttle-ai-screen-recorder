// The open project's cuttle.json on disk: the editor's saves (hash-checked, so they never overwrite
// another program's) and a watcher that reports the versions this window did not write: Claude's,
// the CLI's, a text editor's, or the app's own suggest after a take.
import { watch, type FSWatcher } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { CoreError, PROJECT_FILE, projectHash, readProjectFile, writeProjectFile } from '@cuttle/core';
import { parseProject, parseProjectJson } from '@cuttle/project';
import { locateJsonIssue, plainIssue } from '../shared/format';
import type { ChangeOrigin, ProjectFileEvent, Responses } from '../shared/ipc';
import { isInside } from '../shared/media-path';

const firstLine = (message: string) => message.split('\n')[0]!;
const issueLines = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`));

export class ProjectFileWatch {
  /**
   * The version on disk as this window last read, wrote or reported it: only that one is not news.
   * Every other change is, a version this window wrote earlier too (a revert by Claude, git or a backup).
   */
  private current: string | undefined;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest while it cuts a take, its speech edits or its privacy masks. */
  origin: ChangeOrigin = 'outside';
  /**
   * Looks and saves, one at a time: a look that read the file while a save replaced it would take
   * the version before the save for someone else's (fast undos), and report a version already gone.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly onChange: (event: ProjectFileEvent) => void,
  ) {}

  start(hash: string | undefined): void {
    this.current = hash;
    try {
      this.watcher = watch(this.dir, (_event, name) => {
        if (name && name.toLowerCase() === PROJECT_FILE) this.schedule();
      });
      this.watcher.on('error', () => this.close());
    } catch {
      // a folder that cannot be watched: outside changes show on the next open
    }
  }

  /**
   * Looks now, not after the pause: a change already on disk is reported with the origin set for
   * it, before another is set (the app's privacy step can follow its cut within the pause).
   */
  settle(): Promise<void> {
    clearTimeout(this.timer);
    return this.serial(() => this.check());
  }

  /** A save is a write followed by a rename: look once things have settled. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.serial(() => this.check()), 150);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async check(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.dir, PROJECT_FILE));
    } catch {
      return;
    }
    const hash = projectHash(bytes);
    if (hash === this.current && !this.broken) return;
    this.current = hash;
    const text = bytes.toString('utf8');
    const parsed = parseProjectJson(text);
    this.broken = !parsed.ok;
    // the line of a JSON error, which this Electron's message leaves out
    if (!parsed.ok) return this.onChange({ issues: issueLines(parsed.issues.map((issue) => ({ ...issue, message: locateJsonIssue(issue.message, text) }))) });
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
    const origin = this.origin;
    this.origin = 'outside';
    this.onChange({ raw, hash, origin });
  }

  /**
   * Writes `raw` if the file on disk is still the version `base` names; otherwise answers with the
   * version there now (and who wrote it), for the editor to put its gesture on top of. That version
   * reaches the editor this way only, not through the watcher as well.
   */
  save(raw: Record<string, unknown>, base: string): Promise<Responses['project:save']> {
    return this.serial(() => this.write(raw, base));
  }

  private async write(raw: Record<string, unknown>, base: string): Promise<Responses['project:save']> {
    const parsed = parseProject(raw);
    if (!parsed.ok) return { problem: `the edit would make cuttle.json invalid: ${issueLines(parsed.issues).join('; ')}` };
    try {
      // the watcher's look for this write comes after it (one at a time) and finds it current
      const { file } = await writeProjectFile({ dir: this.dir, path: join(this.dir, PROJECT_FILE), raw, project: parsed.project, hash: base }, 'the edit');
      this.current = file.hash!;
      return { hash: file.hash! };
    } catch (error) {
      if (!(error instanceof CoreError) || error.code !== 'conflict') return { problem: firstLine((error as Error).message) };
      try {
        const latest = await readProjectFile(this.dir);
        this.current = latest.hash!;
        const origin = this.origin;
        this.origin = 'outside';
        return { conflict: { raw: latest.raw, hash: latest.hash!, origin } };
      } catch (latestError) {
        return { problem: firstLine((latestError as Error).message) };
      }
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }
}

/**
 * An image for a still or the background, as a project path: one inside the project as it is, one
 * outside copied into `images/` (a file of the same name and the same bytes there is that copy).
 */
const sameBytes = async (a: string, b: string) => (await readFile(a)).equals(await readFile(b));

export async function importImage(dir: string, file: string): Promise<string> {
  const root = await realpath(dir);
  const real = await realpath(file);
  const relativePath = (path: string) => relative(root, path).split(sep).join('/');
  if (isInside(real, root, process.platform)) return relativePath(real);
  const folder = join(root, 'images');
  await mkdir(folder, { recursive: true });
  const size = (await stat(real)).size;
  const stem = basename(real, extname(real)).replace(/[^\w.-]+/g, '-') || 'image';
  for (let n = 1; ; n++) {
    const target = join(folder, `${stem}${n === 1 ? '' : `-${n}`}${extname(real).toLowerCase()}`);
    const existing = await stat(target).catch(() => undefined);
    if (existing && existing.size === size && (await sameBytes(target, real))) return relativePath(target);
    if (existing) continue;
    await copyFile(real, target);
    return relativePath(target);
  }
}
