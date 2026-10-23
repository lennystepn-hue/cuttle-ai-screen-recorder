import { describe, expect, it } from 'vitest';
import { sandboxSwitches } from '../src/electron-runner';

describe("Chromium's sandbox", () => {
  it('stays on except on a Linux where it cannot start', () => {
    expect(sandboxSwitches(undefined)).toEqual([]);
    expect(sandboxSwitches({ root: false, namespaces: true, helper: false })).toEqual([]);
    expect(sandboxSwitches({ root: false, namespaces: false, helper: true })).toEqual([]);
    // Ubuntu 24.04 without the setuid helper, and a container's root
    expect(sandboxSwitches({ root: false, namespaces: false, helper: false })).toEqual(['--no-sandbox']);
    expect(sandboxSwitches({ root: true, namespaces: true, helper: true })).toEqual(['--no-sandbox']);
  });
});
