import { parseProject } from './parse';
import { CURRENT_VERSION, type CuttleProject } from './schema';

export function defaultProject(screen = 'takes/1/screen.mp4'): CuttleProject {
  const result = parseProject({ version: CURRENT_VERSION, sources: { screen } });
  if (!result.ok) throw new Error(`default project is invalid: ${JSON.stringify(result.issues)}`);
  return result.project;
}
