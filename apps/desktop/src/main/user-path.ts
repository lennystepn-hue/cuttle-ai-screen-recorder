// The PATH as Windows keeps it for programs started from now on, read and added to in the registry
// as it is stored. A user's Path is usually REG_EXPAND_SZ with entries like %USERPROFILE%\…: it is
// written back with its kind and its entries unexpanded (.NET's Environment API would expand them
// and store REG_SZ for good). PowerShell runs .NET's registry API; its output is UTF-8 (reg.exe's is
// in the console's code page, which mangles names like "Jürgen").
import { execFile } from 'node:child_process';

/** Runs a PowerShell script (values come in through the environment); its output, or why it failed. */
function powerShell(script: string, env: Record<string, string> = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const full = `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`;
  return new Promise((resolve) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full],
      { windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, ...env } },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) }),
    ),
  );
}

/** The machine's and the user's Path, expanded, as programs started now get them; empty when unreadable. */
export async function readPaths(): Promise<{ machine: string; user: string }> {
  const { ok, stdout } = await powerShell(
    [
      "$m = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')",
      "$u = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')",
      "@{ machine = $(if ($m) { [string]$m.GetValue('Path', '') } else { '' }); user = $(if ($u) { [string]$u.GetValue('Path', '') } else { '' }) } | ConvertTo-Json -Compress",
    ].join('; '),
  );
  if (!ok) return { machine: '', user: '' };
  try {
    const parsed = JSON.parse(stdout.trim()) as { machine?: string; user?: string };
    return { machine: parsed.machine ?? '', user: parsed.user ?? '' };
  } catch {
    return { machine: '', user: '' };
  }
}

/** Tells running programs (Explorer, which starts the terminals) that the environment changed. */
const BROADCAST = [
  "Add-Type -Namespace Cuttle -Name Native -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'",
  '$sent = [UIntPtr]::Zero',
  "[void][Cuttle.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$sent)",
].join('; ');

export interface PathPlace {
  /** The key under HKEY_CURRENT_USER (the user's environment: `Environment`). */
  key: string;
  value: string;
  /** Tell running programs (only for the real Path). */
  broadcast: boolean;
}

/**
 * Adds `dir` to the end of the user's Path (or another value, for the tests) unless an entry there
 * already names it once expanded. The value keeps its kind and its other entries as written; a new
 * value is REG_EXPAND_SZ. Answers whether it was added.
 */
export async function addToPath(dir: string, place: PathPlace = { key: 'Environment', value: 'Path', broadcast: true }): Promise<'added' | 'present'> {
  const script = [
    '$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($env:CUTTLE_REG_KEY)',
    '$name = $env:CUTTLE_REG_VALUE',
    '$add = $env:CUTTLE_ADD_PATH',
    '$exists = $k.GetValueNames() -contains $name',
    "$raw = if ($exists) { [string]$k.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }",
    '$kind = if ($exists) { $k.GetValueKind($name) } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }',
    "$parts = @($raw -split ';' | Where-Object { $_ -ne '' })",
    "foreach ($part in $parts) { if ([Environment]::ExpandEnvironmentVariables($part).TrimEnd('\\') -ieq $add.TrimEnd('\\')) { 'present'; exit 0 } }",
    "$k.SetValue($name, (($parts + $add) -join ';'), $kind)",
    ...(place.broadcast ? [BROADCAST] : []),
    "'added'",
  ].join('; ');
  const { ok, stdout, stderr } = await powerShell(script, { CUTTLE_REG_KEY: place.key, CUTTLE_REG_VALUE: place.value, CUTTLE_ADD_PATH: dir });
  const answer = stdout.trim().split(/\r?\n/).at(-1);
  if (!ok || (answer !== 'added' && answer !== 'present')) throw new Error(`${dir} could not be put on your PATH (${(stderr.trim().split(/\r?\n/)[0] ?? '') || 'PowerShell failed'})`);
  return answer;
}
