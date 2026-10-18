import { describe, expect, it } from 'vitest';
import { pageInput } from '../src/main/motion-inputs';

describe('the changes a motion page can see', () => {
  it('counts its files and assets anywhere in the project, and the take\'s events, words and markers', () => {
    expect(pageInput('motion/title/index.html')).toBe(true);
    expect(pageInput('motion\\title\\index.html')).toBe(true);
    expect(pageInput('assets/logo.png')).toBe(true);
    expect(pageInput('takes/1/events.jsonl')).toBe(true);
    expect(pageInput('takes/1/transcript.json')).toBe(true);
  });

  it('leaves out the recordings, cuttle.json and what the app and the CLI write', () => {
    expect(pageInput('takes/1/screen.mp4')).toBe(false);
    expect(pageInput('cuttle.json')).toBe(false);
    expect(pageInput('cuttle.json.bak.2')).toBe(false);
    expect(pageInput('out/16x9.mp4')).toBe(false);
    expect(pageInput('preview/motion-title/sheet.png')).toBe(false);
    expect(pageInput('.cuttle/proxy.mp4')).toBe(false);
    expect(pageInput('')).toBe(false);
  });
});
