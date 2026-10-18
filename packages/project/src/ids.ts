/** The lists whose items carry ids, and the prefix of the ids Cuttle gives their new items. */
export const ID_PREFIXES = { scenes: 's', zooms: 'z', masks: 'm', texts: 't', overlays: 'o', cuts: 'c' } as const;

export type IdList = keyof typeof ID_PREFIXES;

/** The prefix of a new sound's id (`sounds`, which the editor does not list yet). */
export const SOUND_ID_PREFIX = 'a';

/** The ids a project's items use (its sounds' too); the project may be parsed or as written (unchecked). */
export function usedIds(project: Partial<Record<IdList | 'sounds', unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const list of [...(Object.keys(ID_PREFIXES) as IdList[]), 'sounds' as const]) {
    const items = project[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/** A new id for an item of `list`: its prefix and the smallest number not in `taken`, which it is added to. */
export function newId(list: IdList | 'sounds', taken: Set<string>): string {
  const prefix = list === 'sounds' ? SOUND_ID_PREFIX : ID_PREFIXES[list];
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}
