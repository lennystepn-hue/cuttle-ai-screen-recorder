import { commands } from 'vitest/browser';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from './gl-util';
import { renderScenario } from './run-scenario';
import { SCENARIOS } from './scenarios';

let assets: EngineAssets;

beforeAll(async () => {
  assets = await loadEngineAssets();
});

describe('golden images', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const pixels = await renderScenario(scenario, assets);
      const result = await commands.matchGolden(scenario.name, toBase64(pixels.data), pixels.width, pixels.height);
      expect(result.status).toBe('match');
    });
  }
});
