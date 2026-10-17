// The open project's cuttle.json on disk: the editor's saves (hash-checked, so they never overwrite
// another program's) and a watcher that reports the versions this window did not write: Claude's,
// the CLI's, a text editor's, or the app's own suggest after a take.
import { watch, type FSWatcher } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { CoreError, PROJECT_FILE, projectHash, readProjectFile, writeProjectFile } from '@cuttle/core';
import { parseProject, parseProjectJson } from '@cuttle/project';
import { plainIssue } from '../shared/format';
import type { ProjectFileEvent, Responses } from '../shared/ipc';
import { isInside } from '../shared/media-path';

const firstLine = (message: string) => message.split('\n')[0]!;
const issueLines = (issues: readonly { path: string; message: string }[]) => issues.map((issue) => plainIssue(`${issue.path}: ${issue.message}`));

export class ProjectFileWatch {
  /** Versions this window has: read, written or already reported. */
  private readonly known = new Set<string>();
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last version reported did not parse: the next that does is reported even when known (a fix back to it). */
  private broken = false;
  /** Who the next outside change comes from: the app's own suggest, while it cuts a take. */
  origin: 'outside' | 'suggest' = 'outside';

  constructor(
    private readonly dir: string,
    private readonly onChange: (event: ProjectFileEvent) => void,
  ) {}

  start(hash: string | undefined): void {
    if (hash) this.known.add(hash);
    try {
      this.watcher = watch(this.dir, (_event, name) => {
        if (name && name.toLowerCase() === PROJECT_FILE) this.schedule();
      });
      this.watcher.on('error', () => this.close());
    } catch {
      // a folder that cannot be watched: outside changes show on the next open
    }
  }

  /** A save is a write followed by a rename: look once things have settled. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 150);
  }

  private async check(): Promise<void> {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.dir, PROJECT_FILE));
    } catch {
      return;
    }
    const hash = projectHash(bytes);
    if (this.known.has(hash) && !this.broken) return;
    this.known.add(hash);
    const text = bytes.toString('utf8');
    const parsed = parseProjectJson(text);
    this.broken = !parsed.ok;
    if (!parsed.ok) return this.onChange({ issues: issueLines(parsed.issues) });
    const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
    const origin = this.origin;
    this.origin = 'outside';
    this.onChange({ raw, hash, origin });
  }

  /**
   * Writes `raw` if the file on disk is still the version `base` names; otherwise answers with the
   * version there now, for the editor to replay its gesture on.
   */
  async save(raw: Record<string, unknown>, base: string): Promise<Responses['project:save']> {
    const parsed = parseProject(raw);
    if (!parsed.ok) return { problem: `the edit would make cuttle.json invalid: ${issueLines(parsed.issues).join('; ')}` };
    // Known before the rename, so the watcher's event for this write is never taken for someone else's.
    this.known.add(projectHash(`${JSON.stringify(raw, null, 2)}\n`));
    try {
      const { file } = await writeProjectFile({ dir: this.dir, path: join(this.dir, PROJECT_FILE), raw, project: parsed.project, hash: base }, 'the edit');
      return { hash: file.hash! };
    } catch (error) {
      if (!(error instanceof CoreError) || error.code !== 'conflict') return { problem: firstLine((error as Error).message) };
      try {
        const latest = await readProjectFile(this.dir);
        this.known.add(latest.hash!);
        return { conflict: { raw: latest.raw, hash: latest.hash! } };
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
 * outside copied into `images/` (a file of the same name and size there is taken to be the same).
 */
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
    if (existing && existing.size === size) return relativePath(target);
    if (existing) continue;
    await copyFile(real, target);
    return relativePath(target);
  }
}
