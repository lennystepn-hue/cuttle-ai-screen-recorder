import { describe, expect, it } from 'vitest';
import { chromiumSwitches } from '../src/electron-runner';

describe("Chromium's switches", () => {
  const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

  it('are none off Linux', () => {
    expect(chromiumSwitches(undefined)).toEqual([]);
  });

  it("draw with SwiftShader on Linux, and leave the sandbox out only where it cannot start", () => {
    expect(chromiumSwitches({ root: false, namespaces: true, helper: false })).toEqual(gl);
    expect(chromiumSwitches({ root: false, namespaces: false, helper: true })).toEqual(gl);
    // Ubuntu 24.04 without the setuid helper, and a container's root
    expect(chromiumSwitches({ root: false, namespaces: false, helper: false })).toEqual(['--no-sandbox', ...gl]);
    expect(chromiumSwitches({ root: true, namespaces: true, helper: true })).toEqual(['--no-sandbox', ...gl]);
  });
});
