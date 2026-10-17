// Paths written into the cuttle.cmd shim.

/** The user's folders a batch file names by their variable (cmd.exe expands them from its Unicode environment). */
const BATCH_VARIABLES = ['LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'ProgramFiles'];

/**
 * A path as a batch file can hold it. cmd.exe reads .cmd files in the console's code page, so only
 * ASCII is safe: a user folder at its start becomes its variable (`%LOCALAPPDATA%\…`), a `%` is
 * doubled. Undefined when letters outside ASCII are left (the shim then tries Windows' 8.3 name).
 */
export function batchPath(path: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  let prefix = '';
  let rest = path;
  for (const name of BATCH_VARIABLES) {
    const value = env[name];
    if (value && (rest.toLowerCase() === value.toLowerCase() || rest.toLowerCase().startsWith(`${value.toLowerCase()}\\`))) {
      prefix = `%${name}%`;
      rest = rest.slice(value.length);
      break;
    }
  }
  const safe = `${prefix}${rest.replaceAll('%', '%%')}`;
  return /^[\x20-\x7e]*$/.test(safe) ? safe : undefined;
}
