import type { CliError } from './errors';

/**
 * Where a command reports: with `--json`, stdout carries exactly one JSON document (the result, or
 * `{ "error": { code, message } }`) and everything else goes to stderr; without it, stdout gets text
 * for people. Progress and live status always go to stderr.
 */
export interface Output {
  json: boolean;
  /** The command's result: `value` as JSON, or `text()` for people. */
  result(value: unknown, text: () => string): void;
  /** Status for people while a command runs (stderr; quiet with --json unless it is a warning). */
  info(text: string): void;
  warn(text: string): void;
  error(error: CliError): void;
}

export interface Streams {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Each status line for people (`info`), also with --json: what `cuttle mcp` reports as progress. */
  progress?: (text: string) => void;
}

const processStreams: Streams = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

export function createOutput(json: boolean, streams: Streams = processStreams): Output {
  return {
    json,
    result(value, text) {
      streams.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${text()}\n`);
    },
    info(text) {
      if (!json) streams.stderr(`${text}\n`);
      streams.progress?.(text);
    },
    warn(text) {
      streams.stderr(`warning: ${text}\n`);
    },
    error(error) {
      if (json) streams.stdout(`${JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2)}\n`);
      else streams.stderr(`error: ${error.message}\n`);
      // An unexpected failure: its stack helps a bug report and stays out of the JSON.
      if (error.code === 'internal' && error.cause instanceof Error && error.cause.stack) streams.stderr(`${error.cause.stack}\n`);
    },
  };
}
