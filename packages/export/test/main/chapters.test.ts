import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chapterMetadata } from '../../src/chapters';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-chapters-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const chapters = [
  { at: 0, end: 12.5, title: 'Open the settings', step: 'step1' },
  { at: 12.5, end: 30, title: 'Size = 2; #1 \\ more', step: 'step2' },
];

describe('chapterMetadata', () => {
  it('writes each chapter in milliseconds, its title escaped', () => {
    expect(chapterMetadata(chapters)).toBe(
      [';FFMETADATA1', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=12500', 'title=Open the settings', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=12500', 'END=30000', 'title=Size \\= 2\\; \\#1 \\\\ more', ''].join('\n'),
    );
  });

  it('is what ffmpeg puts into an MP4 as its chapters', () => {
    const meta = join(dir, 'chapters.txt');
    const out = join(dir, 'video.mp4');
    writeFileSync(meta, chapterMetadata(chapters));
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=10:d=30', '-i', meta, '-map', '0:v:0', '-map_chapters', '1', '-c:v', 'libx264', '-preset', 'ultrafast', out], { encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' });
    const read = (JSON.parse(probe.stdout) as { chapters: { start_time: string; end_time: string; tags: { title: string } }[] }).chapters;
    expect(read.map((chapter) => [Number(chapter.start_time), Number(chapter.end_time), chapter.tags.title])).toEqual([
      [0, 12.5, 'Open the settings'],
      [12.5, 30, 'Size = 2; #1 \\ more'],
    ]);
  });
});
