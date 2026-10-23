// A release video from code: a title with the version, what is new as cards, an end card, music
// composed for it; rendered in 16:9 and 9:16 at YouTube's loudness.
//
//   node docs/sdk/release-video.ts 2.0 "Zoom paths" "Camera layouts" "4K at 60 fps"
//
// It needs the cuttle command (pnpm cli:install) or CUTTLE_CLI set to the CLI's cuttle.mjs.
import { card, motion, video } from '@cuttle/sdk';

const [version = '1.0', ...news] = process.argv.slice(2);
const release = video({ dir: `release-${version}`, output: '16:9', theme: { name: 'Cuttle', url: 'cuttle.dev', accent: '#D97757' } });

const title = await release.template('title');
release.scene(motion(title, { duration: 3, params: { title: `Cuttle ${version}`, subtitle: 'What is new' } }));
for (const line of news) release.scene(card(line, { duration: 2, enter: 'words' }));
release.scene(card('Get it at cuttle.dev', { subtitle: `Version ${version}`, duration: 2.5, enter: 'pop' }));
release.music(await release.template('pulse', { music: true }));

const result = await release.render({ formats: ['16:9', '9:16'], loudness: 'youtube' });
for (const one of (result.videos as { out: string; seconds: number }[] | undefined) ?? [result as { out: string; seconds: number }]) {
  console.log(`${one.out}: ${one.seconds.toFixed(1)} s`);
}
