import { describe, expect, it } from 'vitest';
import { isInside, mediaFile, mediaType } from '../src/shared/media-path';
import { parseRange } from '../src/shared/range';

/** A fake file system: the files that exist, and junctions (a folder that really lies elsewhere). */
function windowsFs(files: string[], junctions: Record<string, string> = {}) {
  return (path: string): string => {
    let real = path;
    for (const [from, to] of Object.entries(junctions)) {
      if (real.toLowerCase().startsWith(from.toLowerCase())) real = to + real.slice(from.length);
    }
    if (!files.some((file) => file.toLowerCase() === real.toLowerCase())) throw new Error('ENOENT');
    return real;
  };
}

describe('mediaFile', () => {
  const root = 'C:\\Users\\me\\demo';
  const files = ['C:\\Users\\me\\demo\\takes\\1\\screen.mp4', 'C:\\Users\\me\\demo\\stills\\a page.png', 'C:\\Users\\me\\secret.txt', 'D:\\elsewhere\\x.mp4'];
  const options = { root, realpath: windowsFs(files, { 'C:\\Users\\me\\demo\\linked': 'D:\\elsewhere' }), platform: 'win32' as const };

  it('names files inside the project, decoded', () => {
    expect(mediaFile('/takes/1/screen.mp4', options)).toBe('C:\\Users\\me\\demo\\takes\\1\\screen.mp4');
    expect(mediaFile('/stills/a%20page.png', options)).toBe('C:\\Users\\me\\demo\\stills\\a page.png');
  });

  it('refuses dot segments, encoded or not, and separators, colons or NUL inside a segment', () => {
    for (const path of ['/../secret.txt', '/takes/../../secret.txt', '/%2e%2e/secret.txt', '/takes/%2E%2E/%2e%2e/secret.txt', '/.%2fsecret.txt', '/..%5csecret.txt', '/C:%5cUsers%5cme%5csecret.txt', '/takes%00/1', '/takes//1/screen.mp4', '/']) {
      expect(mediaFile(path, options), path).toBeUndefined();
    }
  });

  it('refuses a file that a junction places outside the project, bad encoding and missing files', () => {
    expect(mediaFile('/linked/x.mp4', options)).toBeUndefined();
    expect(mediaFile('/takes/%E0%A4%A/screen.mp4', options)).toBeUndefined();
    expect(mediaFile('/takes/2/screen.mp4', options)).toBeUndefined();
    expect(mediaFile('takes/1/screen.mp4', options)).toBeUndefined();
  });

  it('compares names without case on Windows and macOS, with case on Linux', () => {
    expect(isInside('c:\\users\\ME\\DEMO\\takes\\1\\screen.mp4', root, 'win32')).toBe(true);
    expect(isInside('C:\\Users\\me\\demo-other\\x.mp4', root, 'win32')).toBe(false);
    expect(isInside('C:\\Users\\me\\demo', root, 'win32')).toBe(false);
    expect(isInside('/Users/me/Demo/x.mp4', '/Users/me/demo', 'darwin')).toBe(true);
    expect(isInside('/home/me/Demo/x.mp4', '/home/me/demo', 'linux')).toBe(false);
    expect(isInside('/home/me/demo/x.mp4', '/home/me/demo/', 'linux')).toBe(true);
  });

  it('serves the media types the editor reads', () => {
    expect(['a.mp4', 'b.M4A', 'c.png', 'd.jsonl', 'e.bin', 'f.exe'].map(mediaType)).toEqual([
      'video/mp4',
      'audio/mp4',
      'image/png',
      'application/x-ndjson',
      'application/octet-stream',
      'application/octet-stream',
    ]);
  });
});

describe('parseRange', () => {
  it('reads one byte range, an open end and a suffix, cut to the file', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=990-2000', 1000)).toEqual({ start: 990, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('serves the whole file for no header or one it ignores, and refuses a start past the end', () => {
    for (const header of [null, undefined, '', 'items=0-1', 'bytes=0-1,5-9', 'bytes=-', 'bytes=50-10']) expect(parseRange(header, 1000), String(header)).toBeUndefined();
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
