/**
 * The take a project's `sources` name, as a key: its tracks, not what was made from them. A
 * transcript linked to the take is not another take (the editor and its media stay).
 */
export function takeKey(sources: unknown): string {
  if (sources === null || typeof sources !== 'object') return JSON.stringify(sources);
  const { transcript: _made, ...tracks } = sources as Record<string, unknown>;
  return JSON.stringify(tracks);
}
