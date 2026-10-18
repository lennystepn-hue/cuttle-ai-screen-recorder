// macOS's wallpaper (see wallpaper.ts): the main display's desktop picture as NSWorkspace names it,
// through JavaScript for Automation (no app is controlled, so macOS asks for nothing; System Events'
// "picture of current desktop" says "missing value" for macOS's own pictures). Those are HEIC, which
// a background cannot be: they are converted to a JPEG with sips first.
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

const DESKTOP_PICTURE = 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen($.NSScreen.mainScreen).path.js';

/** macOS: the main display's desktop picture (a JPEG in the temporary folder for a HEIC one). */
export async function macWallpaper(): Promise<string | undefined> {
  const path = await run('osascript', ['-l', 'JavaScript', '-e', DESKTOP_PICTURE]).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  );
  if (!path || !(await isFile(path))) return undefined;
  if (!/\.hei[cf]$/i.test(path)) return path;
  const jpeg = join(tmpdir(), 'cuttle-wallpaper.jpg');
  return run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', path, '--out', jpeg]).then(
    () => jpeg,
    () => undefined,
  );
}
