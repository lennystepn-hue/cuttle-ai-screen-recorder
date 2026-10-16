import { open, readFile, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The files one export page may touch: reads only from the job's sources (by absolute path), writes
 * only into the video-only output. Streams media by byte range, so multi-GB recordings never sit in
 * memory.
 */
export class FileHost {
  private readonly allowed: Set<string>;
  private readonly handles = new Map<string, Promise<FileHandle>>();
  private output: Promise<FileHandle> | undefined;

  constructor(
    readable: Iterable<string>,
    private readonly outputPath: string,
  ) {
    this.allowed = new Set([...readable].map((path) => resolve(path)));
  }

  private handle(path: string): Promise<FileHandle> {
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
    const handle = await this.handle(path);
    const buffer = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.handle(path); // allow-list check
    return readFile(resolve(path));
  }

  async write(data: Uint8Array, position: number): Promise<void> {
    this.output ??= open(this.outputPath, 'w');
    const handle = await this.output;
    let written = 0;
    while (written < data.byteLength) {
      const { bytesWritten } = await handle.write(data, written, data.byteLength - written, position + written);
      written += bytesWritten;
    }
  }

  async close(): Promise<void> {
    const all = [...this.handles.values(), ...(this.output ? [this.output] : [])];
    this.handles.clear();
    this.output = undefined;
    await Promise.allSettled(all.map(async (handle) => (await handle).close()));
  }
}
