import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Segment } from '@cuttle/project';
import { VIDEO_CODEC } from '../src/args';
import { concatList, joinSegments, mediaInfo, runFfmpeg } from '../src/join';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-join-'));
  dirs.push(dir);
  return dir;
};

const FRAME = 1 / 30;
const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];

/** A screen segment like the recorder's: black, with one white frame at `flash` seconds. */
const screen = (file: string, seconds: number, flash: number, size = '320x240') =>
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${seconds},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n\\,${Math.round(flash * 30)})'`,
    '-vf', 'format=yuv420p', ...VIDEO_CODEC, ...FRAGMENTED, '-y', file,
  ]);
/** A mic segment: silence with a 50 ms beep at `beep` seconds of the file. */
const mic = (file: string, seconds: number, beep: number) =>
  runFfmpeg(['-f', 'lavfi', '-i', `aevalsrc='0.8*sin(2*PI*1000*t)*between(t\\,${beep}\\,${beep + 0.05})':s=48000:d=${seconds}`, '-c:a', 'aac', '-b:a', '160k', ...FRAGMENTED, '-y', file]);

/** Seconds of the white frames in a video. */
async function flashes(file: string): Promise<number[]> {
  const out = await runFfmpeg(['-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']);
  const times: number[] = [];
  let at: number | undefined;
  for (const line of out.split('\n')) {
    const time = /pts_time:(\d+(?:\.\d+)?)/.exec(line);
    if (time) at = Number(time[1]);
    const avg = /lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/.exec(line);
    if (avg && Number(avg[1]) > 128 && at !== undefined) times.push(at);
  }
  return times;
}

/** Seconds where a beep starts in an audio file (silencedetect also ends the last silence at the end of the file). */
async function beeps(file: string): Promise<number[]> {
  const out = await runFfmpeg(['-i', file, '-af', 'silencedetect=n=-30dB:d=0.02', '-f', 'null', '-']);
  const end = (await mediaInfo(file, 'a')).seconds;
  return [...out.matchAll(/silence_end: (\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter((t) => t < end - 0.05);
}

describe('joining a paused take', () => {
  it('keeps the mic in sync with the screen across pauses, within a frame, wherever each segment started', async () => {
    const dir = temp();
    // Three segments; the mic starts 0.2 s after, 0.1 s before and 0.05 s after its screen segment.
    // The beep and the flash happen at the same wall-clock moment in each.
    await Promise.all([
      screen(join(dir, 'screen.1.mp4'), 3, 1),
      mic(join(dir, 'mic.1.m4a'), 3.2, 0.8),
      screen(join(dir, 'screen.2.mp4'), 2, 0.5),
      mic(join(dir, 'mic.2.m4a'), 2.3, 0.6),
      screen(join(dir, 'screen.3.mp4'), 2.5, 2),
      mic(join(dir, 'mic.3.m4a'), 2.6, 1.95),
    ]);
    const segments: Segment[] = [
      { screen: { file: 'screen.1.mp4', start: 1000 }, mic: { file: 'mic.1.m4a', start: 1000.2 }, duration: 3 },
      { screen: { file: 'screen.2.mp4', start: 1010 }, mic: { file: 'mic.2.m4a', start: 1009.9 }, duration: 2 },
      { screen: { file: 'screen.3.mp4', start: 1020 }, mic: { file: 'mic.3.m4a', start: 1020.05 }, duration: 2.5 },
    ];
    const joined = await joinSegments(dir, segments, { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a' });
    expect(joined).toEqual({ webcam: false, mic: true });

    // the screen is copied end to end: 3 + 2 + 2.5 s, its flashes where each segment put them
    expect((await mediaInfo(join(dir, 'screen.mp4'), 'v')).seconds).toBeCloseTo(7.5, 1);
    const seen = await flashes(join(dir, 'screen.mp4'));
    expect(seen.map((t) => Math.round(t * 1000) / 1000)).toEqual([1, 3.5, 7]);
    // the mic is as long, and each beep sounds within a frame of its flash
    expect((await mediaInfo(join(dir, 'mic.m4a'), 'a')).seconds).toBeCloseTo(7.5, 1);
    const heard = await beeps(join(dir, 'mic.m4a'));
    expect(heard).toHaveLength(3);
    heard.forEach((t, i) => expect(Math.abs(t - seen[i]!)).toBeLessThan(FRAME));
  }, 60_000);

  it('re-encodes the screen to the first size when a segment has another, and fills a missing mic with silence', async () => {
    const dir = temp();
    await Promise.all([screen(join(dir, 'a.mp4'), 1, 0.5), screen(join(dir, 'b.mp4'), 1, 0.5, '640x360'), mic(join(dir, 'm.m4a'), 1, 0.2)]);
    const segments: Segment[] = [
      { screen: { file: 'a.mp4', start: 0 }, mic: { file: 'm.m4a', start: 0 }, duration: 1 },
      { screen: { file: 'b.mp4', start: 5 }, duration: 1 },
    ];
    await joinSegments(dir, segments, { screen: 'screen.mp4', webcam: 'webcam.mp4', mic: 'mic.m4a' });
    expect(await mediaInfo(join(dir, 'screen.mp4'), 'v')).toEqual({ seconds: expect.closeTo(2, 1), width: 320, height: 240 });
    expect((await mediaInfo(join(dir, 'mic.m4a'), 'a')).seconds).toBeCloseTo(2, 1);
    expect(await beeps(join(dir, 'mic.m4a'))).toHaveLength(1);
  }, 60_000);

  it('writes a concat list that survives quotes and backslashes in paths', () => {
    expect(concatList(["C:\\takes\\it's\\screen.1.mp4", '/x/screen.2.mp4'])).toBe("file 'C:/takes/it'\\''s/screen.1.mp4'\nfile '/x/screen.2.mp4'\n");
  });
});
