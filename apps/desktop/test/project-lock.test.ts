import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockedError, lockProject } from '../src/main/project';

describe('lockProject', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cuttle-lock-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const lockFile = () => join(dir, '.cuttle', 'editor.lock');
  const writeLock = (host: string) => {
    mkdirSync(join(dir, '.cuttle'), { recursive: true });
    writeFileSync(lockFile(), JSON.stringify({ host, pid: 1, opened: '2026-10-01T09:00:00.000Z' }));
  };

  it('marks the project open on this computer and removes its own lock on release', async () => {
    const release = await lockProject(dir);
    expect(JSON.parse(readFileSync(lockFile(), 'utf8'))).toMatchObject({ host: hostname(), pid: process.pid });
    await release();
    expect(existsSync(lockFile())).toBe(false);
  });

  it('takes over a lock this computer left behind and refuses one from another computer unless forced', async () => {
    // a crash or a power cut left it: only one Cuttle runs per user, so it is stale
    writeLock(hostname());
    await (await lockProject(dir))();
    writeLock('other-pc');
    await expect(lockProject(dir)).rejects.toThrow(LockedError);
    const release = await lockProject(dir, { force: true });
    // the other computer took it back meanwhile: the release leaves its lock alone
    writeLock('other-pc');
    await release();
    expect(JSON.parse(readFileSync(lockFile(), 'utf8')).host).toBe('other-pc');
  });
});
