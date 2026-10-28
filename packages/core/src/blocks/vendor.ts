// Brings what a page loads from the network into its folder (`vendor/`), so it renders without the
// network and the same every time: classic scripts, stylesheets (Google Fonts' CSS with its font
// files), the url()s of its CSS, images, and ES modules, Three.js mapped to the kit's own and any
// other module graph downloaded file by file. What it cannot bring stays as it is, and is said.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allowedUrl, fetchBytes, fetchText, fileNameOf } from './net';

/** At most this many files of a page's module graph. */
const MAX_MODULES = 80;

export interface Vendored {
  /** The page as it is in the project: every URL it brought rewritten to its file in `vendor/`. */
  html: string;
  /** The URLs it brought, and the file of each (from the page's folder). */
  brought: { url: string; file: string }[];
  /** The network URLs still in the page: they load only with the item's `network` on. */
  left: string[];
}

/**
 * The kit's own copy of a module a page loads from a CDN, as the page's import map names it: Three.js
 * (`three`, `three/addons/…`), which every motion page already has.
 */
export function kitModule(url: string): string | undefined {
  const three = /^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com|esm\.sh)\/three@0\.\d+(?:\.\d+)?(\/.*)?$/.exec(url);
  if (!three) return undefined;
  const rest = three[1] ?? '';
  if (rest === '' || rest === '/' || rest === '/+esm' || /^\/build\/three\.module(?:\.min)?\.js$/.test(rest)) return 'three';
  const addon = /^\/examples\/jsm\/(.+?\.js)(?:\/\+esm)?$/.exec(rest);
  return addon ? `three/addons/${addon[1]}` : undefined;
}

/**
 * `spec` from `base`: a URL, an absolute path on its host, or relative; a bare name stays bare (the
 * import map's). Without a base (the page's own code) only a URL counts: a path is the project's file.
 */
const resolveFrom = (spec: string, base: string | null): string | undefined => {
  if (/^https?:\/\//.test(spec)) return spec;
  if (base === null) return undefined;
  return /^\/\/|^\.{0,2}\//.test(spec) ? new URL(spec, base).href : undefined;
};

/** A brought file's extension, from its URL (or what it is). */
const extensionOf = (url: string, fallback: string) => /\.(m?js|css|woff2?|ttf|otf|json|png|jpe?g|svg|webp|gif)(?:$|\?)/i.exec(new URL(url).pathname)?.[0].replace('?', '') ?? fallback;

/** Brings what the page at `dir/<page>` loads into `dir/vendor/`; `html` is the page's text. */
export async function vendorPage(html: string, dir: string, signal?: AbortSignal): Promise<Vendored> {
  const vendor = join(dir, 'vendor');
  const brought = new Map<string, string>();
  const write = async (url: string, name: string, data: string | Uint8Array) => {
    await mkdir(vendor, { recursive: true });
    await writeFile(join(vendor, name), data);
    brought.set(url, `vendor/${name}`);
    return name;
  };
  /** A file at `url` in vendor/ (once), its name there. */
  const file = async (url: string, fallback: string): Promise<string> => {
    const known = brought.get(url);
    if (known) return known.slice('vendor/'.length);
    return write(url, fileNameOf(url, extensionOf(url, fallback)), await fetchBytes(url, signal));
  };
  /** CSS with each url() it names brought beside it. */
  const css = async (text: string, base: string | null): Promise<string> => {
    let out = text;
    for (const match of [...text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g)]) {
      const url = resolveFrom(match[1]!, base);
      if (!url || !allowedUrl(url)) continue;
      out = out.replace(match[0], `@import url("${await sheet(url)}")`);
    }
    for (const match of [...out.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]) {
      if (/^(data:|#|vendor\/|\.\/)/.test(match[1]!) || match[1]!.endsWith('.css')) continue;
      const url = resolveFrom(match[1]!, base);
      if (!url || !allowedUrl(url)) continue;
      out = out.replace(match[0], `url("./${await file(url, '.bin')}")`);
    }
    return out;
  };
  /** A stylesheet at `url` in vendor/, its name there. */
  const sheet = async (url: string): Promise<string> => {
    const known = brought.get(url);
    if (known) return `./${known.slice('vendor/'.length)}`;
    return `./${await write(url, fileNameOf(url, '.css'), await css(await fetchText(url, signal), url))}`;
  };
  /** A module at `url` and the modules it imports in vendor/, as the specifier to load it by from vendor/. */
  const modules = new Map<string, string>();
  const module = async (url: string): Promise<string> => {
    const kit = kitModule(url);
    if (kit) return kit;
    const known = modules.get(url);
    if (known) return known;
    if (modules.size >= MAX_MODULES) throw new Error(`more than ${MAX_MODULES} modules`);
    const name = fileNameOf(url, '.js');
    modules.set(url, `./${name}`);
    let text = await fetchText(url, signal);
    text = await rewriteImports(text, url, module);
    await write(url, name, text);
    return `./${name}`;
  };

  let page = html.replace(/<link\b[^>]*\brel=["']?(?:preconnect|dns-prefetch)["']?[^>]*>\s*/gi, '');
  // stylesheets and scripts by URL
  for (const match of [...page.matchAll(/<link\b[^>]*\bhref=["'](https:[^"']+)["'][^>]*>/gi)]) {
    if (!/\brel=["']?stylesheet/i.test(match[0]) || !allowedUrl(match[1]!)) continue;
    page = page.replace(match[0], match[0].replace(match[1]!, `vendor/${(await sheet(match[1]!)).slice(2)}`));
  }
  for (const match of [...page.matchAll(/<script\b([^>]*)\bsrc=["'](https:[^"']+)["']([^>]*)>/gi)]) {
    const url = match[2]!;
    if (!allowedUrl(url)) continue;
    const isModule = /\btype=["']?module/i.test(match[1]! + match[3]!);
    const target = isModule ? (await module(url)).replace(/^\.\//, 'vendor/') : `vendor/${await file(url, '.js')}`;
    page = page.replace(match[0], match[0].replace(url, target));
  }
  // inline styles and modules
  for (const match of [...page.matchAll(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi)]) {
    page = page.replace(match[0], `${match[1]}${await css(match[2]!, null)}${match[3]}`);
  }
  for (const match of [...page.matchAll(/(<script\b[^>]*\btype=["']?module["']?[^>]*>)([\s\S]*?)(<\/script>)/gi)]) {
    const code = await rewriteImports(match[2]!, null, async (url) => (await module(url)).replace(/^\.\//, './vendor/'));
    page = page.replace(match[0], `${match[1]}${code}${match[3]}`);
  }
  // images and media
  for (const match of [...page.matchAll(/<(?:img|source|video|audio)\b[^>]*\bsrc=["'](https:[^"']+)["'][^>]*>/gi)]) {
    if (!allowedUrl(match[1]!)) continue;
    page = page.replace(match[0], match[0].replace(match[1]!, `vendor/${await file(match[1]!, '.bin')}`));
  }
  // what still loads from the network (a link to follow is no load)
  const loads = page.replace(/<a\b[^>]*>/gi, '');
  const left = [...new Set([...loads.matchAll(/\b(?:src|href)=["'](https?:[^"']+)["']|url\(\s*["']?(https?:[^"')]+)|from\s*["'](https?:[^"']+)["']/gi)].map((match) => match[1] ?? match[2] ?? match[3]!))];
  return { html: page, brought: [...brought].map(([url, path]) => ({ url, file: path })), left };
}

/** `code` with each module it imports from the network (static, re-exported or dynamic) loaded by what `load` answers. */
async function rewriteImports(code: string, base: string | null, load: (url: string) => Promise<string>): Promise<string> {
  const pattern = /(\b(?:import|export)\b[^"'`;]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\n]+)\2/g;
  let out = '';
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const url = resolveFrom(match[3]!, base);
    if (!url || !/^https:/.test(url)) continue;
    out += code.slice(last, match.index) + match[1] + match[2] + (allowedUrl(url) || kitModule(url) ? await load(url) : match[3]) + match[2];
    last = match.index! + match[0].length;
  }
  return out + code.slice(last);
}
