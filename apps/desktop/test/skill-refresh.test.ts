import { describe, expect, it } from 'vitest';
import { appSkillStale } from '../src/main/skill-refresh';

describe('appSkillStale', () => {
  it("installs the app's skill again after an update: another version wrote it, or one from before versions", () => {
    expect(appSkillStale({ app: true, version: '0.3.4', files: ['SKILL.md'] }, '0.3.5')).toBe(true);
    expect(appSkillStale({ app: true, files: ['SKILL.md'] }, '0.3.5')).toBe(true);
    expect(appSkillStale({ app: true, version: '0.3.5', files: ['SKILL.md'] }, '0.3.5')).toBe(false);
  });

  it("leaves the repository's install and anything that is not the app's marker alone", () => {
    expect(appSkillStale({ repo: '/Users/me/Cuttle', files: ['SKILL.md'] }, '0.3.5')).toBe(false);
    expect(appSkillStale({ app: 'yes' }, '0.3.5')).toBe(false);
    for (const marker of [undefined, null, 'app', [], 42]) expect(appSkillStale(marker, '0.3.5')).toBe(false);
  });
});
