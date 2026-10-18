import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import { templatePage } from '@cuttle/motion-kit/files';
import type { Output } from '../output';
import { percentSteps } from './transcribe';

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up, speech kept), zooms on Claude's answer and the clicks, and cuts for filler words and
 * pauses, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus' | 'onProgress' | 'motionPage'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, {
    ...args,
    // a step title in a motion template (the script's `motion`): the kit's page next to the CLI
    motionPage: (template) => templatePage(projectDir, template, import.meta.url),
    onStatus: (text) => output.info(text),
    onProgress: percentSteps((percent) => output.info(`transcribing … ${percent} %`)),
  });
  output.result(result, () => {
    const clips = result.scenes.filter((scene): scene is { type: 'clip'; from: number; to: number; speed?: number } => scene.type === 'clip');
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...result.notes.map((note) => `- ${note}`),
      `${clips.length} clip${clips.length === 1 ? '' : 's'}, about ${seconds.toFixed(1)} s${result.zooms.length > 0 ? `, ${result.zooms.length} zoom${result.zooms.length === 1 ? '' : 's'}` : ''}`,
      result.written ? `written to ${result.project} (previous version: ${result.backup})` : '(dry run: cuttle.json unchanged)',
      'next: cuttle preview',
    ].join('\n');
  });
  return result;
}
