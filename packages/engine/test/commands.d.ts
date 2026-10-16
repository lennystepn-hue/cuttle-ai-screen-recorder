import type { GoldenOptions, GoldenResult } from '../../../tools/vitest/golden-types';

declare module 'vitest/browser' {
  interface BrowserCommands {
    matchGolden: (name: string, rgbaBase64: string, width: number, height: number, opts?: GoldenOptions) => Promise<GoldenResult>;
  }
}
