/** Byte range of a file to send: `start` and `end` inclusive, as in a Content-Range header. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The range a `Range` header asks for in a file of `size` bytes: undefined for the whole file (no
 * header, another unit, several ranges, or a header that does not parse, which servers may ignore),
 * `'unsatisfiable'` for a range that starts past the end (answered with 416). Supports `bytes=a-b`,
 * `bytes=a-` and `bytes=-n` (the last n bytes); an end past the file is cut to the file.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, first, last] = match;
  if (first === '' && last === '') return undefined;
  if (first === '') {
    const length = Number(last);
    if (length === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return undefined;
  return { start, end };
}
