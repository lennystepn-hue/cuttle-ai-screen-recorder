import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectHash } from '@cuttle/core';
import { ProjectFileWatch } from '../src/main/project-watch';
import type { ProjectFileEvent } from '../src/shared/ipc';

const version = (label: string) => ({
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [{ type: 'clip', id: 's1', label, from: 0, to: 3 }],
});
const bytes = (raw: object) => `${JSON.stringify(raw, null, 2)}\n`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the project file watch', () => {
  let dir: string;
  let watch: ProjectFileWatch | undefined;
  afterEach(() => {
    watch?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports no save of its own, however fast they come, and reports a version it wrote before when it comes back', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cuttle-watch-'));
    const first = version('First');
    writeFileSync(join(dir, 'cuttle.json'), bytes(first));
    const events: ProjectFileEvent[] = [];
    watch = new ProjectFileWatch(dir, (event) => events.push(event));
    watch.start(projectHash(bytes(first)));
    // undo and redo pressed fast: each save lands about when the watcher looks at the one before
    let hash = projectHash(bytes(first));
    for (let n = 0; n < 30; n++) {
      const answer = await watch.save(version(n % 2 ? 'First' : 'Second'), hash);
      if (!('hash' in answer)) throw new Error(JSON.stringify(answer));
      hash = answer.hash;
      await pause(140 + (n % 5) * 5);
    }
    await pause(400);
    expect(events).toEqual([]);
    // the file is 'First' now (30 saves); a revert from outside to 'Second', which this window wrote, is news
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Second')));
    await expect.poll(() => events.length, { timeout: 3000 }).toBe(1);
    expect(events[0]).toMatchObject({ hash: projectHash(bytes(version('Second'))), origin: 'outside' });
  }, 20_000);

  it('reports a change already on disk with its own origin when asked to look before the next is set', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cuttle-watch-'));
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Take')));
    const events: ProjectFileEvent[] = [];
    watch = new ProjectFileWatch(dir, (event) => events.push(event));
    watch.start(projectHash(bytes(version('Take'))));
    // the app's cut writes, and its privacy step follows within the watcher's pause
    watch.origin = 'suggest';
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Cut')));
    await watch.settle();
    watch.origin = 'privacy';
    expect(events).toEqual([expect.objectContaining({ hash: projectHash(bytes(version('Cut'))), origin: 'suggest' })]);
    // the watcher's own look comes later and finds nothing new; the privacy masks are the next change
    await pause(400);
    expect(events).toHaveLength(1);
    writeFileSync(join(dir, 'cuttle.json'), bytes(version('Masked')));
    await expect.poll(() => events.length, { timeout: 3000 }).toBe(2);
    expect(events[1]).toMatchObject({ origin: 'privacy' });
  });
});
