import { describe, expect, it } from 'vitest';
import { chromiumSwitches } from '../src/electron-runner';

describe("Chromium's switches", () => {
  const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

  it('are none off Linux', () => {
    expect(chromiumSwitches(undefined)).toEqual([]);
  });

  const memory = 8 * 1024 ** 3;

  it("draw with SwiftShader on Linux, and leave the sandbox out only where it cannot start", () => {
    expect(chromiumSwitches({ root: false, namespaces: true, helper: false, sharedMemory: memory })).toEqual(gl);
    expect(chromiumSwitches({ root: false, namespaces: false, helper: true, sharedMemory: memory })).toEqual(gl);
    // Ubuntu 24.04 without the setuid helper, and a container's root
    expect(chromiumSwitches({ root: false, namespaces: false, helper: false, sharedMemory: memory })).toEqual(['--no-sandbox', ...gl]);
    expect(chromiumSwitches({ root: true, namespaces: true, helper: true, sharedMemory: memory })).toEqual(['--no-sandbox', ...gl]);
  });

  it("keep Chromium's frames out of a container's small shared memory", () => {
    expect(chromiumSwitches({ root: true, namespaces: false, helper: false, sharedMemory: 64 * 1024 ** 2 })).toEqual(['--no-sandbox', '--disable-dev-shm-usage', ...gl]);
  });
});
