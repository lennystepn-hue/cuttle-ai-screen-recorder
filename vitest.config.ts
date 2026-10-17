import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts'],
        },
      },
      {
        // Pre-bundle dependencies the browser tests import; otherwise Vite optimizes them
        // mid-run and reloads the page ("Vite unexpectedly reloaded a test").
        optimizeDeps: { include: ['zod'] },
        test: {
          name: 'browser',
          include: ['packages/*/test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 720 },
            commands: { matchGolden },
          },
        },
      },
    ],
  },
});
