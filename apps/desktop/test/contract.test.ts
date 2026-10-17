import { describe, expect, it } from 'vitest';
import { WINDOW_CHANNELS } from '../src/shared/channels';
import { REQUESTS } from '../src/shared/ipc';
import { MAX_THUMBS, PeakFolder, PEAKS_RATE, PEAKS_SAMPLE_RATE, progressOf, proxyArgs, thumbnailsArgs, thumbnailsMeta } from '../src/shared/media-jobs';

describe('the IPC contract', () => {
  it('gives every request to exactly one kind of window', () => {
    const owners = Object.keys(REQUESTS).map((channel) =>
      Object.entries(WINDOW_CHANNELS)
        .filter(([, channels]) => (channels.requests as readonly string[]).includes(channel))
        .map(([kind]) => kind),
    );
    expect(owners.every((kinds) => kinds.length === 1)).toBe(true);
  });

  it('checks what a window sends', () => {
    expect(REQUESTS['export:start'].safeParse({ formats: ['16:9', '9:16'], encoder: 'auto' }).success).toBe(true);
    expect(REQUESTS['export:start'].safeParse({ formats: [], encoder: 'auto' }).success).toBe(false);
    expect(REQUESTS['export:start'].safeParse({ formats: ['4:3'], encoder: 'auto' }).success).toBe(false);
    expect(REQUESTS['export:start'].safeParse({ formats: ['16:9'], encoder: 'auto', out: 'C:\\Windows' }).success).toBe(false);
    expect(REQUESTS['pill:open'].safeParse({ dir: 'C:\\demo' }).success).toBe(true);
    expect(REQUESTS['pill:open'].safeParse({ dir: '' }).success).toBe(false);
    expect(REQUESTS['project:info'].safeParse({ any: 1 }).success).toBe(false);
  });
});

describe('the media jobs', () => {
  it('makes a 720p proxy with the take timestamps and a key frame every half second', () => {
    const args = proxyArgs('in.mp4', 'out.mp4');
    expect(args).toContain('-copyts');
    expect(args.join(' ')).toContain("scale=-2:'min(720,ih)'");
    expect(args.join(' ')).toContain('-force_key_frames expr:gte(t,n_forced*0.5)');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('takes a thumbnail every second, fewer for long takes, tiled 20 wide', () => {
    expect(thumbnailsMeta(12.3)).toEqual({ interval: 1, width: 160, height: 90, count: 13, columns: 13 });
    const long = thumbnailsMeta(1800);
    expect(long.interval).toBe(3);
    expect(long.count).toBeLessThanOrEqual(MAX_THUMBS);
    expect(long.columns).toBe(20);
    expect(thumbnailsArgs('in.mp4', 'out.jpg', long).join(' ')).toContain('tile=20x30');
  });

  it('folds 16-bit samples into peaks, also when a chunk splits a sample', () => {
    const window = PEAKS_SAMPLE_RATE / PEAKS_RATE;
    const samples = new Int16Array(window * 2 + 10);
    samples[5] = 16384; // half scale in the first window
    samples[window + 3] = -32768; // full scale in the second
    samples[window * 2 + 1] = 3277; // a tenth in the short last one
    const bytes = new Uint8Array(samples.buffer);
    const folder = new PeakFolder();
    folder.push(bytes.subarray(0, 11)); // ends in the middle of a sample
    folder.push(bytes.subarray(11));
    expect([...folder.finish()]).toEqual([128, 255, 26]);
  });

  it("reads ffmpeg's progress", () => {
    expect(progressOf('out_time_us=2500000', 10)).toBe(0.25);
    expect(progressOf('out_time_us=20000000', 10)).toBe(1);
    expect(progressOf('progress=continue', 10)).toBeUndefined();
    expect(progressOf('out_time_us=1', 0)).toBeUndefined();
  });
});
