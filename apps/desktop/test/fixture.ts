// A small project for the app's checks, made with ffmpeg: a 12 s screen recording (a test pattern
// with a moving box), a webcam that started 0.4 s later, a mic (a tone), input events, Claude's
// markers, a page still, and a cuttle.json with a continuous cut into an 8× clip (above 6×, playback
// from the proxy shows key frames only), a jump cut, a card, a zoom, a mask and a caption.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_OUTPUT = { width: 640, height: 360, fps: 30 } as const;

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

export function makeFixture(dir: string): void {
  const take = join(dir, 'takes', '1');
  mkdirSync(take, { recursive: true });
  mkdirSync(join(dir, 'stills'), { recursive: true });
  const screen = "testsrc2=s=1280x800:r=30:d=12[bg];color=c=white:s=120x120:r=30:d=12[box];[bg][box]overlay=x='100+t*80':y=520";
  ffmpeg(['-f', 'lavfi', '-i', screen, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-pix_fmt', 'yuv420p', '-color_trc', 'bt709', join(take, 'screen.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=11', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', join(take, 'webcam.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12', '-c:a', 'aac', '-b:a', '96k', join(take, 'mic.m4a')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=s=1200x1600:d=1', '-frames:v', '1', join(dir, 'stills', 'page.png')]);
  const events = [
    { t: 0, type: 'move', x: 400, y: 300 },
    { t: 0, type: 'shape', shape: 'arrow' },
    { t: 1.5, type: 'move', x: 640, y: 400 },
    { t: 2, type: 'click', x: 640, y: 400, button: 'left' },
    { t: 2.4, type: 'keys', count: 6 },
    { t: 9, type: 'click', x: 900, y: 600, button: 'left' },
  ];
  writeFileSync(join(take, 'events.jsonl'), events.map((event) => `${JSON.stringify(event)}\n`).join(''));
  writeFileSync(join(take, 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 2.5, kind: 'prompt' }, { t: 4, kind: 'tool', label: 'Bash' }, { t: 4.6, kind: 'tool', label: 'Bash' }, { t: 9, kind: 'answer' }] }));
  writeFileSync(join(take, 'take.json'), JSON.stringify({ version: 1, tracks: { screen: { file: 'screen.mp4', start: 100 }, webcam: { file: 'webcam.mp4', start: 100.4 }, mic: { file: 'mic.m4a', start: 100 } } }));
  const project = {
    version: 1,
    output: FIXTURE_OUTPUT,
    sources: { screen: 'takes/1/screen.mp4', webcam: 'takes/1/webcam.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl', markers: 'takes/1/markers.json' },
    look: { background: { preset: 'aurora' }, frame: { title: 'claude · ~/demo' }, webcam: { enabled: true } },
    scenes: [
      { type: 'clip', id: 's1', label: 'Prompt', from: 0, to: 3 },
      { type: 'clip', id: 's2', label: 'Claude at work', from: 3, to: 8, speed: 8 },
      { type: 'clip', id: 's3', label: 'Answer', from: 8.5, to: 11.5 },
      { type: 'still', id: 's4', image: 'stills/page.png', duration: 2, motion: 'scroll', frame: 'browser-light' },
      { type: 'card', id: 's5', title: 'Built with Claude Code', subtitle: 'example.com', duration: 1.5 },
    ],
    zooms: [{ id: 'z1', label: 'Answer', at: 8.8, duration: 2.5, rect: [600, 400, 640, 400] }],
    masks: [{ id: 'm1', label: 'Token', from: 0, to: 9, rect: [40, 40, 300, 60] }],
    texts: [{ id: 't1', label: 'Hook', at: 0.5, duration: 2, text: 'One prompt', style: 'pill', position: 'bottom' }],
  };
  writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify(project, null, 2)}\n`);
}
