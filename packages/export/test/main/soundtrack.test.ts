import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseProject } from '@cuttle/project';
import { mixTyping, sceneSpans, typingClicks } from '@cuttle/timeline';
import { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope, planSoundtrack, writeSoundTrack } from '../../src/main/soundtrack';
import type { MusicStems } from '../../src/main/music';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-soundtrack-'));
  dirs.push(dir);
  return dir;
};

function project(input: Record<string, unknown>) {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 0, to: 4 }], ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const NO_TAKE = { events: [], words: [], markers: [] };

describe('the music under speech', () => {
  it('goes down by the duck while someone speaks, from a moment before the words to a moment after', () => {
    const gain = duckEnvelope([{ start: 2, end: 3 }], 12);
    const low = 10 ** (-12 / 20);
    expect(gain(1)).toBe(1);
    expect(gain(2 - DUCK_ATTACK)).toBe(1);
    expect(gain(2 - DUCK_ATTACK / 2)).toBeCloseTo((1 + low) / 2, 6);
    expect(gain(2.5)).toBeCloseTo(low, 6);
    expect(gain(3 + DUCK_RELEASE / 2)).toBeCloseTo((1 + low) / 2, 6);
    expect(gain(3 + DUCK_RELEASE + 0.01)).toBe(1);
  });

  it('stays down between words close together, and stays up without a duck', () => {
    const gain = duckEnvelope([{ start: 1, end: 2 }, { start: 2.4, end: 3 }], 10);
    expect(gain(2.2)).toBeCloseTo(10 ** (-10 / 20), 6);
    expect(duckEnvelope([{ start: 1, end: 2 }], 0)(1.5)).toBe(1);
  });
});

describe('the soundtrack file', () => {
  it('mixes the music at its volume and duck, the effects at theirs and the typing in the middle, as float stereo', async () => {
    const rate = 48_000;
    const seconds = 12;
    const frames = seconds * rate;
    // music: a constant 0.5 on the left, 0.25 on the right; effects: 0.4 on both from 1 s to 1.1 s
    const music = new Float32Array(frames * 2);
    const effects = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      music[i * 2] = 0.5;
      music[i * 2 + 1] = 0.25;
      if (i >= rate && i < rate * 1.1) effects[i * 2] = effects[i * 2 + 1] = 0.4;
    }
    const stems = { rate, music, effects } as MusicStems;
    const p = project({ scenes: [{ type: 'clip', from: 0, to: seconds }] });
    const clicks = typingClicks(sceneSpans(p.scenes), [{ t: 11, type: 'keys', count: 2 }], p.look.audio);
    const path = join(temp(), 'sound.wav');
    await writeSoundTrack(path, { seconds, stems, music: { volume: 0.5, duck: 6 }, speech: [{ start: 5, end: 6 }], effectsVolume: 0.5, typing: { clicks, volume: 0.5 } });
    const bytes = readFileSync(path);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect([bytes.readUInt16LE(20), bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34)]).toEqual([3, 2, rate, 32]);
    expect(bytes.length).toBe(44 + frames * 8);
    const sample = (t: number, channel: 0 | 1) => bytes.readFloatLE(44 + (Math.round(t * rate) * 2 + channel) * 4);
    expect(sample(0.5, 0)).toBeCloseTo(0.25, 5);
    expect(sample(0.5, 1)).toBeCloseTo(0.125, 5);
    expect(sample(1.05, 0)).toBeCloseTo(0.25 + 0.2, 5);
    // under speech: 6 dB down
    expect(sample(5.5, 0)).toBeCloseTo(0.25 * 10 ** (-6 / 20), 3);
    // the typing clicks, the same in both ears on top of the music
    const typing = new Float32Array(frames);
    mixTyping(clicks, 0.5, typing, 0);
    let worst = 0;
    for (let i = 11 * rate; i < frames; i += 7) {
      worst = Math.max(worst, Math.abs(bytes.readFloatLE(44 + i * 8) - 0.25 - typing[i]!), Math.abs(bytes.readFloatLE(44 + i * 8 + 4) - 0.125 - typing[i]!));
    }
    expect(worst).toBeLessThan(1e-5);
    expect(typing.some((v) => Math.abs(v) > 0.01)).toBe(true);
  });
});

describe('the soundtrack\'s plan', () => {
  it('is none when the audio is off, or with neither music nor sounds', async () => {
    const dir = temp();
    expect(await planSoundtrack(dir, project({}), NO_TAKE)).toBeUndefined();
    expect(await planSoundtrack(dir, project({ sounds: [{ sound: 'pop', at: 1 }], look: { audio: { enabled: false } } }), NO_TAKE)).toBeUndefined();
    expect(await planSoundtrack(dir, project({ music: { src: 'music/a/index.html', enabled: false } }), NO_TAKE)).toBeUndefined();
    // effects off: the sounds go, music stays
    expect(await planSoundtrack(dir, project({ sounds: [{ sound: 'pop', at: 1 }], look: { audio: { effects: false } } }), NO_TAKE)).toBeUndefined();
  });

  it('takes the page\'s params with the project\'s over them, and the sounds\' files from the project only', async () => {
    const dir = temp();
    mkdirSync(join(dir, 'music', 'a'), { recursive: true });
    mkdirSync(join(dir, 'sounds'));
    writeFileSync(
      join(dir, 'music', 'a', 'index.html'),
      '<!doctype html><script type="application/json" id="cuttle-params">[{"name":"key","type":"text","default":"D"},{"name":"bpm","type":"number","default":0}]</script>',
    );
    writeFileSync(join(dir, 'sounds', 'ding.wav'), 'RIFF');
    const plan = await planSoundtrack(
      dir,
      project({
        music: { src: 'music/a/index.html', params: { bpm: 120 } },
        sounds: [
          { sound: 'pop', at: 1 },
          { sound: 'sounds/ding.wav', at: 2, volume: 0.5 },
          { sound: 'sounds/missing.wav', at: 3 },
          { sound: '../outside.wav', at: 3 },
        ],
      }),
      NO_TAKE,
    );
    expect(plan).toMatchObject({ page: join(dir, 'music', 'a', 'index.html'), params: { key: 'D', bpm: 120 }, network: false });
    expect(plan!.sounds).toEqual([
      { at: 1, sound: 'pop', volume: 0.8 },
      { at: 2, sound: 'sounds/ding.wav', volume: 0.5, url: 'cuttle-motion://project/sounds/ding.wav' },
    ]);
    expect(plan!.skipped).toEqual(['sounds/missing.wav: not a file in the project', '../outside.wav: not a file in the project']);
    expect(plan!.video.duration).toBe(4);
  });

  it('refuses a music page outside the project, and names one that is missing', async () => {
    const dir = temp();
    await expect(planSoundtrack(dir, project({ music: { src: '../x.html' } }), NO_TAKE)).rejects.toThrow(/outside the project/);
    await expect(planSoundtrack(dir, project({ music: { src: 'music/none/index.html' } }), NO_TAKE)).rejects.toThrow(/no music page at music\/none\/index.html/);
  });
});
