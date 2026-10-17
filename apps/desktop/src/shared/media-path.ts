// Which file a cuttle-media:// request may read. Pure (the file system comes in as `realpath`), so
// the rules are tested on every platform: only files inside the project folder, after junctions and
// symbolic links are resolved, compared the way the platform's file system compares names.

export interface MediaPathOptions {
  /** The real path of the project folder (junctions resolved), absolute. */
  root: string;
  /** Resolves a path to its real path; throws when it does not exist. */
  realpath: (path: string) => string;
  /** `win32` and `darwin` compare names without case. */
  platform: NodeJS.Platform;
}

/**
 * The real path of the file that the URL path `pathname` (percent-encoded, starting with "/") names
 * inside the project, or undefined when it is not one: an empty, "." or ".." segment, a backslash,
 * colon or NUL in a segment, bad percent-encoding, a file that does not exist, or a real path that
 * leaves the folder (a junction or link pointing elsewhere).
 */
export function mediaFile(pathname: string, { root, realpath, platform }: MediaPathOptions): string | undefined {
  if (!pathname.startsWith('/')) return undefined;
  const segments: string[] = [];
  for (const raw of pathname.slice(1).split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[\\:\0]/.test(segment)) return undefined;
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const separator = platform === 'win32' ? '\\' : '/';
  const joined = [root.replace(/[\\/]+$/, ''), ...segments].join(separator);
  let real: string;
  try {
    real = realpath(joined);
  } catch {
    return undefined;
  }
  return isInside(real, root, platform) ? real : undefined;
}

/** Whether `path` lies inside the folder `root` (not the folder itself), both real absolute paths. */
export function isInside(path: string, root: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string) => {
    const unified = platform === 'win32' ? value.replaceAll('/', '\\') : value;
    return platform === 'win32' || platform === 'darwin' ? unified.toLowerCase() : unified;
  };
  const separator = platform === 'win32' ? '\\' : '/';
  const folder = fold(root).replace(/[\\/]+$/, '') + separator;
  return fold(path).startsWith(folder);
}

/** MIME types of the files the editor reads from a project. */
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.bin': 'application/octet-stream',
};

export function mediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && TYPES[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}
