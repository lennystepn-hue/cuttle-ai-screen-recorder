import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { mixTyping, sceneSpans, typingClicks } from '@cuttle/timeline';
import { writeTypingTrack } from '../../src/main/typing-track';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('the typing track', () => {
  it('writes the clicks as a 16-bit mono WAV at 48 kHz, as long as the video, block by block as all at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-'));
    dirs.push(dir);
    const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', from: 0, to: 25 }] });
    if (!parsed.ok) throw new Error('invalid');
    // presses in the first and the third 10 s block, and across the first block's end
    const events = [{ t: 1, type: 'keys' as const, count: 3 }, { t: 9.5, type: 'keys' as const, count: 4 }, { t: 21, type: 'keys' as const, count: 2 }];
    const clicks = typingClicks(sceneSpans(parsed.project.scenes), events, parsed.project.look.audio);
    const path = join(dir, 'typing.wav');
    await writeTypingTrack(path, clicks, 0.5, 25);
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect([bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34)]).toEqual([1, 48_000, 16]);
    expect(bytes.readUInt32LE(40)).toBe(25 * 48_000 * 2);
    expect(bytes.length).toBe(44 + 25 * 48_000 * 2);
    const whole = new Float32Array(25 * 48_000);
    mixTyping(clicks, 0.5, whole, 0);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(bytes.readInt16LE(44 + i * 2) / 32767 - whole[i]!));
    expect(worst).toBeLessThan(1e-4);
  });
});
