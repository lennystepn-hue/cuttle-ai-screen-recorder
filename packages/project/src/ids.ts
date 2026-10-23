/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', annotations: 'n', overlays: 'o', cuts: 'c', sounds: 'a' } as const;

export type IdList = keyof typeof ID_PREFIXES;

/** The prefix of the ids Cuttle gives the narration's new lines (`voiceover.lines`). */
export const LINE_ID_PREFIX = 'v';

/** The ids a project's items use, its script's steps' and its narration's lines' too; the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList | 'script' | 'voiceover', unknown>>): Set<string> {
  const ids = new Set<string>();
  const lines = (project.voiceover as { lines?: unknown } | undefined)?.lines;
  for (const items of [...[...(Object.keys(ID_PREFIXES) as IdList[]), 'script' as const].map((list) => project[list]), lines]) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/** A new id for an item of `list` (`voiceover` for a line of the narration): its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList | 'voiceover', taken: Set<string>): string {
  const prefix = list === 'voiceover' ? LINE_ID_PREFIX : ID_PREFIXES[list];
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}
