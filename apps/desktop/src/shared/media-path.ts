// Which file an app:// or cuttle-media:// request may read. Pure (the file system comes in as
// `realpath`), so the rules are tested on every platform: only files inside the folder, after
// junctions and symbolic links are resolved, compared the way the platform's file system compares names.

/**
 * The path that the URL path `pathname` (percent-encoded, starting with "/") names under `root`,
 * not resolved yet; undefined when a decoded segment is empty, "." or "..", or holds a "/", "\",
 * ":" or NUL (an encoded separator must not smuggle a ".." past this check), or when the encoding is bad.
 */
export function mediaCandidate(pathname: string, root: string, platform: NodeJS.Platform): string | undefined {
  if (!pathname.startsWith('/')) return undefined;
  const segments: string[] = [];
  for (const raw of pathname.slice(1).split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment)) return undefined;
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const separator = platform === 'win32' ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

export interface MediaPathOptions {
  /** The real path of the folder (junctions resolved), absolute. */
  root: string;
  /** Resolves a path to its real path; throws when it does not exist. */
  realpath: (path: string) => string;
  /** `win32` and `darwin` compare names without case. */
  platform: NodeJS.Platform;
}

/**
 * The real path of the file the URL path `pathname` names inside `root`, or undefined: a refused
 * segment (`mediaCandidate`), a file that does not exist, or a real path that leaves the folder (a
 * junction or link pointing elsewhere).
 */
export function mediaFile(pathname: string, { root, realpath, platform }: MediaPathOptions): string | undefined {
  const candidate = mediaCandidate(pathname, root, platform);
  if (candidate === undefined) return undefined;
  let real: string;
  try {
    real = realpath(candidate);
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
  // a brand's logo (shown in an <img>, where an SVG runs no script)
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.bin': 'application/octet-stream',
};

export function mediaType(path: string): string {
  const dot = path.lastIndexOf('.');
  return (dot >= 0 && TYPES[path.slice(dot).toLowerCase()]) || 'application/octet-stream';
}
