import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { matchGolden } from './tools/vitest/golden-command.ts';

/**
 * The recorder's takes in real time (the test backend): beside a hundred other test files their
 * input and their timing come out short, so they run after them.
 */
const REALTIME = ['packages/recorder/test/record.test.ts'];
/**
 * Tests that transcribe with a real speech model (where one is downloaded): they keep the GPU and
 * the processor busy for many seconds, and beside them the recorder's takes in real time come out
 * short. They run after every other test, one file at a time.
 */
const HEAVY = ['packages/core/test/live.test.ts', 'packages/core/test/speech-take.test.ts'];
// No speech model unless a test asks for one: a take with a mic is never transcribed by chance; and
// no OCR, which reads the screen of every take (a test that reads asks for it).
const NODE_ENV = { CUTTLE_MODELS_DIR: join(tmpdir(), 'cuttle-test-no-models'), CUTTLE_OCR: 'off' };

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'skill/test/**/*.test.ts'],
          exclude: ['packages/*/test/**/*.browser.test.ts', ...REALTIME, ...HEAVY],
          env: NODE_ENV,
        },
      },
      {
        test: {
          name: 'realtime',
          environment: 'node',
          include: REALTIME,
          env: NODE_ENV,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'heavy',
          environment: 'node',
          include: HEAVY,
          env: NODE_ENV,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
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
            // Linux (CI) has no GPU: WebGL with Chromium's own software GL, as the CLI draws there
            provider: playwright(process.platform === 'linux' ? { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } : {}),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 720 },
            commands: { matchGolden },
          },
        },
      },
    ],
  },
});
