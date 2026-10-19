import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { PROJECT_GITIGNORE, newProjectFile, projectHash, readProjectFile, writeProjectFile } from '../src/project-file';

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
  it('writes 2-space JSON and returns the file as written, leaving its argument alone', async () => {
    const dir = temp();
    const fresh = newProjectFile(dir);
    const { file } = await writeProjectFile(fresh, 'init');
    expect(readFileSync(file.path, 'utf8')).toBe('{\n  "version": 1,\n  "sources": {\n    "screen": "takes/1/screen.mp4"\n  }\n}\n');
    expect(fresh.hash).toBeUndefined();
    expect(file.hash).toBe(projectHash(readFileSync(file.path)));
    file.raw.texts = [{ id: 't1', label: 'Hook', at: 1, duration: 2, text: 'Hi' }];
    const { file: second } = await writeProjectFile(file, 'edit');
    expect(second.project.texts[0]).toMatchObject({ id: 't1', label: 'Hook' });
    const read = await readProjectFile(dir);
    expect(read.hash).toBe(second.hash);
    expect(read.raw).toEqual(second.raw);
  });

  it("gives a new project a .gitignore for its takes and the editor's copies, and leaves one that is there", async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(PROJECT_GITIGNORE);
    expect(PROJECT_GITIGNORE.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual(['takes/', '.cuttle/']);
    // the person's own
    const own = temp();
    writeFileSync(join(own, '.gitignore'), 'node_modules/\n');
    await writeProjectFile(newProjectFile(own), 'init');
    expect(readFileSync(join(own, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    // an existing project gets none (the person may have removed it)
    rmSync(join(dir, '.gitignore'));
    await writeProjectFile(await readProjectFile(dir), 'edit');
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });

  it('refuses to overwrite what another program saved since the file was read', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    const file = await readProjectFile(dir);
    const theirs = '{ "version": 1, "sources": { "screen": "takes/2/screen.mp4" } }\n';
    writeFileSync(file.path, theirs);
    file.raw.zooms = [];
    const error = await failure(writeProjectFile(file, 'suggest', { backup: true }));
    expect(error).toBeInstanceOf(CoreError);
    expect(error).toMatchObject({ code: 'conflict', path: file.path, message: `${file.path} changed while suggest ran, so it was left as it is; run suggest again` });
    expect(readFileSync(file.path, 'utf8')).toBe(theirs);
    // the check comes first: no backup was made and nothing else was left behind (the .gitignore came with the project)
    expect(readdirSync(dir)).toEqual(['.gitignore', 'cuttle.json']);
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

  it('keeps the file on disk as a backup once the check has passed', async () => {
    const dir = temp();
    await writeProjectFile(newProjectFile(dir), 'init');
    const file = await readProjectFile(dir);
    const before = readFileSync(file.path, 'utf8');
    file.raw.texts = [{ at: 0, duration: 1, text: 'Hi' }];
    const { backup } = await writeProjectFile(file, 'edit', { backup: true });
    expect(backup).toBe(`${file.path}.bak`);
    expect(readFileSync(backup!, 'utf8')).toBe(before);
  });

  it('lets only the first of two writes from one read through, in one process', async () => {
    for (let round = 0; round < 10; round++) {
      const dir = temp();
      await writeProjectFile(newProjectFile(dir), 'init');
      const [a, b] = [await readProjectFile(dir), await readProjectFile(dir)];
      a.raw.texts = [{ at: 0, duration: 1, text: 'a' }];
      b.raw.texts = [{ at: 0, duration: 1, text: 'b' }];
      const results = await Promise.allSettled([writeProjectFile(a, 'autosave'), writeProjectFile(b, 'suggest')]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
      expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).texts[0].text).toBe('a');
      expect(readdirSync(dir)).toEqual(['.gitignore', 'cuttle.json']);
    }
  });
});
