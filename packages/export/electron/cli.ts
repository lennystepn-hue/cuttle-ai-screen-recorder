// Development entry until apps/cli exists (M5):
//   pnpm export:run <projectDir> [--format 16:9|1:1|9:16] [-o <file>] [--encoder auto|hardware|software]
// Prints the result as JSON. Exit codes as in the spec: 1 usage or validation, 2 missing ffmpeg, 3 render.
import { join } from 'node:path';
import { app } from 'electron';
import { ExportError, exportProject, isExportFormat, type EncoderPreference, type ExportErrorCode, type ExportFormat } from '../src/index';

const EXIT_CODES: Record<ExportErrorCode, number> = {
  'invalid-project': 1,
  'missing-file': 1,
  'invalid-media': 1,
  'ffmpeg-missing': 2,
  render: 3,
};

const USAGE = 'usage: pnpm export:run <projectDir> [--format 16:9|1:1|9:16] [-o <file>] [--encoder auto|hardware|software]';

interface CliArgs {
  projectDir: string;
  format?: ExportFormat;
  out?: string;
  encoder: EncoderPreference;
}

/** The user's arguments: `electron [chromium switches] <script> <args>` keeps the switches in process.argv. */
function userArgs(): string[] {
  const args = process.argv.slice(1);
  if (process.defaultApp) args.splice(0, args.findIndex((arg) => !arg.startsWith('-')) + 1);
  return args;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const rest = [...argv];
  const args: Partial<CliArgs> & { encoder: EncoderPreference } = { encoder: 'auto' };
  while (rest.length > 0) {
    const arg = rest.shift()!;
    const value = (): string => {
      const next = rest.shift();
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--format') {
      const format = value();
      if (!isExportFormat(format)) throw new Error(`unknown format "${format}"`);
      args.format = format;
    } else if (arg === '-o' || arg === '--out') {
      args.out = value();
    } else if (arg === '--encoder') {
      const encoder = value();
      if (encoder !== 'auto' && encoder !== 'hardware' && encoder !== 'software') throw new Error(`unknown encoder "${encoder}"`);
      args.encoder = encoder;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else if (args.projectDir === undefined) {
      args.projectDir = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (args.projectDir === undefined) throw new Error('missing <projectDir>');
  return args as CliArgs;
}

// Electron's default for an uncaught exception is a modal dialog; a CLI must exit instead.
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(EXIT_CODES.render);
});
// The export window is the app's only window; closing it must not quit before the audio is muxed.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let args: CliArgs;
  try {
    args = parseArgs(userArgs());
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    app.exit(1);
    return;
  }
  const out = args.out ?? join(args.projectDir, 'out', `${(args.format ?? 'export').replace(':', 'x')}.mp4`);
  let lastPercent = -1;
  try {
    const result = await exportProject({
      projectDir: args.projectDir,
      format: args.format,
      out,
      encoder: args.encoder,
      onProgress(done, total) {
        const percent = Math.floor((done / total) * 100);
        if (percent !== lastPercent && percent % 10 === 0) console.error(`frames ${done}/${total}`);
        lastPercent = percent;
      },
    });
    console.log(JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    app.exit(error instanceof ExportError ? EXIT_CODES[error.code] : EXIT_CODES.render);
  }
});
