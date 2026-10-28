import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CoreError,
  addCredit,
  adaptBlock,
  allowedUrl,
  blockFiles,
  blockNamed,
  fetchBytes,
  findBlocks,
  hyperframesCatalog,
  iconifyIcon,
  kitModule,
  lottieInfo,
  lottiePage,
  lottieSeconds,
  searchIconify,
  vendorPage,
  vendoredLicense,
  type BlockItem,
} from '../src/index';

/**
 * The network as `cuttle blocks` sees it, from a local server: CUTTLE_BLOCKS_PROXY sends every
 * request to `<server>/<host><path>`, and the server answers from `files` (404 otherwise).
 */
const files: Record<string, string | ((query: string) => string)> = {
  // HyperFrames' registry at a commit
  'api.github.com/repos/heygen-com/hyperframes/commits/main': JSON.stringify({ sha: 'abc123' }),
  'raw.githubusercontent.com/heygen-com/hyperframes/abc123/registry/registry.json': JSON.stringify({
    items: [
      { name: 'bar-chart-race', type: 'hyperframes:block' },
      { name: 'glitch', type: 'hyperframes:block' },
      { name: 'agent-cursor', type: 'hyperframes:component' },
    ],
  }),
  'raw.githubusercontent.com/heygen-com/hyperframes/abc123/registry/blocks/bar-chart-race/registry-item.json': JSON.stringify({
    title: 'Bar Chart Race',
    description: 'Ranked bars grow and overtake each other',
    tags: ['data', 'chart'],
    duration: 12,
    dimensions: { width: 1920, height: 1080 },
    files: [{ path: 'bar-chart-race.html', type: 'hyperframes:composition' }],
    variables: [
      { id: 'title', type: 'string', label: 'Title', default: 'Subscribers' },
      { id: 'bars', type: 'number', label: 'Bars', default: 6, min: 3, max: 12 },
      { id: 'accent', type: 'color', default: '#c8452d' },
    ],
  }),
  'raw.githubusercontent.com/heygen-com/hyperframes/abc123/registry/blocks/glitch/registry-item.json': JSON.stringify({
    title: 'Glitch',
    description: 'Shader transition with digital glitch artifacts',
    tags: ['transition', 'shader'],
    duration: 4,
    files: [
      { path: 'glitch.html', type: 'hyperframes:composition' },
      { path: 'assets/noise.png', type: 'hyperframes:asset' },
    ],
    preview: { poster: 'https://static.heygen.ai/catalog/glitch.png' },
  }),
  'raw.githubusercontent.com/heygen-com/hyperframes/abc123/registry/blocks/glitch/glitch.html': '<!doctype html><html><head></head><body>glitch</body></html>',
  'raw.githubusercontent.com/heygen-com/hyperframes/abc123/registry/blocks/glitch/assets/noise.png': 'PNG',
  // what pages load
  'cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js': 'window.gsap = {};',
  'fonts.googleapis.com/css2': (query) => `/* ${query} */ @font-face { font-family: 'Lato'; src: url(https://fonts.gstatic.com/s/lato/v24/lato.woff2) format('woff2'); }`,
  'fonts.gstatic.com/s/lato/v24/lato.woff2': 'WOFF2',
  'cdn.jsdelivr.net/npm/chart@1.0.0/+esm': 'import{a as b}from"/npm/helper@2.0.0/+esm";export*from"./part.js";export const chart=b;',
  'cdn.jsdelivr.net/npm/helper@2.0.0/+esm': 'export const a = 1;',
  'cdn.jsdelivr.net/npm/chart@1.0.0/part.js': 'export const part = 2;',
  'cdn.jsdelivr.net/images/hero.png': 'PNG',
  // Iconify
  'api.iconify.design/search': () => JSON.stringify({ icons: ['ph:rocket-launch', 'mdi:rocket'], collections: { ph: { name: 'Phosphor', license: { title: 'MIT', spdx: 'MIT', url: 'https://example.com/mit' }, author: { name: 'Phosphor Icons' } }, mdi: { name: 'Material Design Icons', license: { spdx: 'Apache-2.0' } } } }),
  'api.iconify.design/ph/rocket-launch.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path d="M0 0"/></svg>',
  'api.iconify.design/collections': () => JSON.stringify({ ph: { name: 'Phosphor', license: { spdx: 'MIT', url: 'https://example.com/mit' }, author: { name: 'Phosphor Icons' } } }),
};

let server: Server;
let cache: string;
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-blocks-'));
  dirs.push(dir);
  return dir;
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://local');
    const answer = files[url.pathname.slice(1)];
    if (answer === undefined) return void response.writeHead(404).end();
    response.writeHead(200).end(typeof answer === 'function' ? answer(url.search) : answer);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.CUTTLE_BLOCKS_PROXY = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cache = temp();
  process.env.CUTTLE_BLOCKS_CACHE = cache;
});
afterAll(async () => {
  delete process.env.CUTTLE_BLOCKS_PROXY;
  delete process.env.CUTTLE_BLOCKS_CACHE;
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('what blocks may load', () => {
  it('only from the collections and the CDNs their pages load from, over https', async () => {
    expect(allowedUrl('https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js')).toBe(true);
    expect(allowedUrl('http://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js')).toBe(false);
    expect(allowedUrl('https://evil.example/x.js')).toBe(false);
    await expect(fetchBytes('https://evil.example/x.js')).rejects.toMatchObject({ code: 'download' });
  });

  it("maps Three.js from a CDN to the kit's own, whatever the CDN's spelling", () => {
    expect(kitModule('https://cdn.jsdelivr.net/npm/three@0.184.0/+esm')).toBe('three');
    expect(kitModule('https://unpkg.com/three@0.160.1/build/three.module.js')).toBe('three');
    expect(kitModule('https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/FontLoader.js/+esm')).toBe('three/addons/loaders/FontLoader.js');
    expect(kitModule('https://cdn.jsdelivr.net/npm/gsap@3.14.2/+esm')).toBeUndefined();
  });
});

describe('vendorPage', () => {
  it('brings scripts, stylesheets with their fonts, url()s, images and module graphs into vendor/, and leaves the page\'s own paths alone', async () => {
    const dir = temp();
    const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Lato&display=block" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>@import url("https://fonts.googleapis.com/css2?family=Lato:wght@700"); .a { background: url(https://cdn.jsdelivr.net/images/hero.png) } .b { background: url(assets/local.png) }</style>
</head><body><img src="https://cdn.jsdelivr.net/images/hero.png"><a href="https://example.com/about">about</a>
<script type="module">
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.184.0/+esm";
import { chart } from "https://cdn.jsdelivr.net/npm/chart@1.0.0/+esm";
import { local } from "./local.js";
const other = "https://evil.example/data.json";
</script>
<script src="https://evil.example/tracker.js"></script>
</body></html>`;
    const { html: page, brought, left } = await vendorPage(html, dir);
    expect(page).not.toContain('preconnect');
    expect(page).toMatch(/<script src="vendor\/jsdelivr-npm-gsap-3\.14\.2-dist-gsap\.min-[0-9a-f]{8}\.js"><\/script>/);
    expect(page).toMatch(/href="vendor\/googleapis-css2-[0-9a-f]{8}\.css"/);
    expect(page).toContain('url("./jsdelivr-images-hero-');
    // the page's own files stay where they are
    expect(page).toContain('url(assets/local.png)');
    expect(page).toContain('from "./local.js"');
    expect(page).toContain('from "three"');
    expect(page).toMatch(/from "\.\/vendor\/jsdelivr-npm-chart-1\.0\.0-esm-[0-9a-f]{8}\.js"/);
    // a module's own imports come along, beside it
    const vendored = readdirSync(join(dir, 'vendor'));
    const chart = vendored.find((name) => name.startsWith('jsdelivr-npm-chart-1.0.0-esm'))!;
    const code = readFileSync(join(dir, 'vendor', chart), 'utf8');
    expect(code).toMatch(/from"\.\/jsdelivr-npm-helper-2\.0\.0-esm-[0-9a-f]{8}\.js"/);
    expect(code).toMatch(/export\*from"\.\/jsdelivr-npm-chart-1\.0\.0-part-[0-9a-f]{8}\.js"/);
    // the font a stylesheet names, beside it
    const sheet = vendored.find((name) => name.endsWith('.css'))!;
    expect(readFileSync(join(dir, 'vendor', sheet), 'utf8')).toMatch(/url\("\.\/gstatic-s-lato-v24-lato-[0-9a-f]{8}\.woff2"\)/);
    expect(brought.map((entry) => entry.url)).toContain('https://fonts.gstatic.com/s/lato/v24/lato.woff2');
    // a host blocks may not load from stays, and is said; a link to follow is no load
    expect(left).toEqual(['https://evil.example/tracker.js']);
  });
});

describe("HyperFrames' registry", () => {
  it('reads the blocks once (not the components), keeps them a day, and finds them by what they show', async () => {
    const catalog = await hyperframesCatalog();
    expect(catalog).toMatchObject({ source: 'hyperframes', ref: 'abc123' });
    expect(catalog.items.map((item) => item.name)).toEqual(['bar-chart-race', 'glitch']);
    expect(existsSync(join(cache, 'hyperframes.json'))).toBe(true);
    expect(findBlocks(catalog.items, ['chart']).map((item) => item.name)).toEqual(['bar-chart-race']);
    expect(findBlocks(catalog.items, ['shader']).map((item) => item.name)).toEqual(['glitch']);
    expect(findBlocks(catalog.items, ['chart', 'shader'])).toEqual([]);
    expect(findBlocks(catalog.items, [], { tag: 'transition' }).map((item) => item.name)).toEqual(['glitch']);
    expect(blockNamed(catalog, 'hyperframes:glitch').name).toBe('glitch');
    expect(() => blockNamed(catalog, 'chart-race')).toThrow(/no block "chart-race".*close: bar-chart-race/);
    // its files at the catalogue's commit, the page first
    const glitch = await blockFiles(catalog, blockNamed(catalog, 'glitch'));
    expect(glitch.map((file) => file.path)).toEqual(['glitch.html', 'assets/noise.png']);
  });

  it("makes a block's page a Cuttle page: its variables as params, handed over as HyperFrames' runtime would, its frame fitted", () => {
    const item: BlockItem = { name: 'bar-chart-race', title: 'Bar Chart Race', description: '', tags: [], duration: 12, width: 1920, height: 1080, files: ['bar-chart-race.html'], variables: [{ id: 'title', type: 'string', default: 'Subscribers' }, { id: 'bars', type: 'number', default: 6, min: 3, max: 12 }, { id: 'accent', type: 'color', default: '#c8452d' }, { id: 'mode', type: 'string', default: 'a', options: ['a', 'b'] }] };
    const page = adaptBlock('<!doctype html><html><head><title>x</title></head><body></body></html>', item);
    const params = JSON.parse(/id="cuttle-params">([^<]*)</.exec(page)![1]!) as Record<string, unknown>[];
    expect(params).toEqual([
      { name: 'title', label: 'title', type: 'text', default: 'Subscribers' },
      { name: 'bars', label: 'bars', type: 'number', default: 6, min: 3, max: 12 },
      { name: 'accent', label: 'accent', type: 'color', default: '#c8452d' },
      { name: 'mode', label: 'mode', type: 'select', default: 'a', options: ['a', 'b'] },
      { name: 'fit', label: 'Fit into the frame', type: 'select', default: 'contain', options: ['contain', 'cover'] },
    ]);
    expect(page).toContain('window.__hfVariables = Object.assign({}, params);');
    expect(page.indexOf('cuttle-params')).toBeGreaterThan(page.indexOf('<head>'));
    expect(page.indexOf('cuttle-params')).toBeLessThan(page.indexOf('<title>'));
  });
});

describe('Lottie', () => {
  const bounce = { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 400, h: 400, nm: 'Bounce', layers: [] };

  it('knows a Lottie animation and its length, and refuses what is none', () => {
    expect(lottieInfo(bounce, 'bounce.json')).toEqual({ fr: 30, ip: 0, op: 60, w: 400, h: 400, nm: 'Bounce' });
    expect(lottieSeconds(lottieInfo(bounce, 'bounce.json'))).toBe(2);
    expect(() => lottieInfo({ hello: 1 }, 'x.json')).toThrow(CoreError);
    expect(() => lottieInfo({ ...bounce, op: 0 }, 'x.json')).toThrow(/not a Lottie/);
  });

  it('plays it from a page beside it on the clock, with params to loop, speed and fit it', () => {
    const page = lottiePage(lottieInfo(bounce, 'bounce.json'), 'https://lottie.host/a/b.json');
    expect(page).toContain("fetch('./animation.json')");
    expect(page).toContain('goToAndStop(');
    expect((JSON.parse(/id="cuttle-params">\s*([^<]*?)\s*</.exec(page)![1]!) as { name: string }[]).map((param) => param.name)).toEqual(['fit', 'loop', 'speed', 'start']);
  });
});

describe('Iconify', () => {
  it('finds icons with their sets\' licences, and brings one as SVG', async () => {
    expect(await searchIconify(['rocket'])).toEqual([
      { name: 'icons:ph:rocket-launch', set: { name: 'Phosphor', license: 'MIT', licenseUrl: 'https://example.com/mit', author: 'Phosphor Icons' } },
      { name: 'icons:mdi:rocket', set: { name: 'Material Design Icons', license: 'Apache-2.0' } },
    ]);
    const icon = await iconifyIcon('icons:ph:rocket-launch');
    expect(icon.svg).toMatch(/^<svg/);
    expect(icon.set.license).toBe('MIT');
    await expect(iconifyIcon('icons:ph:../../x')).rejects.toMatchObject({ code: 'usage' });
  });
});

describe('credits', () => {
  it('keeps one entry per thing brought in, for programs and for people', async () => {
    const dir = temp();
    await addCredit(dir, { path: 'motion/glitch/', title: 'Glitch', source: "HyperFrames' registry", url: 'https://github.com/x', license: 'Apache-2.0', vendored: [{ url: 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js', license: vendoredLicense('https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js') }] });
    await addCredit(dir, { path: 'media/icons/ph-rocket.svg', title: 'ph:rocket', source: 'Iconify', url: 'https://x', license: 'MIT' });
    await addCredit(dir, { path: 'motion/glitch/', title: 'Glitch', source: "HyperFrames' registry", url: 'https://github.com/y', license: 'Apache-2.0' });
    const credits = (JSON.parse(readFileSync(join(dir, 'credits.json'), 'utf8')) as { credits: { path: string; url: string }[] }).credits;
    expect(credits.map((credit) => [credit.path, credit.url])).toEqual([['media/icons/ph-rocket.svg', 'https://x'], ['motion/glitch/', 'https://github.com/y']]);
    const people = readFileSync(join(dir, 'CREDITS.md'), 'utf8');
    expect(people).toContain('**Glitch** (`motion/glitch/`)');
    expect(vendoredLicense('https://fonts.gstatic.com/s/lato.woff2')).toMatch(/Open Font License/);
  });
});
