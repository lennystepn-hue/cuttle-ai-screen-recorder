import { describe, expect, it } from 'vitest';
import { freezeEnd, freezeStart, micArgs, screenArgs, silenceStart, webcamArgs } from '../src/args';

const input = ['-f', 'lavfi', '-i', 'testsrc2'];
const BT709 = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';

describe('ffmpeg arguments', () => {
  it('stamps every input with the wall clock and writes fragmented MP4 that survives a kill', () => {
    for (const args of [screenArgs(input, 'screen.mp4'), webcamArgs(input, 'webcam.mp4'), micArgs(input, 'mic.m4a')]) {
      expect(args.slice(0, 2)).toEqual(['-use_wallclock_as_timestamps', '1']);
      expect(args.join(' ')).toContain('-movflags +frag_keyframe+empty_moov+default_base_moof -flush_packets 1 -f mp4');
    }
  });

  it('encodes video as tagged BT.709 with a key frame every 2 s', () => {
    const args = screenArgs(input, 'screen.mp4');
    expect(args).toContain(`[0:v]${BT709}[out]`);
    expect(args.join(' ')).toContain('-force_key_frames expr:gte(t,n_forced*2)');
    expect(args.join(' ')).toContain('-color_trc bt709');
    expect(args.slice(-2)).toEqual(['-y', 'screen.mp4']);
  });

  it('puts a prefilter before everything else (macOS crops there)', () => {
    expect(screenArgs(input, 'screen.mp4', undefined, 'crop=800:500:40:92')).toContain(`[0:v]crop=800:500:40:92,${BT709}[out]`);
    expect(screenArgs(input, 'screen.mp4', 4, 'crop=800:500:40:92')).toContain(
      `[0:v]crop=800:500:40:92,split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=-60dB:d=4,nullsink;[rec]${BT709}[out]`,
    );
  });

  it('adds a freezedetect branch only for untilIdleSeconds', () => {
    expect(screenArgs(input, 'screen.mp4').join(' ')).not.toContain('freezedetect');
    expect(screenArgs(input, 'screen.mp4', 4)).toContain(
      `[0:v]split[rec][idle];[idle]scale=320:-2,format=gray,freezedetect=n=-60dB:d=4,nullsink;[rec]${BT709}[out]`,
    );
  });

  it("keeps the device's own timestamps when asked (macOS's capture times)", () => {
    expect(micArgs(input, 'mic.m4a', false)).not.toContain('-use_wallclock_as_timestamps');
    expect(webcamArgs(input, 'webcam.mp4', false)).not.toContain('-use_wallclock_as_timestamps');
    expect(micArgs(input, 'mic.m4a').slice(0, 2)).toEqual(['-use_wallclock_as_timestamps', '1']);
  });

  it('cuts the mic into 1 s fragments and watches it for digital silence', () => {
    const args = micArgs(input, 'mic.m4a').join(' ');
    expect(args).toContain('silencedetect=n=-80dB:d=1');
    expect(args).toContain('-c:a aac -b:a 160k -frag_duration 1000000');
  });

  it('writes the mic as 16 kHz mono samples to stdout too, for its level, after the track', () => {
    const args = micArgs(input, 'mic.m4a');
    expect(args.join(' ')).toContain('[pcm]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[raw]');
    expect(args.slice(args.indexOf('mic.m4a'))).toEqual(['mic.m4a', '-map', '[raw]', '-f', 's16le', '-flush_packets', '1', 'pipe:1']);
  });

  it('reads freezedetect and silencedetect log lines', () => {
    expect(freezeStart('[Parsed_freezedetect_3 @ 00000132707ccd00] lavfi.freezedetect.freeze_start: 0.973633')).toBe(0.973633);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_start: 0')).toBe(0);
    expect(freezeStart('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_end: 2.5')).toBeUndefined();
    expect(freezeEnd('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_end: 2.5')).toBe(2.5);
    expect(freezeEnd('[Parsed_freezedetect_3 @ 0000] lavfi.freezedetect.freeze_duration: 1.5')).toBeUndefined();
    expect(silenceStart('[Parsed_silencedetect_1 @ 000001d796c83380] silence_start: 0.0180833')).toBe(0.0180833);
    expect(silenceStart('[Parsed_silencedetect_1 @ 0000] silence_end: 3.032 | silence_duration: 3.01')).toBeUndefined();
  });
});
