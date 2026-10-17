import { suggestProject, type SuggestOptions, type SuggestResult } from '@cuttle/core';
import type { Output } from '../output';

/**
 * `cuttle suggest`: scenes from the take (quiet start and end trimmed, idle stretches cut, waiting
 * sped up) and a zoom on Claude's answer, written to cuttle.json (see @cuttle/core's suggestProject).
 */
export async function suggestCommand(projectDir: string, args: Omit<SuggestOptions, 'onStatus'>, output: Output): Promise<SuggestResult> {
  const result = await suggestProject(projectDir, { ...args, onStatus: (text) => output.info(text) });
  output.result(result, () => {
    const clips = result.scenes.filter((scene): scene is { type: 'clip'; from: number; to: number; speed?: number } => scene.type === 'clip');
    const seconds = clips.reduce((sum, scene) => sum + (scene.to - scene.from) / (scene.speed ?? 1), 0);
    return [
      ...result.notes.map((note) => `- ${note}`),
      `${clips.length} clip(s), about ${seconds.toFixed(1)} s${result.zooms.length > 0 ? `, ${result.zooms.length} zoom${result.zooms.length === 1 ? '' : 's'}` : ''}`,
      result.written ? `written to ${result.project} (previous version: ${result.backup})` : '(dry run: cuttle.json unchanged)',
      'next: cuttle preview',
    ].join('\n');
  });
  return result;
}
