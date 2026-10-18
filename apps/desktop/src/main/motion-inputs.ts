// Which changes in a project's folder a motion page can see.

/** Folders of a project whose files no page reads: the exports, the previews, the editor's cache. */
const UNWATCHED = new Set(['out', 'preview', '.cuttle', '.git', 'node_modules']);

/** Whether a change to `name` (relative to the project folder) can change what a page draws. */
export function pageInput(name: string): boolean {
  const parts = name.split(/[\\/]/).filter(Boolean);
  const top = parts[0]?.toLowerCase();
  if (!top || UNWATCHED.has(top)) return false;
  // cuttle.json, its backups and its lock: the editor sends its project itself
  if (parts.length === 1 && /^cuttle\.json/i.test(top)) return false;
  // a take: its recordings are no page's, its events, words and markers are (cuttle.take)
  if (top === 'takes') return /\.(json|jsonl)$/i.test(parts.at(-1) ?? '');
  return true;
}
