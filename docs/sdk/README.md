# @cuttle/sdk

Make Cuttle videos from your own code: a release video per version, a video per customer or per data set. A video is a project folder with its `cuttle.json`. The SDK builds that file with types from Cuttle's own schema, checks it, and runs the `cuttle` command to render it, so everything the CLI can do (motion pages, music composed in code, recordings and their auto-edit) is there.

```ts
import { card, motion, video } from '@cuttle/sdk';

const release = video({ dir: 'release-2.0', output: '16:9', theme: { name: 'Cuttle', accent: '#D97757' } });
const title = await release.template('title'); // motion/title/index.html, yours to change
release
  .scene(motion(title, { duration: 3, params: { title: 'Cuttle 2.0' } }))
  .scene(card('Zoom paths you can edit', { enter: 'words' }))
  .scene(card('Get it at cuttle.dev', { enter: 'pop' }))
  .music(await release.template('pulse', { music: true }));
const { videos } = await release.render({ formats: ['16:9', '9:16'], loudness: 'youtube' });
```

[`release-video.ts`](release-video.ts) is the whole example: `node_modules/.bin/jiti docs/sdk/release-video.ts 2.0 "First" "Second"` renders `release-2.0/out/16x9.mp4` and `9x16.mp4` (13 s on an M1).

## API

- `video({ dir, output, fps, look, theme, cli })`: a video in `dir` (made when missing). `output` is `'16:9'`, `'1:1'`, `'9:16'` or `{ width, height, fps }`; `look` and `theme` are as in `cuttle.json` ([project.md](../../skill/cuttle/project.md)).
- Scenes, added in order with `.scene(…)`:
  - `motion(src, { duration, params })`: a page of yours, HTML, CSS, canvas, SVG, WebGL ([motion.md](../../skill/cuttle/motion.md))
  - `card(title, { subtitle, duration, enter })`
  - `still(image, { duration, motion })`
  - `clip(from, to, { speed })`, a stretch of a take
- `.overlay(src, { at, duration, params })`, `.caption(text, { at, duration, style, position, enter, exit })`, `.music(src, { volume, duck, stems, params })`, `.sound(name, { at })`.
- `.edit(project => …)` changes anything else in the `cuttle.json` being built.
- `await .template(name)` copies a motion template into the folder (`title`, `end-card`, `lower-third`, `code-typing`, …), and `await .template(name, { music: true })` a music template (`pulse`, `lofi`, `drift`, `bright`, `cinematic`). Both answer with the page's `src`.
- `.toProject()` is the project with its defaults; it throws with every problem, as `cuttle` would. `await .save()` writes `cuttle.json`.
- `await .render({ out, formats, loudness, size, fps, codec, alpha })` and `await .preview({ at, sheet })` save, run `cuttle render` and `cuttle preview`, and answer with their JSON. A failure is an `Error` with the CLI's `code`.
- `runCuttle(args)` runs any other cuttle command and answers with its JSON.

## Where the cuttle command comes from

`cuttle` on the PATH (`pnpm cli:install` puts it there), else the `cli` option or `CUTTLE_CLI`. A path to the CLI's `cuttle.mjs` runs with the same Node; on Windows the `cuttle.cmd` shim runs through its shell. Rendering starts Electron as the CLI does, on Windows and macOS.

The package is in this repository (`packages/sdk`) and not on npm yet. Its sources are TypeScript written for a bundler, so run scripts with jiti or tsx, or bundle them.
