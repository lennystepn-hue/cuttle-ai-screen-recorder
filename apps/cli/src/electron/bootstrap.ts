// Entry of the CLI's Electron process (dist/electron.mjs). It only installs the error handler and
// then loads the rest: an error while the bundle's modules load would otherwise show Electron's
// modal dialog instead of reaching the CLI.
import { failure, finish } from './finish';

// Electron's default for an uncaught exception is a modal dialog; a CLI must answer and exit instead.
process.on('uncaughtException', (error) => finish(failure(error), 1));
import('./main').catch((error: unknown) => finish(failure(error), 1));
