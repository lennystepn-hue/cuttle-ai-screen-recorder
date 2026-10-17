import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSegmentsJson } from '@cuttle/project';
import { recoverTake } from '../src/recover';
import { runFfmpeg } from '../src/ffmpeg';
import { streamSeconds } from '../src/suggest/media';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];
const video = (file: string, seconds: number) => runFfmpeg(['-f', 'lavfi', '-i', `testsrc2=s=320x240:r=30:d=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...FRAGMENTED, '-y', file]);
const audio = (file: string, seconds: number) => runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`, '-c:a', 'aac', ...FRAGMENTED, '-y', file]);

describe('recoverTake', () => {
  it('joins a paused take the recorder never joined (it ended during the take), the last segment measured', async () => {
    const project = mkdtempSync(join(tmpdir(), 'cuttle-recover-'));
    dirs.push(project);
    const take = join(project, 'takes', '1');
    mkdirSync(take, { recursive: true });
    await Promise.all([video(join(take, 'screen.1.mp4'), 2), audio(join(take, 'mic.1.m4a'), 2), video(join(take, 'screen.2.mp4'), 1.5), audio(join(take, 'mic.2.m4a'), 1.4)]);
    // as the recorder left it: the second segment still recording (no length), take.json naming the joined file to be
    writeFileSync(
      join(take, 'segments.json'),
      JSON.stringify({
        version: 1,
        segments: [
          { screen: { file: 'screen.1.mp4', start: 1000 }, mic: { file: 'mic.1.m4a', start: 1000 }, duration: 2 },
          { screen: { file: 'screen.2.mp4', start: 1010 }, mic: { file: 'mic.2.m4a', start: 1010.1 } },
        ],
      }),
    );
    writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 1000 }, mic: { file: 'mic.m4a', start: 1000 } } }));
    writeFileSync(join(take, 'events.jsonl'), '');
    writeFileSync(join(take, 'markers.json'), JSON.stringify({ version: 1, markers: [] }));

    const result = await recoverTake(project, 'takes/1');
    expect(result.repaired).toContain('joined the 2 segments of the paused take');
    expect(result.seconds).toBeCloseTo(3.5, 1);
    expect(result.tracks).toEqual(['screen', 'mic']);
    expect(await streamSeconds(join(take, 'mic.m4a'), 'a')).toBeCloseTo(3.5, 1);
    const manifest = parseSegmentsJson(readFileSync(join(take, 'segments.json'), 'utf8'));
    expect(manifest.ok && manifest.segments.joined).toBe(true);
    expect(manifest.ok && manifest.segments.segments[1]!.duration).toBeCloseTo(1.5, 1);
    expect(readdirSync(take).filter((name) => /\.\d\./.test(name))).toEqual([]);
    expect(JSON.parse(readFileSync(join(project, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
    // a second recover finds it joined: nothing to join again
    expect((await recoverTake(project, 'takes/1')).repaired).not.toContain('joined the 2 segments of the paused take');
    expect(existsSync(join(take, 'screen.mp4'))).toBe(true);
  }, 60_000);
});
