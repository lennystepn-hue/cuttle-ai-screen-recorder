import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The commands that run in Electron (preview, capture-page, render), end to end through the built
 * CLI. Runs only with `pnpm cli:check` (vitest --mode cli, after cli:build).
 */
const CLI = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
/** The motion check's page: CSS, Web Animations, requestAnimationFrame, timers, transparency and a seeded random. */
const MOTION_PAGE = fileURLToPath(new URL('./motion-page.html', import.meta.url));
const enabled = process.env.MODE === 'cli';

function cuttle(...argv: string[]): { code: number; json: Record<string, unknown> } {
  const result = spawnSync('node', [CLI, '--json', ...argv], { encoding: 'utf8', timeout: 120_000 });
  return { code: result.status ?? -1, json: JSON.parse(result.stdout || '{}') as Record<string, unknown> };
}

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function probe(file: string): string {
  return spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();
}

describe.runIf(enabled)('cuttle in Electron', () => {
  let project: string;
  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), 'cuttle-check-'));
    expect(cuttle('-C', project, 'record', '--backend', 'test', '--mic', '--max', '3', '--countdown', '0').code).toBe(0);
  }, 60_000);
  afterAll(() => rm(project, { recursive: true, force: true }));

  it('renders stills at given times, and a contact sheet by default', () => {
    const some = cuttle('-C', project, 'preview', '--at', '0.5', '--at', '2');
    expect(some.code).toBe(0);
    const stills = some.json.stills as { t: number; file: string; source?: number }[];
    // one clip over the whole take: each still shows the same source second
    expect(stills.map((still) => [still.t, still.source])).toEqual([[0.5, 0.5], [2, 2]]);
    expect(stills.map((still) => pngSize(still.file))).toEqual([[1920, 1080], [1920, 1080]]);
    expect(some.json.sheet).toBeUndefined();
    const sheet = cuttle('-C', project, 'preview', '--format', '9:16');
    expect(sheet.code).toBe(0);
    expect((sheet.json.stills as unknown[]).length).toBe(12);
    expect(pngSize((sheet.json.stills as { file: string }[])[0]!.file)).toEqual([1080, 1920]);
    expect(pngSize(sheet.json.sheet as string)[0]).toBeGreaterThan(1000);
  }, 120_000);

  it("renders stills at each mask's edges, a row of the sheet per mask, and says which is which", () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as Record<string, unknown>;
    try {
      writeFileSync(file, JSON.stringify({ ...raw, masks: [{ id: 'mask1', label: 'Key', from: 1, to: 2, rect: [0, 0, 200, 40] }, { from: 2.4, to: 2.6, rect: [0, 0, 50, 50], enabled: false }] }));
      const { code, json } = cuttle('-C', project, 'preview', '--masks');
      expect(code).toBe(0);
      // one clip over the whole take: output and source seconds are the same
      expect(json.masks).toEqual([
        { mask: 0, id: 'mask1', label: 'Key', edge: 'before', t: 0.9, source: 0.9 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'start', t: 1.1, source: 1.1 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'end', t: 1.9, source: 1.9 },
        { mask: 0, id: 'mask1', label: 'Key', edge: 'after', t: 2.1, source: 2.1 },
      ]);
      expect((json.stills as { t: number }[]).map((still) => still.t)).toEqual([0.9, 1.1, 1.9, 2.1]);
      // four stills a row: one row
      const [width, height] = pngSize(json.sheet as string);
      expect(width / height).toBeGreaterThan(3);
      // without a mask to look at, it says so
      writeFileSync(file, JSON.stringify({ ...raw, masks: [{ from: 2.4, to: 2.6, rect: [0, 0, 50, 50], enabled: false }] }));
      const none = cuttle('-C', project, 'preview', '--masks');
      expect(none.code).toBe(1);
      expect(none.json).toMatchObject({ error: { code: 'usage' } });
    } finally {
      writeFileSync(file, before);
    }
  }, 120_000);

  it('captures a whole page and appends it as a scrolling still scene', () => {
    const page = join(project, 'page.html');
    // A landing page: smooth scrolling, a fixed header (black, 60 px), a full-height hero (100vh,
    // red) that must stay one viewport tall, and a section a script reveals when it scrolls into
    // view (white until then, green after), which must show.
    writeFileSync(
      page,
      `<!doctype html><html style="scroll-behavior:smooth"><body style="margin:0">
      <div style="position:fixed;top:0;left:0;right:0;height:60px;background:#000"></div>
      <div style="height:100vh;background:#f00"></div><div style="height:6000px;background:#00f"></div>
      <div id="reveal" style="height:500px;background:#fff"></div>
      <script>new IntersectionObserver((entries) => { if (entries[0].isIntersecting) reveal.style.background = '#0f0'; }).observe(reveal);</script></body></html>`,
    );
    const { code, json } = cuttle('-C', project, 'capture-page', page, '--scroll', '--add', '--duration', '3');
    expect(code).toBe(0);
    expect(json).toMatchObject({ width: 1920, height: 7580, scene: { type: 'still', image: 'stills/page.png', duration: 3, motion: 'scroll', frame: 'browser-light' } });
    const png = PNG.sync.read(readFileSync(json.file as string));
    expect([png.width, png.height]).toEqual([1920, 7580]);
    const rgb = (y: number) => [...png.data.subarray((y * png.width + 960) * 4, (y * png.width + 960) * 4 + 3)];
    // The header sits at the top (the page was scrolled back), the hero ends at 1080, the section shows.
    expect([rgb(30), rgb(1070), rgb(1090), rgb(7330)]).toEqual([[0, 0, 0], [255, 0, 0], [0, 0, 255], [0, 255, 0]]);
    // A still of the page scene shows no source second; one of the clip does.
    const stills = cuttle('-C', project, 'preview', '--at', '1', '--at', '5').json.stills as { t: number; source?: number }[];
    expect(stills.map((still) => still.source)).toEqual([1, undefined]);
  }, 120_000);

  it('renders the project with its still scene to 1:1', () => {
    const { code, json } = cuttle('-C', project, 'render', '--format', '1:1');
    expect(code).toBe(0);
    const seconds = json.seconds as number;
    expect(seconds).toBeGreaterThan(5.9); // the 3 s take plus the 3 s still (the crossfade between them does not shorten it)
    expect(probe(json.out as string).split(/\r?\n/).slice(0, 2)).toEqual(['h264,1080,1080', 'aac']);
  }, 120_000);

  it('burns the captions in, writes them as SRT and VTT, and leaves them out on --no-captions', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { sources: Record<string, string> };
    writeFileSync(join(project, 'takes', '1', 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 0.4, end: 0.8, text: 'Hello' }, { t: 0.8, end: 1.6, text: 'captions.' }] }));
    writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json' } }));
    try {
      const out = join(project, 'out', 'captions.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out, '--srt', '--vtt');
      expect(code).toBe(0);
      expect(json.subtitles).toEqual([join(project, 'out', 'captions.srt'), join(project, 'out', 'captions.vtt')]);
      expect(readFileSync(join(project, 'out', 'captions.srt'), 'utf8')).toBe('1\n00:00:00,400 --> 00:00:02,200\nHello captions.\n');
      expect(readFileSync(join(project, 'out', 'captions.vtt'), 'utf8')).toBe('WEBVTT\n\n00:00:00.400 --> 00:00:02.200\nHello captions.\n');
      // a frame with the caption differs from the same frame without it, at the bottom only
      const frame = (extra: string[]) => {
        const still = cuttle('-C', project, 'preview', '--at', '1', '-o', join(project, `frame-${extra.length}`), ...extra);
        return PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      };
      const shown = frame([]);
      writeFileSync(file, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json' }, captions: { enabled: false } }));
      const hidden = frame(['--sheet']);
      const differs = (top: number, bottom: number) => {
        for (let y = top; y < bottom; y++) for (let x = 0; x < shown.width; x += 4) if (shown.data[(y * shown.width + x) * 4] !== hidden.data[(y * shown.width + x) * 4]) return true;
        return false;
      };
      expect(differs(shown.height - 200, shown.height)).toBe(true);
      expect(differs(0, shown.height / 2)).toBe(false);
      expect(cuttle('-C', project, 'render', '-o', join(project, 'out', 'plain.mp4'), '--no-captions').code).toBe(0);
    } finally {
      writeFileSync(file, before);
    }
  }, 240_000);

  it("writes the script's steps into the video as its chapters, where the take reached them", () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { sources: Record<string, string> };
    const markersFile = join(project, raw.sources.markers!);
    const markers = readFileSync(markersFile, 'utf8');
    writeFileSync(markersFile, JSON.stringify({ version: 1, markers: [{ t: 0, kind: 'step', label: 'step1' }, { t: 1.5, kind: 'step', label: 'step2' }] }));
    writeFileSync(file, JSON.stringify({ ...raw, script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }] }));
    try {
      const out = join(project, 'out', 'chapters.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out);
      expect(code).toBe(0);
      const seconds = json.seconds as number;
      expect(json.chapters).toEqual([
        { at: 0, end: 1.5, title: 'Open the settings', step: 'step1' },
        // to the end of the scenes (the video's own length is whole frames)
        { at: 1.5, end: expect.closeTo(seconds, 1), title: 'Turn on dark mode', step: 'step2' },
      ]);
      const chapters = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', out], { encoding: 'utf8' }).stdout) as { chapters: { start_time: string; tags: { title: string } }[] };
      expect(chapters.chapters.map((chapter) => [Number(chapter.start_time), chapter.tags.title])).toEqual([
        [0, 'Open the settings'],
        [1.5, 'Turn on dark mode'],
      ]);
    } finally {
      writeFileSync(file, before);
      writeFileSync(markersFile, markers);
    }
  }, 120_000);

  it('checks a motion page: each way it moves lands on the frame, the same on every run, and it says nothing', () => {
    mkdirSync(join(project, 'motion', 'check'), { recursive: true });
    copyFileSync(MOTION_PAGE, join(project, 'motion', 'check', 'index.html'));
    const first = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html');
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({ src: 'motion/check/index.html', duration: 3, width: 1920, height: 1080, errors: [], console: [] });
    const stills = first.json.stills as { t: number; file: string }[];
    expect(stills.map((still) => still.t)).toEqual([0, 0.424, 0.848, 1.271, 1.695, 2.119, 2.543, 2.967]);
    for (const still of stills) {
      const png = PNG.sync.read(readFileSync(still.file));
      // the first pixel of a row in a colour, and how many follow it
      const run = (y: number, rgb: number[]): [number, number] => {
        let start = -1;
        let length = 0;
        for (let x = 0; x < 1200; x++) {
          const i = (y * png.width + x) * 4;
          if (rgb.every((value, c) => Math.abs(png.data[i + c]! - value) <= 2)) {
            if (start < 0) start = x;
            length++;
          }
        }
        return [start, length];
      };
      const t = Math.floor(still.t * 30 + 1e-6) / 30; // the frame the still shows
      const slid = 40 + Math.min(t / 2, 1) * 400;
      expect(Math.abs(run(90, [0xd9, 0x77, 0x57])[0] - slid), `CSS at ${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(run(230, [0x3c, 0xc6, 0xc9])[0] - slid), `Web Animation at ${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(run(370, [0xf2, 0xb3, 0x4a])[0] - (40 + t * 200)), `animation frame at ${t}`).toBeLessThanOrEqual(1);
      expect(run(480, [255, 255, 255])[1], `timer at ${t}`).toBe(Math.floor(t / 0.25 + 1e-9) * 40);
    }
    const again = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html', '-o', join(project, 'again'));
    expect(again.code).toBe(0);
    for (const still of stills) expect(readFileSync(join(project, 'again', basename(still.file))).equals(readFileSync(still.file))).toBe(true);
    // 9:16 is taller than the screen: the page is the whole 1080×1920 still
    const tall = cuttle('-C', project, 'motion', 'check', 'motion/check/index.html', '--format', '9:16', '--at', '2.5', '-o', join(project, 'tall'));
    expect(tall.code).toBe(0);
    expect(tall.json).toMatchObject({ width: 1080, height: 1920, errors: [] });
    const portrait = PNG.sync.read(readFileSync((tall.json.stills as { file: string }[])[0]!.file));
    const at = (x: number, y: number) => [...portrait.data.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 3)];
    // near the bottom right corner the panel is white at half opacity over the background beside it
    const beside = at(1060, 1860);
    at(1000, 1860).forEach((value, i) => expect(Math.abs(value - (255 + beside[i]!) / 2)).toBeLessThanOrEqual(6));
    expect(at(490, 90)).toEqual([0xd9, 0x77, 0x57]);
  }, 120_000);

  it('tells what a motion page threw, and keeps it off the network and inside the project', () => {
    mkdirSync(join(project, 'motion', 'bad'), { recursive: true });
    const secret = join(dirname(project), `${basename(project)}-secret.txt`);
    writeFileSync(secret, 'outside the project');
    writeFileSync(
      join(project, 'motion', 'bad', 'index.html'),
      `<!doctype html><script>
      document.addEventListener('securitypolicyviolation', (event) => console.log('refused ' + event.blockedURI));
      cuttle.ready(Promise.allSettled([
        fetch('https://127.0.0.1:9/').then(() => console.log('reached the network'), () => console.log('no network')),
        fetch('../../cuttle.json').then((response) => console.log('own file ' + response.status)),
        fetch('cuttle-motion://project/..%2F${basename(project)}-secret.txt').then((response) => console.log('outside ' + response.status)),
      ]));
      cuttle.onFrame((t) => { if (t > 0.5) throw new TypeError('late'); });
      throw new Error('boom');
      </script>`,
    );
    try {
      const { code, json } = cuttle('-C', project, 'motion', 'check', 'motion/bad/index.html', '--duration', '1');
      expect(code).toBe(0);
      expect(json.errors).toEqual(['Error: boom', 'TypeError: late']);
      const said = (json.console as string[]).join('\n');
      for (const line of ['refused https://127.0.0.1:9/', 'no network', 'own file 200', 'outside 404']) expect(said).toContain(`info: ${line}`);
      expect(said).not.toContain('reached the network');
      expect(said).not.toContain('Electron Security Warning');
      // a page outside the project is refused before anything renders
      expect(cuttle('-C', project, 'motion', 'check', secret).code).toBe(1);
    } finally {
      rmSync(secret, { force: true });
    }
  }, 120_000);

  it('makes a video without a recording: a project of motion scenes from the kit\'s templates', () => {
    const reel = join(mkdtempSync(join(tmpdir(), 'cuttle-reel-')), 'reel');
    try {
      expect(cuttle('init', reel).code).toBe(0);
      expect(cuttle('-C', reel, 'motion', 'new', 'title', '--first').code).toBe(0);
      expect(cuttle('-C', reel, 'motion', 'new', 'end-card').code).toBe(0);
      const { code, json } = cuttle('-C', reel, 'render');
      expect(code).toBe(0);
      expect(json).toMatchObject({ frames: 225, seconds: 7.5 });
      expect((json.motion as { errors: string[] }[]).flatMap((report) => report.errors)).toEqual([]);
      expect(probe(json.out as string).split(/\r?\n/)[0]).toBe('h264,1920,1080');
      // the templates' own sounds (a whoosh with the title; a hit, keys and a ding on the end card)
      // are the video's sound, without music
      expect(json.music).toMatchObject({ errors: [], skipped: [] });
      expect(json.music).not.toHaveProperty('src');
      const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', json.out as string], { encoding: 'utf8' }).stdout.trim();
      expect(audio).toBe('aac,2');
      const checked = cuttle('-C', reel, 'music', 'check');
      expect(checked.code).toBe(0);
      const parts = (checked.json as { parts: { name: string; effectsDb: number }[] }).parts;
      expect(parts.map((part) => part.name)).toEqual(['Title', 'End card']);
      for (const part of parts) expect(part.effectsDb, part.name).toBeGreaterThan(-50);
      // their sounds param switches them off
      const config = join(reel, 'cuttle.json');
      const raw = JSON.parse(readFileSync(config, 'utf8')) as { scenes: { params?: Record<string, unknown> }[] };
      writeFileSync(config, JSON.stringify({ ...raw, scenes: raw.scenes.map((scene) => ({ ...scene, params: { ...scene.params, sounds: false } })) }));
      expect(cuttle('-C', reel, 'music', 'check').code).toBe(1);
      // the title is on screen at 1.5 s: its light letters over its dark background, in the middle
      const still = cuttle('-C', reel, 'preview', '--at', '1.5', '-o', join(reel, 'still'));
      const png = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      let light = 0;
      for (let x = 300; x < 1620; x += 2) light += png.data[(540 * png.width + x) * 4]! > 200 ? 1 : 0;
      expect(light).toBeGreaterThan(40);
    } finally {
      rmSync(dirname(reel), { recursive: true, force: true });
    }
  }, 180_000);

  it('lands callouts on the take\'s clicks and kinetic captions on its words, over the video', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-take-')), 'take');
    cpSync(project, dir, { recursive: true });
    try {
      const file = join(dir, 'cuttle.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { sources: Record<string, string> };
      writeFileSync(join(dir, 'takes', '1', 'events.jsonl'), '{"t":0.95,"type":"move","x":640,"y":360}\n{"t":1,"type":"click","x":640,"y":360,"button":"left"}\n');
      writeFileSync(join(dir, 'takes', '1', 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 1, end: 1.4, text: 'Look' }, { t: 1.4, end: 1.9, text: 'here' }] }));
      writeFileSync(file, JSON.stringify({ ...raw, scenes: [{ type: 'clip', from: 0, to: 3 }], overlays: [], captions: { enabled: false }, sources: { ...raw.sources, events: 'takes/1/events.jsonl', transcript: 'takes/1/transcript.json' } }));
      expect(cuttle('-C', dir, 'motion', 'new', 'click-callouts').code).toBe(0);
      expect(cuttle('-C', dir, 'motion', 'new', 'kinetic-captions').code).toBe(0);
      const still = (name: string) => PNG.sync.read(readFileSync((cuttle('-C', dir, 'preview', '--at', '1.3', '-o', join(dir, name)).json.stills as { file: string }[])[0]!.file));
      const shown = still('with');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), overlays: [] }));
      const plain = still('without');
      const rgb = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      // the click at (640, 360) of the 1280×720 screen is at (960, 558) of the 16:9 video, in the
      // mac-dark window (content 146, 100, 1628×916): the callout's dot is there, in the accent colour
      expect(rgb(shown, 960, 558).every((value, i) => Math.abs(value - [0xd9, 0x77, 0x57][i]!) <= 24)).toBe(true);
      // the captions: the bottom of the video changes, its top does not
      const differs = (top: number, bottom: number) => {
        for (let y = top; y < bottom; y += 2) for (let x = 0; x < 1920; x += 4) if (shown.data[(y * 1920 + x) * 4] !== plain.data[(y * 1920 + x) * 4]) return true;
        return false;
      };
      expect(differs(880, 1000)).toBe(true);
      expect(differs(0, 400)).toBe(false);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('hands pages frames of the take, its masks painted over them, and shows the take on a device in 3D', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-frames-')), 'frames');
    cpSync(project, dir, { recursive: true });
    try {
      // a page that draws the take's frame at 1.5 s, at its own size, in the corner
      mkdirSync(join(dir, 'motion', 'exact'), { recursive: true });
      writeFileSync(
        join(dir, 'motion', 'exact', 'index.html'),
        `<!doctype html><body style="margin:0"><canvas id="c" width="1280" height="720"></canvas><script>
        const g = document.getElementById('c').getContext('2d');
        cuttle.onFrame(async () => { const frame = await cuttle.take.frame(1.5); g.drawImage(frame, 0, 0); frame.close(); });
        </script></body>`,
      );
      const read = (file: string) => PNG.sync.read(readFileSync(file));
      const drawn = () => {
        const checked = cuttle('-C', dir, 'motion', 'check', 'motion/exact/index.html', '--at', '0.1', '-o', join(dir, 'drawn'));
        expect(checked.json.errors).toEqual([]);
        return read((checked.json.stills as { file: string }[])[0]!.file);
      };
      const raw = read(cuttle('-C', dir, 'frame', '1.5', '-o', join(dir, 'raw.png')).json.file as string);
      const next = read(cuttle('-C', dir, 'frame', '1.55', '-o', join(dir, 'next.png')).json.file as string);
      const meanDifference = (a: PNG, b: PNG) => {
        let sum = 0;
        for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) for (let c = 0; c < 3; c++) sum += Math.abs(a.data[(y * a.width + x) * 4 + c]! - b.data[(y * b.width + x) * 4 + c]!);
        return sum / (1280 * 720 * 3);
      };
      // the frame asked for, not its neighbour (WebCodecs and ffmpeg turn YUV into RGB a little differently)
      const page = drawn();
      expect(meanDifference(page, raw)).toBeLessThan(3);
      expect(meanDifference(page, next)).toBeGreaterThan(meanDifference(page, raw));

      // the project's masks are on the frames: a fill is one colour, a blur has no edges left
      const file = join(dir, 'cuttle.json');
      const raw0 = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...raw0, masks: [{ from: 1, to: 2, rect: [100, 100, 300, 200] }, { from: 1, to: 2, rect: [600, 300, 400, 250], style: 'blur' }] }));
      const masked = drawn();
      const at = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      const fill = at(masked, 100, 100);
      for (let y = 100; y < 300; y += 7) for (let x = 100; x < 400; x += 7) expect(at(masked, x, y)).toEqual(fill);
      const steepest = (png: PNG) => {
        let most = 0;
        for (let y = 305; y < 545; y += 5) for (let x = 605; x < 995; x++) most = Math.max(most, ...[0, 1, 2].map((c) => Math.abs(png.data[(y * png.width + x) * 4 + c]! - png.data[(y * png.width + x + 1) * 4 + c]!)));
        return most;
      };
      expect(steepest(raw)).toBeGreaterThan(150);
      expect(steepest(masked)).toBeLessThan(40);

      // the device template plays the take on its screen and flies into it: no errors, and it moves
      expect(cuttle('-C', dir, 'motion', 'new', 'device-3d', '--first').code).toBe(0);
      const device = cuttle('-C', dir, 'motion', 'check', 'motion/device-3d/index.html', '-o', join(dir, 'device'));
      expect(device.json.errors).toEqual([]);
      const stills = (device.json.stills as { file: string }[]).map((still) => read(still.file));
      const meanOf = (png: PNG) => png.data.reduce((sum, value, i) => (i % 4 === 3 ? sum : sum + value), 0) / (png.width * png.height * 3);
      // the take fills the last frame: far brighter than the dark scene the device turns in on
      expect(meanOf(stills.at(-1)!)).toBeGreaterThan(meanOf(stills[0]!) + 40);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('goes into a scene through its transition page: the fold turns the card over onto the clip', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-fold-')), 'fold');
    cpSync(project, dir, { recursive: true });
    try {
      const file = join(dir, 'cuttle.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...raw, scenes: [{ type: 'card', id: 's1', title: 'Before', duration: 2 }, { type: 'clip', id: 's2', from: 0, to: 2.5 }], overlays: [] }));
      expect(cuttle('-C', dir, 'motion', 'new', 'fold', '--into', 's1').code).toBe(1);
      const added = cuttle('-C', dir, 'motion', 'new', 'fold', '--into', 's2');
      expect(added.json).toMatchObject({ kind: 'transition', into: 1, item: { src: 'motion/fold/index.html', duration: 0.9 } });
      // checked in the video, between the card and the clip: 1.55 to 2.45 s
      const checked = cuttle('-C', dir, 'motion', 'check', 'motion/fold/index.html');
      expect(checked.json).toMatchObject({ kind: 'transition', duration: 0.9, errors: [] });
      const { json } = cuttle('-C', dir, 'render');
      expect(json.motion).toEqual([{ item: 'scenes[1].transition', src: 'motion/fold/index.html', errors: [], console: [] }]);
      // in the middle of the turn the picture is the page's, not a crossfade of the two scenes
      const still = (name: string) => PNG.sync.read(readFileSync((cuttle('-C', dir, 'preview', '--at', '1.98', '-o', join(dir, name)).json.stills as { file: string }[])[0]!.file));
      const folded = still('folded');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), look: { transition: { enabled: true, duration: 0.9 } }, scenes: [{ type: 'card', id: 's1', title: 'Before', duration: 2 }, { type: 'clip', id: 's2', from: 0, to: 2.5 }] }));
      const faded = still('faded');
      let differ = 0;
      for (let i = 0; i < folded.data.length; i += 4 * 97) if (Math.abs(folded.data[i]! - faded.data[i]!) + Math.abs(folded.data[i + 1]! - faded.data[i + 1]!) > 60) differ++;
      expect(differ / (folded.data.length / (4 * 97))).toBeGreaterThan(0.2);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('blurs fast motion: the moments while the shutter is open, averaged', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cuttle-blur-')), 'blur');
    try {
      expect(cuttle('init', dir).code).toBe(0);
      mkdirSync(join(dir, 'motion', 'fast'), { recursive: true });
      // a white square that crosses the frame at 3000 px a second
      writeFileSync(
        join(dir, 'motion', 'fast', 'index.html'),
        '<!doctype html><body style="margin:0;background:#000"><div id="box" style="position:absolute;top:440px;width:200px;height:200px;background:#fff"></div><script>cuttle.onFrame((t) => (box.style.left = (t * 3000 - 200) + "px"))</script></body>',
      );
      const page = { type: 'motion', src: 'motion/fast/index.html', duration: 1 };
      const raw = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
      writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ ...raw, look: { transition: { enabled: false } }, scenes: [page, { ...page, motionBlur: { samples: 8, shutter: 0.5 } }] }));
      const stills = cuttle('-C', dir, 'preview', '--at', '0.5', '--at', '1.5', '-o', join(dir, 'stills')).json.stills as { file: string }[];
      // grey pixels along the square's middle row: a hard edge has none, a blurred one a band of them
      const greys = (file: string) => {
        const png = PNG.sync.read(readFileSync(file));
        let count = 0;
        for (let x = 0; x < png.width; x++) {
          const value = png.data[(540 * png.width + x) * 4]!;
          if (value > 20 && value < 235) count++;
        }
        return count;
      };
      expect(greys(stills[0]!.file)).toBeLessThan(4);
      expect(greys(stills[1]!.file)).toBeGreaterThan(30);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }, 180_000);

  it('renders a motion scene and a motion overlay into the video, as the preview shows them', () => {
    const file = join(project, 'cuttle.json');
    const before = readFileSync(file, 'utf8');
    const raw = JSON.parse(before) as { scenes: unknown[] };
    mkdirSync(join(project, 'motion', 'bar'), { recursive: true });
    // a green bar across the bottom fifth, fading in over the overlay's first second
    writeFileSync(
      join(project, 'motion', 'bar', 'index.html'),
      '<!doctype html><body style="margin:0"><div id="bar" style="position:absolute;left:0;right:0;bottom:0;height:20%;background:#00ff00"></div><script>cuttle.onFrame((t) => (bar.style.opacity = String(Math.min(1, t))))</script></body>',
    );
    writeFileSync(
      file,
      JSON.stringify({
        ...raw,
        scenes: [{ id: 's90', type: 'motion', src: 'motion/check/index.html', duration: 1.5 }, ...raw.scenes],
        overlays: [{ id: 'o1', src: 'motion/bar/index.html', at: 0.5, duration: 2 }],
      }),
    );
    try {
      const out = join(project, 'out', 'motion.mp4');
      const { code, json } = cuttle('-C', project, 'render', '-o', out);
      expect(code).toBe(0);
      expect(json.motion).toEqual([
        { item: 'scenes[0]', src: 'motion/check/index.html', errors: [], console: [] },
        { item: 'overlays[0]', src: 'motion/bar/index.html', errors: [], console: [] },
      ]);
      // the video's frames: 0.5 s into the motion scene (its CSS square at x 140), and the clip 1.5 s
      // into the overlay (output 1.5 + 2 = 3.5 s), where its bar is fully in
      const frame = (seconds: number) => {
        const png = join(project, 'out', `frame-${seconds}.png`);
        spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', out, '-frames:v', '1', png]);
        return PNG.sync.read(readFileSync(png));
      };
      const rgb = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
      const close = (actual: number[], expected: number[]) => actual.every((value, i) => Math.abs(value - expected[i]!) <= 24);
      expect(close(rgb(frame(0.5), 190, 90), [0xd9, 0x77, 0x57])).toBe(true);
      const late = frame(3.5);
      expect(close(rgb(late, 960, 1040), [0, 255, 0])).toBe(true);
      expect(close(rgb(late, 960, 700), [0, 255, 0])).toBe(false);
      // the preview shows the same
      const still = cuttle('-C', project, 'preview', '--at', '3.5', '-o', join(project, 'motion-still'));
      const shown = PNG.sync.read(readFileSync((still.json.stills as { file: string }[])[0]!.file));
      expect(rgb(shown, 960, 1040)).toEqual([0, 255, 0]);
    } finally {
      writeFileSync(file, before);
    }
  }, 180_000);

  it('composes music for the video and mixes it with its sounds under the mic', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'cuttle-music-')), 'take');
    cpSync(project, copy, { recursive: true });
    try {
      expect(cuttle('-C', copy, 'music', 'new', 'pulse').code).toBe(0);
      expect(cuttle('-C', copy, 'sound', 'add', 'pop', '--at', '1').code).toBe(0);
      const checked = cuttle('-C', copy, 'music', 'check');
      expect(checked.code).toBe(0);
      const report = checked.json as { seconds: number; errors: string[]; skipped: string[]; info: { bpm: number }; loudness: { lufs: number; truePeak: number }; out: string; sheet: string; parts: unknown[] };
      expect(report.errors).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.seconds).toBeGreaterThan(2);
      expect(report.info.bpm).toBeGreaterThanOrEqual(114);
      expect(report.parts.length).toBeGreaterThan(0);
      expect(report.loudness.lufs).toBeGreaterThan(-40);
      expect(report.loudness.truePeak).toBeLessThan(0);
      expect(pngSize(report.sheet)).toEqual([1600, 900]);
      expect(readFileSync(report.out).toString('ascii', 0, 4)).toBe('RIFF');
      const { code, json } = cuttle('-C', copy, 'render');
      expect(code).toBe(0);
      expect(json.music).toMatchObject({ src: 'music/pulse/index.html', errors: [], skipped: [] });
      const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,channels', '-of', 'csv=p=0', json.out as string], { encoding: 'utf8' }).stdout.trim();
      expect(audio).toBe('aac,2');
    } finally {
      rmSync(dirname(copy), { recursive: true, force: true });
    }
  }, 180_000);

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
  }, 120_000);
});
