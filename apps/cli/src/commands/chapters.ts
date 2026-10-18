import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readProjectFile } from '@cuttle/core';
import { parseMarkersJson } from '@cuttle/project';
import { sceneSpans, stepChapters, youtubeChapters, type Chapter } from '@cuttle/timeline';
import type { Output } from '../output';

export interface ChaptersView {
  /** Output seconds, as the export writes them into the video file. */
  chapters: Chapter[];
  /** The lines for a YouTube description (`0:00 Open the settings`). */
  youtube: string;
  /** Why YouTube would not show them: fewer than three, or one shorter than 10 s. */
  problems: string[];
}

/**
 * `cuttle chapters`: the video's chapters from the script's steps (where the take reached each one),
 * as the export writes them into the MP4, and as lines for a YouTube description.
 */
export async function chaptersCommand(projectDir: string, output: Output): Promise<ChaptersView> {
  const file = await readProjectFile(projectDir);
  const { script, sources, scenes, cuts } = file.project;
  const text = sources.markers === undefined ? undefined : await readFile(resolve(file.dir, sources.markers), 'utf8').catch(() => undefined);
  const parsed = text === undefined ? undefined : parseMarkersJson(text);
  const chapters = stepChapters(script, parsed?.ok ? parsed.markers : [], sceneSpans(scenes, cuts));
  const { text: youtube, problems } = youtubeChapters(chapters);
  const view: ChaptersView = { chapters, youtube, problems };
  output.result(view, () => {
    if (chapters.length > 0) return [youtube, ...problems.map((problem) => `note: ${problem}`)].join('\n');
    return script.length === 0 ? 'no chapters: the project has no script ("script" in cuttle.json)' : "no chapters: the take reached none of the script's steps (record a take with the script)";
  });
  return view;
}
