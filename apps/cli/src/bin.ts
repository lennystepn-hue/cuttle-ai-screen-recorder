// Entry of the bundled CLI (dist/cuttle.mjs), started by the cuttle shims.
import { runCli } from './main';

const code = await runCli(process.argv.slice(2));
process.exitCode = code;
// Exits when the work is done; a stray handle (a closed hook, a timer) must not keep the CLI alive.
setTimeout(() => process.exit(code), 2000).unref();
