import { commands } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { pixelAt, readPixels, toBase64 } from './gl-util';

describe('browser test harness', () => {
  it('has WebGL2 and reads back exact pixels', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    expect(gl).not.toBeNull();
    gl!.clearColor(0.2, 0.4, 0.6, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    expect(pixelAt(readPixels(gl!), 3, 3)).toEqual([51, 102, 153, 255]);
  });

  it('compares a render with its golden', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })!;
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixels = readPixels(gl);
    const result = await commands.matchGolden('smoke-clear', toBase64(pixels.data), pixels.width, pixels.height);
    expect(result.status).toBe('match');
  });
});
