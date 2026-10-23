// The release video of Cuttle's GitHub Action (action.yml): a title with the name and version,
// what is new from the release notes as cards, an end card with the URL, music composed for it;
// rendered in the formats asked for at YouTube's loudness. Its inputs come as environment
// variables; it prints the videos' paths, one a line.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { card, motion, newsOf, video } from '@cuttle/sdk';

const input = (name: string, fallback = '') => process.env[`CUTTLE_${name}`]?.trim() || fallback;
/** A path of the workflow's: against its workspace (the script runs in Cuttle's folder). */
const workspacePath = (path: string) => resolve(input('WORKSPACE', process.cwd()), path);

const name = input('NAME', 'Release');
const version = input('VERSION').replace(/^v(?=\d)/, '');
const url = input('URL').replace(/^https?:\/\//, '').replace(/\/$/, '');
const accent = input('ACCENT');
const notes = input('NOTES_FILE') ? readFileSync(workspacePath(input('NOTES_FILE')), 'utf8') : input('NOTES');
const formats = input('FORMATS', '16:9').split(/[\s,]+/).filter(Boolean);
const news = newsOf(notes, Number(input('LINES', '5')));

const unknown = formats.filter((format) => !['16:9', '1:1', '9:16'].includes(format));
if (unknown.length > 0) throw new Error(`formats are 16:9, 1:1 and 9:16, not ${unknown.join(', ')}`);
if (news.length === 0) console.warn('the release notes have no bullets: the video is its title and end card');

const release = video({
  dir: workspacePath(input('DIR', 'cuttle-release-video')),
  output: formats[0] as '16:9',
  theme: { name, ...(url && { url }), ...(accent && { accent }) },
});
const title = await release.template('title');
release.scene(motion(title, { duration: 3, params: { title: version ? `${name} ${version}` : name, subtitle: news.length > 0 ? 'What is new' : '' } }));
for (const line of news) release.scene(card(line, { duration: 2.2, enter: 'words' }));
// the end card types the URL at 22 characters a second from 1.05 s, then its call to action lands
const end = await release.template('end-card');
release.scene(motion(end, { duration: Math.max(3.5, 1.05 + url.length / 22 + 1.8), params: { headline: version ? `${name} ${version}` : name, cta: input('CTA', 'Out now') } }));
const music = input('MUSIC', 'pulse');
if (music !== 'none') release.music(await release.template(music, { music: true }));

const result = await release.render({ formats: formats as ('16:9' | '1:1' | '9:16')[], loudness: 'youtube' });
for (const one of (result.videos as { out: string }[] | undefined) ?? [result as { out: string }]) console.log(one.out);
