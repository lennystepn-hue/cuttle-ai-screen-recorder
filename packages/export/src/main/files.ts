import { open, readFile, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Largest byte range the page may read at once (Mediabunny reads ~100 KB at a time). */
const MAX_READ_BYTES = 64 * 1024 * 1024;

/**
 * The files one export page may touch: reads only from the job's sources (by absolute path), whole
 * files only for its images, writes only into the video-only output. Streams media by byte range,
 * so multi-GB recordings never sit in memory. Arguments are checked: they come from the page.
 */
export class FileHost {
  private readonly allowed: Set<string>;
  private readonly images: Set<string>;
  private readonly handles = new Map<string, Promise<FileHandle>>();
  private output: Promise<FileHandle> | undefined;
  private closed = false;

  constructor(
    readable: Iterable<string>,
    private readonly outputPath: string,
    images: Iterable<string> = [],
  ) {
    this.images = new Set([...images].map((path) => resolve(path)));
    this.allowed = new Set([...readable, ...this.images].map((path) => resolve(path)));
  }

  private open(): void {
    if (this.closed) throw new Error('the export page used its files after they were closed');
  }

  private handle(path: string): Promise<FileHandle> {
    this.open();
    const key = resolve(path);
    if (!this.allowed.has(key)) throw new Error(`the export page asked for a file outside the job: ${path}`);
    let handle = this.handles.get(key);
    if (!handle) {
      handle = open(key, 'r');
      this.handles.set(key, handle);
    }
    return handle;
  }

  async size(path: string): Promise<number> {
    return (await (await this.handle(path)).stat()).size;
  }

  async read(path: string, start: number, end: number): Promise<Uint8Array> {
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end - start <= MAX_READ_BYTES)) {
      throw new Error(`the export page asked for an invalid byte range ${start}..${end} of ${path}`);
    }
    const handle = await this.handle(path);
    const buffer = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.open();
    const key = resolve(path);
    if (!this.images.has(key)) throw new Error(`the export page asked to read a file that is not an image of the job: ${path}`);
    return readFile(key);
  }

  async write(data: Uint8Array, position: number): Promise<void> {
    this.open();
    if (!(data instanceof Uint8Array) || !Number.isSafeInteger(position) || position < 0) {
      throw new Error(`the export page asked for an invalid write position ${position}`);
    }
    this.output ??= open(this.outputPath, 'w');
    const handle = await this.output;
    let written = 0;
    while (written < data.byteLength) {
      const { bytesWritten } = await handle.write(data, written, data.byteLength - written, position + written);
      written += bytesWritten;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.handles.values(), ...(this.output ? [this.output] : [])];
    this.handles.clear();
    this.output = undefined;
    await Promise.allSettled(all.map(async (handle) => (await handle).close()));
  }
}
