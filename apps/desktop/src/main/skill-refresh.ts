// Whether the skill the app installed for Claude Code came with another version of the app, so the
// app installs it again after an update (tools.ts). Pure: the tests read it.

/**
 * A skill folder's marker (`.cuttle-skill.json`) the app wrote with another version than `version`,
 * or with none (before 0.3.5). The repository's install (`repo`, `pnpm skill:install`) and a marker
 * that is not the app's are never stale here: they are not the app's to replace.
 */
export function appSkillStale(marker: unknown, version: string): boolean {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
  const { app, version: installed } = marker as { app?: unknown; version?: unknown };
  return app === true && installed !== version;
}
