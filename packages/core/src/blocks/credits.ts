// Where what `cuttle blocks add` brought into a project came from, under which licence: credits.json
// (for programs) and CREDITS.md (for people) in the project folder, one entry per thing brought in.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Credit {
  /** What it is in the project (`motion/glitch/`, `media/icons/ph-rocket.svg`). */
  path: string;
  title: string;
  /** Where it came from, and its licence and author. */
  source: string;
  url: string;
  license: string;
  author?: string;
  /** What its page loaded from the network, now in its `vendor/` folder, with what is known of their licences. */
  vendored?: { url: string; license: string }[];
}

export const CREDITS_JSON = 'credits.json';
export const CREDITS_MD = 'CREDITS.md';

/** The licence of a file a page loaded from a CDN, as far as its address tells. */
export function vendoredLicense(url: string): string {
  if (/\/gsap@|\/gsap\//.test(url)) return 'GSAP Standard "No Charge" License (gsap.com/standard-license)';
  if (/fonts\.(googleapis|gstatic)\.com|\/fontsource\//.test(url)) return 'a font from Google Fonts or Fontsource: SIL Open Font License for most (see the family)';
  if (/\/three@/.test(url)) return 'MIT (three.js)';
  return 'see its source';
}

/** The project's credits, `credit` among them (replacing one for the same path), written both ways. */
export async function addCredit(projectDir: string, credit: Credit): Promise<Credit[]> {
  const file = join(projectDir, CREDITS_JSON);
  const known = await readFile(file, 'utf8').then((text) => JSON.parse(text) as { credits?: Credit[] }, () => ({ credits: [] }));
  const credits = [...(Array.isArray(known.credits) ? known.credits.filter((entry) => entry?.path !== credit.path) : []), credit];
  await writeFile(file, `${JSON.stringify({ credits }, null, 2)}\n`);
  const lines = [
    '# Credits',
    '',
    'What this video brought in from open collections (`cuttle blocks add`), and under which licence.',
    '',
    ...credits.flatMap((entry) => [
      `- **${entry.title}** (\`${entry.path}\`): ${entry.source}, ${entry.license}${entry.author ? `, by ${entry.author}` : ''}. ${entry.url}`,
      ...(entry.vendored ?? []).map((vendored) => `  - ${vendored.url}: ${vendored.license}`),
    ]),
    '',
  ];
  await writeFile(join(projectDir, CREDITS_MD), lines.join('\n'));
  return credits;
}
