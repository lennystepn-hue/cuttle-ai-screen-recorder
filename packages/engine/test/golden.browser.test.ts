import { commands } from 'vitest/browser';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from './gl-util';
import { renderScenario } from './run-scenario';
import { SCENARIOS, SPLIT_CHECKS } from './scenarios';

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

describe('continuous cuts', () => {
  for (const { whole, split } of SPLIT_CHECKS) {
    it(`renders a split clip exactly like the whole clip at ${whole.t} s`, async () => {
      const [a, b] = [await renderScenario(whole, assets), await renderScenario(split, assets)];
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      expect(b.data.findIndex((value, i) => value !== a.data[i])).toBe(-1);
    });
  }
});
