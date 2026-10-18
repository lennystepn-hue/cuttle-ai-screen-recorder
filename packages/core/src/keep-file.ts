import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Puts `bytes` into the project's `folder` as `<stem><ext>`: the file there already when it has the
 * same bytes, else the next free `<stem>-2<ext>`… A file there is never overwritten, so an edit
 * undone in the editor still finds the file it had. Returns its project path (`folder/name`).
 */
export async function keepInProject(projectDir: string, bytes: Buffer, folder: string, stem: string, ext: string): Promise<string> {
  const dir = join(projectDir, folder);
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}${ext}`;
    const target = join(dir, name);
    const existing = await readFile(target).catch(() => undefined);
    if (existing?.equals(bytes)) return `${folder}/${name}`;
    if (existing) continue;
    await writeFile(target, bytes, { flag: 'wx' });
    return `${folder}/${name}`;
  }
}
