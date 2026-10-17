import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { newProjectFile, readProjectFile, writeProjectFile } from '../src/project-file';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-core-'));
  dirs.push(dir);
  return dir;
};

/** The error `promise` rejects with. */
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

describe('writeProjectFile', () => {
  it('writes 2-space JSON and keeps working on the file it wrote', async () => {
    const dir = temp();
    const file = await writeProjectFile(newProjectFile(dir), 'init');
    expect(readFileSync(file.path, 'utf8')).toBe('{\n  "version": 1,\n  "sources": {\n    "screen": "takes/1/screen.mp4"\n  }\n}\n');
    file.raw.texts = [{ id: 't1', label: 'Hook', at: 1, duration: 2, text: 'Hi' }];
    await writeProjectFile(file, 'edit');
    expect(file.project.texts[0]).toMatchObject({ id: 't1', label: 'Hook' });
    const read = await readProjectFile(dir);
    expect(read.hash).toBe(file.hash);
    expect(read.raw).toEqual(file.raw);
  });

  it('refuses to overwrite what another program saved since the file was read', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    const file = await readProjectFile(dir);
    const theirs = '{ "version": 1, "sources": { "screen": "takes/2/screen.mp4" } }\n';
    writeFileSync(file.path, theirs);
    file.raw.zooms = [];
    const error = await failure(writeProjectFile(file, 'suggest'));
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'conflict', message: `${file.path} changed while suggest ran; nothing was written, run it again` });
    expect(readFileSync(file.path, 'utf8')).toBe(theirs);
    expect(readdirSync(dir)).toEqual(['cuttle.json']);
  });

  it('refuses a new project when the file appeared meanwhile, and a file that was deleted', async () => {
    const dir = temp();
    const fresh = newProjectFile(dir);
    writeFileSync(fresh.path, '{}');
    expect(await failure(writeProjectFile(fresh, 'init'))).toMatchObject({ code: 'conflict' });

    const other = temp();
    await writeProjectFile(newProjectFile(other), 'init');
    const file = await readProjectFile(other);
    rmSync(file.path);
    expect(await failure(writeProjectFile(file, 'recover'))).toMatchObject({ code: 'conflict' });
    expect(existsSync(file.path)).toBe(false);
  });
});
