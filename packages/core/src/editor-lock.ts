import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

/** The Cuttle app's mark that a project is open in its editor, inside the project (written by the app). */
export const EDITOR_LOCK = join('.cuttle', 'editor.lock');

/** What the lock says: the computer, and the app's process there. */
export interface EditorLock {
  host: string;
  pid?: number;
}

/** Whether a process runs on this computer (one that exists but is not ours to signal counts). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Who has the project open in the Cuttle app, by its lock: undefined when nobody has (no lock, one
 * that does not parse, or one an app on this computer left when it ended).
 */
export async function editorLockOf(dir: string): Promise<EditorLock | undefined> {
  const text = await readFile(join(dir, EDITOR_LOCK), 'utf8').catch(() => undefined);
  let held: unknown;
  try {
    held = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof held !== 'object' || held === null) return undefined;
  const { host, pid } = held as { host?: unknown; pid?: unknown };
  if (typeof host !== 'string') return undefined;
  // from this computer: open only while its app still runs (a lock without a process id is not from one)
  if (host === hostname() && (typeof pid !== 'number' || !running(pid))) return undefined;
  return { host, ...(typeof pid === 'number' && { pid }) };
}
