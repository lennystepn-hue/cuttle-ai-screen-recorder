import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The commands that run in Electron (preview, capture-page, render), end to end through the built
 * CLI. Runs only with `pnpm cli:check` (vitest --mode cli, after cli:build).
 */
const CLI = fileURLToPath(new URL('../dist/cuttle.mjs', import.meta.url));
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

  it('fails on an unknown format before rendering, and on a page that does not exist', () => {
    expect(cuttle('-C', project, 'render', '--format', '4:3').code).toBe(1);
    expect(cuttle('-C', project, 'capture-page', join(project, 'missing.html')).code).toBe(1);
  }, 120_000);
});
