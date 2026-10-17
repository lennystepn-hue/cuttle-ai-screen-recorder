import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliError } from '../errors';
import type { Output } from '../output';
import { newProjectFile, projectExists, PROJECT_FILE, writeProjectFile } from '../project-file';

export interface InitResult {
  project: string;
}

/** `cuttle init [dir]`: a project folder with a default cuttle.json that records into takes/1. */
export async function init(dir: string, output: Output): Promise<InitResult> {
  const target = resolve(dir);
  if (projectExists(target)) throw new CliError('usage', `${target} already has a ${PROJECT_FILE}`);
  await mkdir(target, { recursive: true });
  const file = await writeProjectFile(newProjectFile(target));
  const result = { project: file.path };
  output.result(result, () => `created ${file.path}\nnext: cuttle record (in that folder)`);
  return result;
}
