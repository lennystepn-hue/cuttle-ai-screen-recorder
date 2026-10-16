import { loadEngineAssets, type EngineAssets } from '../src/assets';
import { toBase64 } from '../test/gl-util';
import { renderScenario } from '../test/run-scenario';
import { SCENARIOS } from '../test/scenarios';

export interface CheckResult {
  name: string;
  width: number;
  height: number;
  /** RGBA8, top row first, base64. */
  rgba: string;
}

declare global {
  interface Window {
    cuttleCheck: { names: string[]; render(index: number): Promise<CheckResult> };
  }
}

let assets: Promise<EngineAssets> | undefined;

window.cuttleCheck = {
  names: SCENARIOS.map((scenario) => scenario.name),
  async render(index) {
    assets ??= loadEngineAssets();
    const scenario = SCENARIOS[index];
    if (!scenario) throw new Error(`no scenario ${index}`);
    const pixels = await renderScenario(scenario, await assets);
    return { name: scenario.name, width: pixels.width, height: pixels.height, rgba: toBase64(pixels.data) };
  },
};
