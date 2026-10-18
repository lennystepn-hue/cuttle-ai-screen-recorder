// The video's chapters in the MP4 itself, as ffmpeg reads them from a metadata file: players list
// them (VLC, QuickTime, `ffprobe -show_chapters`). YouTube reads its chapters from the description.
import type { Chapter } from '@cuttle/timeline';

/** A value in an ffmetadata file: `=`, `;`, `#`, `\` and line breaks escaped with a backslash. */
const escape = (value: string) => value.replace(/[=;#\\\n]/g, (char) => `\\${char}`);

/** The chapters as an ffmetadata file, in milliseconds. */
export function chapterMetadata(chapters: readonly Chapter[]): string {
  const ms = (seconds: number) => Math.round(seconds * 1000);
  return [';FFMETADATA1', ...chapters.flatMap((chapter) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${ms(chapter.at)}`, `END=${ms(chapter.end)}`, `title=${escape(chapter.title)}`]), ''].join('\n');
}
