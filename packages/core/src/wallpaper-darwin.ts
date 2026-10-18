// macOS's wallpaper (see wallpaper.ts): the main display's desktop picture, by AppleScript.
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** macOS: the main display's desktop picture. */
export async function macWallpaper(): Promise<string | undefined> {
  const path = await run('osascript', ['-e', 'tell application "System Events" to get picture of current desktop']).then(
    ({ stdout }) => stdout.trim(),
    () => '',
  );
  return path && (await isFile(path)) ? path : undefined;
}
