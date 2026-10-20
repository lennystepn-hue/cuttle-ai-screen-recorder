// The processes whose windows are Cuttle's own: this one, and the app it runs in. The Cuttle app's
// recorder runs in a utility process of its own, so the app names its main process (the editor, the
// settings, the HUD) in CUTTLE_APP_PID. Their windows are never listed to pick, never the window in
// front, never a dialog over the take; the CLI has none of the app's, and this process's only.

/** The variable the Cuttle app sets for its recorder process: the pid of its main process. */
export const APP_PID_VARIABLE = 'CUTTLE_APP_PID';

/** `pid` and the app's pid from `env`, when it names one. Pure. */
export function ownPids(pid: number, env: Readonly<Record<string, string | undefined>>): ReadonlySet<number> {
  const app = Number(env[APP_PID_VARIABLE]);
  return new Set(Number.isInteger(app) && app > 0 ? [pid, app] : [pid]);
}

/** This process's own processes, read once. */
export const OWN_PIDS = ownPids(process.pid, process.env);
