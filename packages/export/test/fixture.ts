// Builds a project folder from ffmpeg test sources, shaped like a recorder take: fragmented MP4
// screen and webcam tracks, an AAC mic, events.jsonl, take.json, a still image and cuttle.json.
// Node only (child_process); used by electron/check.ts.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** `showcase`: every scene type, speed-up, zoom, masks, text, webcam, cursor, crossfades. `long`: one clip. `speedup`: mostly a 12× clip. */
export type FixtureLayout = 'showcase' | 'long' | 'speedup';

export interface FixtureOptions {
  /** Length of the screen recording in seconds; the showcase needs 10. */
  seconds: number;
  layout: FixtureLayout;
  width?: number;
  height?: number;
  fps?: number;
}

/** What the fixture's take.json says: the webcam started 0.5 s after the screen, the mic 0.2 s before. */
export const FIXTURE_OFFSETS = { webcam: 0.5, mic: -0.2 } as const;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${args.join(' ')} failed (${code}): ${stderr}`))));
  });
}

/** The recorder's container flags: a killed process still leaves a readable file. */
const FRAGMENTED = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof'];
// BT.709 matrix and tags, as the recorder must write them: Chromium decodes untagged HD video as BT.709,
// while ffmpeg converts RGB with BT.601 unless told otherwise, which shifts every colour.
const H264 = [
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];

/** Pointer path: a slow loop with clicks, shape changes and a cut-off last line (a crashed recorder). */
function eventsJsonl(seconds: number, width: number, height: number): string {
  const lines: string[] = [];
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    const x = width / 2 + (width / 3) * Math.cos(t * 0.9);
    const y = height / 2 + (height / 3) * Math.sin(t * 1.3);
    lines.push(JSON.stringify({ t: Number(t.toFixed(4)), type: 'move', x: Math.round(x), y: Math.round(y) }));
  }
  for (const t of [1.5, 2.2, 4, 7]) {
    if (t >= seconds) continue;
    const x = Math.round(width / 2 + (width / 3) * Math.cos(t * 0.9));
    const y = Math.round(height / 2 + (height / 3) * Math.sin(t * 1.3));
    lines.push(JSON.stringify({ t, type: 'click', x, y, button: 'left' }));
  }
  lines.push(JSON.stringify({ t: 1, type: 'shape', shape: 'pointer' }), JSON.stringify({ t: 2.5, type: 'shape', shape: 'text' }));
  lines.push(JSON.stringify({ t: 2.6, type: 'keys', count: 3 }));
  return `${lines.join('\n')}\n{"t":${seconds},"type":"mo`;
}

function scenes(layout: FixtureLayout, seconds: number): unknown[] {
  switch (layout) {
    case 'showcase':
      return [
        { type: 'clip', from: 0, to: 3 },
        { type: 'clip', from: 3, to: 9, speed: 4 },
        { type: 'still', image: 'page.png', duration: 2, motion: 'scroll', frame: 'browser-light' },
        { type: 'clip', from: 1, to: 3 },
        { type: 'card', title: 'Cuttle', subtitle: 'Export-Fixture · Grüße', duration: 1.5 },
      ];
    case 'long':
      return [{ type: 'clip', from: 0, to: seconds }];
    case 'speedup':
      return [
        { type: 'clip', from: 0, to: 5 },
        { type: 'clip', from: 5, to: seconds - 5, speed: 12 },
        { type: 'clip', from: seconds - 5, to: seconds },
      ];
  }
}

/** Writes the fixture project into `dir` (created if needed). */
export async function createFixtureProject(dir: string, options: FixtureOptions): Promise<void> {
  const { seconds, layout, width = 1920, height = 1080, fps = 30 } = options;
  const take = join(dir, 'takes', '1');
  await mkdir(take, { recursive: true });
  const webcamSeconds = seconds - 1;
  const micSeconds = seconds - 0.5;
  await Promise.all([
    ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}:duration=${seconds}`, ...H264, ...FRAGMENTED, join(take, 'screen.mp4')]),
    // Grey, with the testsrc counter in view, so the bubble shows which webcam second it plays.
    ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=640x480:rate=30:duration=${webcamSeconds},crop=480:480:160:0,hue=s=0`, ...H264, ...FRAGMENTED, join(take, 'webcam.mp4')]),
    // A 100 ms beep at the start of every mic second: easy to find when checking sync.
    ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t\\,1)\\,0.1):s=48000:d=${micSeconds}`, '-c:a', 'aac', '-b:a', '96k', join(take, 'mic.m4a')]),
    ffmpeg([
      '-f', 'lavfi', '-i', 'color=c=0xF4F4F5:s=1280x2400',
      '-vf', 'drawbox=x=0:y=0:w=1280:h=96:color=0x111827:t=fill,drawbox=x=80:y=160:w=1120:h=420:color=0x6366F1:t=fill,drawbox=x=80:y=660:w=540:h=700:color=0xFCE7F3:t=fill,drawbox=x=660:y=660:w=540:h=700:color=0xDCFCE7:t=fill,drawbox=x=80:y=1440:w=1120:h=760:color=0xE0E7FF:t=fill,drawbox=x=0:y=2280:w=1280:h=120:color=0x111827:t=fill',
      '-frames:v', '1', join(dir, 'page.png'),
    ]),
  ]);
  await writeFile(join(take, 'events.jsonl'), eventsJsonl(seconds, width, height));
  await writeFile(
    join(take, 'take.json'),
    `${JSON.stringify(
      {
        version: 1,
        tracks: {
          screen: { file: 'screen.mp4', start: 1000 },
          webcam: { file: 'webcam.mp4', start: 1000 + FIXTURE_OFFSETS.webcam },
          mic: { file: 'mic.m4a', start: 1000 + FIXTURE_OFFSETS.mic },
        },
      },
      null,
      2,
    )}\n`,
  );
  const project = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: { screen: 'takes/1/screen.mp4', webcam: 'takes/1/webcam.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl' },
    look: {
      frame: { title: 'cuttle · Grüße aus dem Export' },
      webcam: { enabled: true, corner: 'bottom-right' },
      cursor: { style: 'system' },
    },
    scenes: scenes(layout, seconds),
    zooms: [{ at: 1, duration: 1.8, rect: [960, 400, 800, 450] }],
    masks: [
      { from: 0, to: 3, rect: [120, 120, 520, 240], style: 'fill' },
      { from: 1, to: 3, rect: [1240, 700, 520, 260], style: 'blur' },
    ],
    texts: [
      { at: 0.4, duration: 2.2, text: 'Hallo aus dem Export', style: 'pill', position: 'top' },
      { at: 1.2, duration: 1.6, text: 'Untertitel mit Umlauten: äöü', style: 'lower-third', position: 'bottom' },
    ],
  };
  await writeFile(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}
