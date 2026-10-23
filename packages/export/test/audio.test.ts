import { parseProject, type CuttleProject, type CuttleProjectInput } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { atempoChain, audioFilterGraph, encodeArgs, mixArgs, muxArgs, planAudio } from '../src/audio';

function project(input: Omit<CuttleProjectInput, 'version' | 'sources'>): CuttleProject {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, ...input });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.project;
}

const scenes: CuttleProjectInput['scenes'] = [
  { type: 'clip', from: 1, to: 3 },
  { type: 'clip', from: 4, to: 12, speed: 4 },
  { type: 'still', image: 'p.png', duration: 1 },
  { type: 'clip', from: 0.5, to: 1.5 },
];

function plan(input: Omit<CuttleProjectInput, 'version' | 'sources'>, seconds = 6, mic = true) {
  const p = project(input);
  return planAudio({ spans: sceneSpans(p.scenes), look: p.look, mic, seconds });
}

describe('planAudio', () => {
  it('cuts one segment per scene on the video boundaries, together exactly as long as the video', () => {
    const segments = plan({ scenes }, 6.02);
    expect(segments.map((s) => s.samples)).toEqual([96_000, 96_000, 48_000, 48_960]);
    expect(segments.reduce((sum, s) => sum + s.samples, 0)).toBe(Math.round(6.02 * 48_000));
  });

  it('plays the mic for clips, mutes sped-up clips and keeps stills silent', () => {
    const segments = plan({ scenes });
    expect(segments.map((s) => s.mic)).toEqual([
      { from: 48_000, to: 144_000, speed: 1, content: 96_000 },
      undefined,
      undefined,
      { from: 24_000, to: 72_000, speed: 1, content: 48_000 },
    ]);
    const loud = plan({ scenes, look: { audio: { muteSpedUp: false } } });
    expect(loud[1]!.mic).toEqual({ from: 192_000, to: 576_000, speed: 4, content: 96_000 });
  });

  it("plays the clips' stretches for the computer's sound alone, without a mic", () => {
    const p = project({ scenes });
    const segments = planAudio({ spans: sceneSpans(p.scenes), look: p.look, mic: false, system: true, seconds: 6 });
    expect(segments.map((s) => s.mic?.from)).toEqual([48_000, undefined, undefined, 24_000]);
  });

  it('is silent without a mic or with audio switched off', () => {
    expect(plan({ scenes }, 6, false).every((s) => s.mic === undefined)).toBe(true);
    expect(plan({ scenes, look: { audio: { enabled: false } } }).every((s) => s.mic === undefined)).toBe(true);
  });

  it('knows how much of each segment the mic fills; the rest is padding up to the frame grid', () => {
    const segments = plan({ scenes }, 6.02);
    expect(segments.map((s) => s.mic?.content)).toEqual([96_000, undefined, undefined, 48_000]);
    expect(segments[3]!.samples).toBe(48_960);
  });

  it('fades over half the crossfade at cuts and 10 ms at the very start and end', () => {
    const segments = plan({ scenes });
    expect(segments[0]).toMatchObject({ fadeIn: 480, fadeOut: 7_200 });
    expect(segments[3]).toMatchObject({ fadeIn: 7_200, fadeOut: 480 });
    const hard = plan({ scenes, look: { transition: { enabled: false } } });
    expect(hard.every((s) => s.fadeIn === 480 && s.fadeOut === 480)).toBe(true);
  });

  it('plays clips joined by continuous cuts at one speed as one segment, without a fade between them', () => {
    // one piece of footage: 1–3, 3–5, then 5–13 at 4×
    const continuous = [
      { type: 'clip', from: 1, to: 3 },
      { type: 'clip', from: 3, to: 5 },
      { type: 'clip', from: 5, to: 13, speed: 4 },
    ] as const;
    const segments = plan({ scenes: [...continuous] });
    expect(segments).toEqual([
      { samples: 192_000, mic: { from: 48_000, to: 240_000, speed: 1, content: 192_000 }, fadeIn: 480, fadeOut: 480 },
      { samples: 96_000, fadeIn: 480, fadeOut: 480 },
    ]);
    // where the sped-up clip is heard too, its speed changes there: 10 ms against a click
    const loud = plan({ scenes: [...continuous], look: { audio: { muteSpedUp: false } } });
    expect(loud.map((s) => [s.mic?.speed, s.fadeIn, s.fadeOut])).toEqual([[1, 480, 480], [4, 480, 480]]);
  });
});

describe('atempoChain', () => {
  it('uses one filter from 0.5 to 100 and chains slower speeds', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(12)).toEqual(['atempo=12']);
    expect(atempoChain(0.2)).toEqual(['atempo=0.5', 'atempo=0.5', 'atempo=0.8']);
  });
});

describe('audioFilterGraph', () => {
  it('shifts the mic once, splits it per clip and concatenates the segments into stereo', () => {
    const graph = audioFilterGraph(plan({ scenes }), { mic: { input: 1, offset: 0.5 } });
    expect(graph.split(';')).toEqual([
      '[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=delays=24000S:all=1,asplit=2[m0][m1]',
      '[m0]atrim=start_sample=48000:end_sample=144000,asetpts=N/SR/TB,apad,atrim=end_sample=96000,asetpts=N/SR/TB,afade=t=in:ss=0:ns=480,afade=t=out:ss=88800:ns=7200[s0]',
      'anullsrc=r=48000:cl=mono,atrim=end_sample=96000[s1]',
      'anullsrc=r=48000:cl=mono,atrim=end_sample=48000[s2]',
      '[m1]atrim=start_sample=24000:end_sample=72000,asetpts=N/SR/TB,apad,atrim=end_sample=48000,asetpts=N/SR/TB,afade=t=in:ss=0:ns=7200,afade=t=out:ss=47520:ns=480[s3]',
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]',
    ]);
  });

  it('ends the fade-out where the mic ends, not in the padding after it', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6.02), { mic: { input: 1, offset: 0 } });
    expect(graph).toContain('atrim=end_sample=48960,asetpts=N/SR/TB,afade=t=in:ss=0:ns=7200,afade=t=out:ss=47520:ns=480[s3]');
  });

  it('feeds atempo silence past a sped-up clip, because it returns fewer samples, then cuts to the clip', () => {
    const graph = audioFilterGraph(plan({ scenes, look: { audio: { muteSpedUp: false } } }), { mic: { input: 1, offset: 0 } });
    expect(graph).toContain(
      '[m1]atrim=start_sample=192000:end_sample=576000,asetpts=N/SR/TB,apad=pad_len=200000,atempo=4,atrim=end_sample=96000,asetpts=N/SR/TB,apad,',
    );
  });

  it('drops the start of a mic that started before the screen', () => {
    expect(audioFilterGraph(plan({ scenes }), { mic: { input: 1, offset: -0.25 } })).toContain('channel_layouts=mono,atrim=start_sample=12000,asetpts=N/SR/TB,asplit=2');
  });

  it('mixes the typing sounds in as they are, as long as the video', () => {
    const parts = audioFilterGraph(plan({ scenes }), { mic: { input: 1, offset: 0.5 }, typing: 2 }).split(';');
    expect(parts.slice(-3)).toEqual([
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1[base]',
      '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,apad,atrim=end_sample=288000,asetpts=N/SR/TB[keys]',
      '[base][keys]amix=inputs=2:duration=first:normalize=0,pan=stereo|c0=c0|c1=c0[aout]',
    ]);
  });

  it('mixes a soundtrack in stereo under the mic, then keeps the sum below full scale', () => {
    const parts = audioFilterGraph(plan({ scenes }), { mic: { input: 1, offset: 0.5 }, sound: 2 }).split(';');
    expect(parts.slice(-3)).toEqual([
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]',
      '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=288000,asetpts=N/SR/TB[sound]',
      '[voice][sound]amix=inputs=2:duration=first:normalize=0,aresample=192000,alimiter=limit=0.89:attack=1:release=60:level=false,aresample=48000[aout]',
    ]);
  });

  it("mixes the computer's sound in stereo with the mic and the typing, at its volume and duck, then limits the sum", () => {
    const parts = audioFilterGraph(plan({ scenes }), { mic: { input: 1, offset: 0.5 }, system: { input: 2, offset: -0.1, volume: 0.8, duck: 'D' }, typing: 3 }).split(';');
    // shifted on its own (it started 0.1 s before the screen), cut like the mic
    expect(parts).toContain('[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start_sample=4800,asetpts=N/SR/TB,asplit=2[y0][y1]');
    expect(parts).toContain('[y0]atrim=start_sample=48000:end_sample=144000,asetpts=N/SR/TB,apad,atrim=end_sample=96000,asetpts=N/SR/TB,afade=t=in:ss=0:ns=480,afade=t=out:ss=88800:ns=7200[z0]');
    expect(parts).toContain('anullsrc=r=48000:cl=stereo,atrim=end_sample=96000[z1]');
    expect(parts.slice(-4)).toEqual([
      '[s0][s1][s2][s3]concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[voice]',
      "[z0][z1][z2][z3]concat=n=4:v=0:a=1,volume=0.8,volume=eval=frame:volume='D'[system]",
      '[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,apad,atrim=end_sample=288000,asetpts=N/SR/TB,pan=stereo|c0=c0|c1=c0[keys]',
      '[voice][system][keys]amix=inputs=3:duration=first:normalize=0,aresample=192000,alimiter=limit=0.89:attack=1:release=60:level=false,aresample=48000[aout]',
    ]);
  });

  it("plays the computer's sound without a mic: the voice is silence", () => {
    const p = project({ scenes });
    const segments = planAudio({ spans: sceneSpans(p.scenes), look: p.look, mic: false, system: true, seconds: 6 });
    const graph = audioFilterGraph(segments, { system: { input: 1, offset: 0, volume: 1 } });
    expect(graph).not.toContain('[m0]');
    expect(graph).toContain('anullsrc=r=48000:cl=mono,atrim=end_sample=96000[s0]');
    expect(graph).toContain('[z0][z1][z2][z3]concat=n=4:v=0:a=1,volume=1[system]');
  });

  it('needs no mic input when every segment is silent', () => {
    const graph = audioFilterGraph(plan({ scenes }, 6, false), { mic: { input: 1, offset: 0 } });
    expect(graph).not.toContain('[1:a]');
    expect(graph.endsWith('concat=n=4:v=0:a=1,pan=stereo|c0=c0|c1=c0[aout]')).toBe(true);
  });
});

describe('mixArgs', () => {
  it('mixes the sound inputs into one WAV of floats, a picture of nothing standing in for the video', () => {
    const args = mixArgs({ mic: 'm.m4a', graph: 'G', out: 'mix.wav' });
    expect(args.join(' ')).toBe('-hide_banner -nostdin -loglevel error -y -f lavfi -i color=s=16x16:d=1 -i m.m4a -filter_complex G -map [aout] -c:a pcm_f32le -ar 48000 -rf64 auto -f wav mix.wav');
    // the typing sounds' track comes after the mic, the system audio between them
    expect(mixArgs({ mic: 'm.m4a', typing: 't.wav', graph: 'G', out: 'mix.wav' }).join(' ')).toContain('-i color=s=16x16:d=1 -i m.m4a -i t.wav -filter_complex G');
    expect(mixArgs({ mic: 'm.m4a', system: 'y.m4a', sound: 's.wav', graph: 'G', out: 'mix.wav' }).join(' ')).toContain('-i m.m4a -i y.m4a -i s.wav -filter_complex G');
  });

  it('reads a long graph from a file (Windows limits a command line to 32 767 characters)', () => {
    const args = mixArgs({ mic: 'm.m4a', graph: 'G', graphFile: 'audio.graph', out: 'mix.wav' });
    expect(args.join(' ')).toContain('-/filter_complex audio.graph -map [aout]');
    expect(args).not.toContain('G');
  });
});

describe('encodeArgs', () => {
  it('encodes the mix once as AAC at 48 kHz, through the master stage when there is one', () => {
    expect(encodeArgs({ mix: 'mix.wav', out: 'sound.m4a' }).join(' ')).toBe('-hide_banner -nostdin -loglevel error -y -i mix.wav -map 0:a:0 -c:a aac -b:a 160k -ar 48000 -f mp4 sound.m4a');
    expect(encodeArgs({ mix: 'mix.wav', master: 'volume=2dB', out: 'sound.m4a' }).join(' ')).toContain('-map 0:a:0 -af volume=2dB -c:a aac');
  });
});

describe('muxArgs', () => {
  it('puts the sound beside the video, both copied, with the moov in front', () => {
    expect(muxArgs({ video: 'v.mp4', audio: 'sound.m4a', out: 'o.mp4' }).join(' ')).toBe('-hide_banner -nostdin -loglevel error -y -i v.mp4 -i sound.m4a -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart -f mp4 o.mp4');
  });

  it('takes the chapters from their metadata file, the input after the sound', () => {
    expect(muxArgs({ video: 'v.mp4', audio: 'sound.m4a', chapters: 'c.txt', out: 'o.mp4' }).join(' ')).toContain('-i v.mp4 -i sound.m4a -i c.txt -map 0:v:0 -map 1:a:0 -map_chapters 2 -c copy');
  });
});

describe('planAudio over cuts', () => {
  it('plays the pieces of a cut clip one after the other, each faded 10 ms at the cut, with no crossfade dip', () => {
    const p = project({ scenes: [{ type: 'clip', from: 0, to: 6 }], cuts: [{ from: 2, to: 3 }] });
    const segments = planAudio({ spans: sceneSpans(p.scenes, p.cuts), look: p.look, mic: true, seconds: 5 });
    expect(segments.map((s) => [s.samples, s.mic?.from, s.mic?.to])).toEqual([
      [96_000, 0, 96_000],
      [144_000, 144_000, 288_000],
    ]);
    expect(segments[0]!.fadeOut).toBe(480);
    expect(segments[1]!.fadeIn).toBe(480);
  });
});
