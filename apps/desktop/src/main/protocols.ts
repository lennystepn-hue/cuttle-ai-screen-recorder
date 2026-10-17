import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { isInside, mediaCandidate, mediaFile, mediaType } from '../shared/media-path';
import { parseRange } from '../shared/range';

/** The app's own pages: `app://cuttle/editor.html`, so a CSP's 'self' means the app. */
export const APP_ORIGIN = 'app://cuttle';

/**
 * The pages' content security policy: scripts and styles only from the app, media and images also
 * from the project (cuttle-media:), nothing from the network.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: cuttle-media:",
  "media-src 'self' blob: cuttle-media:",
  "connect-src 'self' cuttle-media: data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'cuttle-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

const notFound = (headers: Record<string, string> = {}) => new Response('not found', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain' } });

/** The app's pages read media from another origin (cuttle-media: from app:), so the answers allow them. */
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

/** The schemes each session serves already: a handler can be registered only once per session. */
const served = new WeakMap<Session, Set<string>>();
function first(session: Session, scheme: string): boolean {
  const schemes = served.get(session) ?? new Set<string>();
  served.set(session, schemes);
  if (schemes.has(scheme)) return false;
  schemes.add(scheme);
  return true;
}

/**
 * Serves the renderer's built files (`rendererDir`, which may lie inside the app's asar archive) as
 * `app://cuttle/…` in `session`, HTML with the CSP. Once per session.
 */
export function serveApp(session: Session, rendererDir: string): void {
  if (!first(session, 'app')) return;
  // The app's own folder holds no junctions and the asar archive has no real paths to resolve, so
  // the path is resolved by name; no segment can carry a separator past mediaCandidate.
  const options = { root: resolve(rendererDir), realpath: (path: string) => resolve(path), platform: process.platform };
  session.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'cuttle') return notFound();
    const file = mediaFile(url.pathname, options);
    if (!file) return notFound();
    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound();
    }
    if (!file.endsWith('.html')) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Serves files inside the project folder `projectDir` as `cuttle-media://project/<path>` in
 * `session` (one session per project, so a window reaches only its own project), with Range
 * requests for the video demuxer. Paths are checked after junctions are resolved, without blocking
 * the main process on a slow (synced or network) folder. Once per session.
 */
export async function serveMedia(session: Session, projectDir: string): Promise<void> {
  if (!first(session, 'cuttle-media')) return;
  const root = await realpath(projectDir);
  session.protocol.handle('cuttle-media', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'project') return notFound(CORS);
    const candidate = mediaCandidate(url.pathname, root, process.platform);
    const file = candidate === undefined ? undefined : await realpath(candidate).catch(() => undefined);
    if (!file || !isInside(file, root, process.platform)) return notFound(CORS);
    let size: number;
    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound(CORS);
      size = info.size;
    } catch {
      return notFound(CORS);
    }
    const headers: Record<string, string> = { ...CORS, 'Content-Type': mediaType(file), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (size === 0) return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
    headers['Content-Length'] = String(end - start + 1);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}

/** An image of the app (icons): `assets/<name>` next to `dist/`. */
export function assetPath(name: string): string {
  return fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
}

/** A file of the app's bundle: `dist/<parts>` (the main bundle lives in dist/main/). */
export function bundlePath(...parts: string[]): string {
  return join(fileURLToPath(new URL('../', import.meta.url)), ...parts);
}
