// What is new, from release notes written in Markdown: the lines a release video shows as cards.

/** A heading of the part that says what is new: "New in this version", "What's Changed", "Features", … */
const NEWS_HEADING = /\b(new|changed?|changes|features?|highlights?|added|improvements?)\b/i;

/** The longest a line may be on a card; a longer one ends in "…". */
const MOST_CHARACTERS = 60;

/**
 * What is new in release notes: their top-level bullets (under a heading such as "New in this
 * version" or GitHub's "What's Changed" when there is one), each the bold words it starts with or
 * else the whole bullet, without Markdown, links, "by @someone in …" or "(#12)"; at most `most`.
 */
export function newsOf(notes: string, most = 5): string[] {
  const lines = notes.split(/\r?\n/);
  const headings = lines.flatMap((line, at) => (/^#{1,6}\s/.test(line) ? [at] : []));
  const news = headings.find((at) => NEWS_HEADING.test(lines[at] ?? '') && !/contributor/i.test(lines[at] ?? ''));
  const part = news === undefined ? lines : lines.slice(news + 1, headings.find((at) => at > news) ?? lines.length);
  return part
    .map((line) => /^[-*+]\s+(.*)$/.exec(line)?.[1])
    .filter((bullet): bullet is string => bullet !== undefined)
    .map((bullet) => {
      const bold = /^\*\*(.+?)\*\*/.exec(bullet)?.[1] ?? /^__(.+?)__/.exec(bullet)?.[1];
      return (bold ?? bullet)
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\s+by @\S+(\s+in\s+\S+)?\s*$/, '')
        .replace(/\s+in\s+https?:\/\/\S+\s*$/, '')
        .replace(/\s*\(?#\d+\)?\s*$/, '')
        .replace(/[`*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[:.]$/, '');
    })
    .filter((line) => line !== '')
    .map((line) => (line.length > MOST_CHARACTERS ? `${line.slice(0, MOST_CHARACTERS - 1).trimEnd()}…` : line))
    .slice(0, most);
}
