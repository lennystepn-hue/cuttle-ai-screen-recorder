import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { capturePageCommand } from './commands/capture-page';
import { devices } from './commands/devices';
import { fitCommand } from './commands/fit';
import { frameCommand } from './commands/frame';
import { init } from './commands/init';
import { previewCommand } from './commands/preview';
import { recordCommand } from './commands/record';
import { recoverCommand } from './commands/recover';
import { renderCommand } from './commands/render';
import { suggestCommand } from './commands/suggest';
import { modelsDownloadCommand, modelsListCommand, modelsRemoveCommand } from './commands/models';
import { transcribeCommand } from './commands/transcribe';
import { transcriptCommand } from './commands/transcript';
import { CliError, EXIT, toCliError } from './errors';
import { createOutput, type Output, type Streams } from './output';

export const VERSION = '0.1.0';

const seconds = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('expected seconds, 0 or more');
  return parsed;
};
const positive = (value: string): number => {
  const parsed = seconds(value);
  if (parsed === 0) throw new InvalidArgumentError('expected more than 0 seconds');
  return parsed;
};
const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new InvalidArgumentError('expected a whole number, 0 or more');
  return parsed;
};
const pixels = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16_384) throw new InvalidArgumentError('expected whole pixels from 1 to 16384');
  return parsed;
};
const collect = (value: string, previous: number[] = []): number[] => [...previous, seconds(value)];

/** `--json` before a `--`: usage errors then answer in JSON too. */
const wantsJson = (argv: readonly string[]): boolean => {
  const end = argv.indexOf('--');
  return (end < 0 ? argv : argv.slice(0, end)).includes('--json');
};

/**
 * Ctrl+C (and SIGTERM, SIGBREAK) as an AbortSignal for the commands that can stop cleanly; a second
 * one exits at once. `dispose` removes the handlers.
 */
function interruptible(output: Output): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onSignal = () => {
    if (controller.signal.aborted) process.exit(EXIT.cancelled);
    output.info('stopping … (Ctrl+C again to quit at once)');
    controller.abort();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;
  for (const name of signals) process.on(name, onSignal);
  return { signal: controller.signal, dispose: () => signals.forEach((name) => process.off(name, onSignal)) };
}

/** Runs the CLI with `argv` (without node and the script); returns the exit code. */
export async function runCli(argv: readonly string[], streams?: Streams): Promise<number> {
  let exitCode: number = EXIT.ok;
  const program = new Command('cuttle')
    .description('Record a screen take and turn it into a polished demo video')
    .version(VERSION)
    .option('-C, --project <dir>', 'the project folder', '.')
    .option('--json', 'machine-readable output: one JSON document on stdout')
    .showHelpAfterError()
    .exitOverride();
  // With --json, help and version text become the JSON document (see the end), so stdout holds one.
  const json = wantsJson(argv);
  let shown = '';
  program.configureOutput({
    writeOut: json ? (text) => void (shown += text) : (streams?.stdout ?? ((text) => void process.stdout.write(text))),
    writeErr: streams?.stderr ?? ((text) => void process.stderr.write(text)),
  });

  /** Wraps a command's action: output with the global options, errors mapped to exit codes. */
  const action =
    <A extends unknown[]>(run: (output: Output, project: string, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const globals = program.opts<{ project: string; json?: boolean }>();
      const output = createOutput(globals.json ?? false, streams);
      try {
        await run(output, globals.project, ...args);
      } catch (error) {
        const failure = toCliError(error);
        output.error(failure);
        exitCode = failure.exitCode;
      }
    };
  const withSignal = async <T>(output: Output, body: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const interrupt = interruptible(output);
    try {
      return await body(interrupt.signal);
    } finally {
      interrupt.dispose();
    }
  };

  program
    .command('init [dir]')
    .description('create a project folder with a default cuttle.json')
    .action(action((output, project, dir?: string) => init(dir ?? project, output)));

  program
    .command('devices')
    .description('list monitors (index, size, position), windows, cameras and microphones')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(action((output, _project, options: { backend: 'auto' | 'test' }) => devices(options.backend, output)));

  program
    .command('record')
    .description('record a take into the project and use it')
    .option('--monitor <n>', 'monitor index from "cuttle devices" (default: the primary monitor)', integer)
    .option('--region <x,y,w,h...>', 'a region of the monitor in its pixels, e.g. 0,0,1920,1080')
    .option('--window <title>', 'a window, by (part of) its title')
    .option('--webcam [name]', 'record a webcam (default: the first one)')
    .option('--mic [name]', 'record a microphone (default: the first one)')
    .option('--until-claude [cwd]', 'stop when the Claude Code session in that folder (default: here) finishes its turn')
    .option('--until-file <path>', 'stop when this file appears')
    .option('--until-idle <seconds>', 'stop when the screen and the input rested this long', positive)
    .option('--max <seconds>', 'stop after this long', positive)
    .option('--countdown <seconds>', 'seconds before the recording starts (default 3)', seconds)
    .option('--draw-mouse', 'bake the real pointer into the video')
    .option('--force', 'record even when the project is open in the Cuttle app')
    .addOption(new Option('--backend <name>', 'capture backend').choices(['auto', 'test']).default('auto').hideHelp())
    .action(
      action((output, project, options: Parameters<typeof recordCommand>[1]) =>
        withSignal(output, (signal) => recordCommand(project, options, output, signal)),
      ),
    );

  program
    .command('suggest')
    .description('propose scenes (quiet start and end trimmed, idle cut, waiting sped up, cropped to the content), a zoom on the answer, zooms on dialogs, zooms that follow typing and zooms on clicks')
    .option('--claude [cwd]', "read Claude Code's transcript for a take without Claude markers (default: here)")
    .option('--no-zoom', 'no zooms (neither on the answer, nor on dialogs, nor on typing, nor on clicks)')
    .option('--no-crop', 'no crop to the content (a browser\'s page without its tabs and bars)')
    .option('--no-privacy', "no privacy masks (and the screen's text is not read)")
    .option('--mask <word>', 'mask this word wherever the screen shows it (a name, an address); kept in cuttle.json', (word: string, words: string[]) => [...words, word], [] as string[])
    .option('--no-dialog-zooms', 'no zooms on dialogs')
    .option('--no-typing-zooms', 'no zooms that follow typing')
    .option('--no-click-zooms', 'no zooms on clicks (the answer zoom stays)')
    .option('--no-speech', 'leave the speech out: no filler, pause or spoken retake cuts, and speech does not keep a stretch')
    .option('--no-transcribe', 'do not transcribe the mic first (when it has no transcript and a speech model is there)')
    .option('--length <seconds>', 'fit the video to this length: what rests is cut, never speech, clicks or typing', positive)
    .option('--dry-run', 'print the suggestion, leave cuttle.json as it is')
    .action(
      action((output, project, { mask, ...options }: { claude?: string | true; zoom: boolean; crop: boolean; privacy: boolean; mask: string[]; dialogZooms: boolean; typingZooms: boolean; clickZooms: boolean; speech: boolean; transcribe: boolean; length?: number; dryRun?: boolean }) =>
        suggestCommand(project, { ...options, ...(mask.length > 0 && { maskWords: mask }) }, output),
      ),
    );

  program
    .command('transcribe')
    .description("what the mic said, word by word, into the take's transcript.json (a speech model is needed: cuttle models)")
    .option('--model <name>', 'base, small or large-v3-turbo-q5_0 (default: small when downloaded)')
    .option('--language <code>', 'auto, de, en, … (default: auto)')
    .action(
      action((output, project, options: { model?: string; language?: string }) => withSignal(output, (signal) => transcribeCommand(project, options, output, signal))),
    );

  const models = program.command('models').description('the speech models for transcribe: list, download or remove them');
  models
    .command('list', { isDefault: true })
    .description('the models, and which are downloaded')
    .action(action((output) => modelsListCommand(output)));
  models
    .command('download <name>')
    .description('download a model once (base 148 MB, small 488 MB, large-v3-turbo-q5_0 574 MB), checked by its checksum')
    .action(action((output, _project, name: string) => withSignal(output, (signal) => modelsDownloadCommand(name, output, signal))));
  models
    .command('remove <name>')
    .description('remove a downloaded model')
    .action(action((output, _project, name: string) => modelsRemoveCommand(name, output)));

  program
    .command('preview')
    .description('PNG stills of the output, and a contact sheet')
    .option('--at <seconds...>', 'output times (default: 12 evenly spaced, with a sheet)', collect)
    .option('--sheet', 'also a contact sheet of the stills')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <dir>', 'folder for the PNGs (default: preview/ in the project)')
    .action(
      action((output, project, options: { at?: number[]; sheet?: boolean; format?: string; out?: string }) =>
        withSignal(output, (signal) => previewCommand(project, options, output, signal)),
      ),
    );

  program
    .command('capture-page <target>')
    .description('a web page (URL or file) as a PNG in stills/, optionally as a still scene')
    .option('--scroll', 'the whole page, shown as a scrolling still')
    .option('--width <px>', 'viewport width (default: the output width)', pixels)
    .option('--height <px>', 'viewport height (default: the output height)', pixels)
    .option('--name <name>', 'file name in stills/ (default: from the URL or file)')
    .option('--add', 'append a still scene that shows it')
    .option('--duration <seconds>', 'length of that scene (default 4)', positive)
    .option('--wait <ms>', 'wait after loading, for fonts and maps (default 1000)', integer)
    .action(
      action((output, project, target: string, options: Parameters<typeof capturePageCommand>[2]) =>
        withSignal(output, (signal) => capturePageCommand(project, target, options, output, signal)),
      ),
    );

  program
    .command('fit')
    .description('fit the video to a length after your edits: cut where it rests, never speech, clicks, typing, a zoom or a text (cuts tagged "length"; a new fit replaces them)')
    .argument('[seconds]', 'the length in seconds', positive)
    .option('--off', 'take the fit out: the full length again')
    .action(action((output, project, length: number | undefined, options: { off?: boolean }) => fitCommand(project, length, options.off === true, output)));

  program
    .command('frame')
    .description('a frame of the screen track at full size (the pixels masks and zooms use), optionally with a numbered grid')
    .argument('<seconds>', 'source seconds of the frame', seconds)
    .option('--grid', 'a pixel grid with numbers, every 100 px')
    .option('-o, --out <file>', 'PNG to write (default: frames/<seconds>s.png in the project)')
    .action(action((output, project, at: number, options: { grid?: boolean; out?: string }) => frameCommand(project, at, options, output)));

  program
    .command('render')
    .description('export the project as an MP4')
    .option('--format <format>', '16:9, 1:1 or 9:16 (default: the project output)')
    .option('-o, --out <file>', 'output file (default: out/<format>.mp4 in the project)')
    .addOption(new Option('--encoder <encoder>', 'H.264 encoder').choices(['auto', 'hardware', 'software']))
    .option('--no-captions', 'no captions burned in, whatever the project says')
    .option('--srt', 'also write the captions as <name>.srt next to the video')
    .option('--vtt', 'also write the captions as <name>.vtt next to the video')
    .action(
      action((output, project, options: { format?: string; out?: string; encoder?: string; captions: boolean; srt?: boolean; vtt?: boolean }) =>
        withSignal(output, (signal) => renderCommand(project, options, output, signal)),
      ),
    );

  program
    .command('transcript')
    .description('what the mic said (cuttle transcribe), with your fixes: as JSON, or as captions on the video\'s time')
    .option('--srt', 'the captions as SubRip')
    .option('--vtt', 'the captions as WebVTT')
    .option('--text', 'the words as plain text')
    .action(action((output, project, options: { srt?: boolean; vtt?: boolean; text?: boolean }) => transcriptCommand(project, options, output)));

  program
    .command('recover <take>')
    .description('make a take usable after a crash (e.g. takes/3) and use it')
    .action(action((output, project, take: string) => recoverCommand(project, take, output)));

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode === 0) {
      // --help or --version
      if (json) createOutput(true, streams).result(error.code === 'commander.version' ? { version: VERSION } : { help: shown }, () => '');
      return EXIT.ok;
    }
    // A usage error: commander already explained it on stderr; with --json stdout still gets one document.
    const message = error.code === 'commander.help' ? 'no command given ("cuttle --help" lists them)' : error.message.replace(/^error: /, '');
    if (json) createOutput(true, streams).error(new CliError('usage', message));
    return EXIT.usage;
  }
  return exitCode;
}
