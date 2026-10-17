// A project's takes as the take menu shows them: which may be deleted, and their sizes for people.

/**
 * The numbered take folders a person may delete (`takes/<n>`), newest first: every one but the take
 * the project uses now, whether or not its edit was kept for "Back to take".
 */
export function deletableTakes(names: readonly string[], current: string | undefined): string[] {
  return names.filter((name) => /^\d+$/.test(name) && name !== current).sort((a, b) => Number(b) - Number(a));
}

/** A folder's size for people: "820 KB", "142 MB", "1.4 GB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Where deleted takes go, named as the OS names it. */
export const trashName = (platform: NodeJS.Platform) => (platform === 'win32' ? 'Recycle Bin' : 'Trash');
