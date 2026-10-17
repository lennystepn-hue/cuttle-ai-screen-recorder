---
name: cuttle
description: Records the screen and turns the take into a polished demo video with the cuttle CLI (cuts, speed-ups, zooms, masks over private data, a framed window on a designed background, captions, an end card; MP4 in 16:9, 1:1 or 9:16). Use when the user wants to record a demo, a screencast or screen recording, a launch or product video, a video of what Claude Code built, or to edit or re-render a cuttle project (cuttle.json).
---

# Cuttle: screen recordings that edit themselves

You drive the `cuttle` command line. A project is a folder with `cuttle.json` and one take
(`takes/<n>/`: the screen, optional webcam and mic, input events, markers). You record, let
`cuttle suggest` cut the take, refine `cuttle.json`, check stills, and render.

Before you edit `cuttle.json`, read [project.md](project.md): the format, source seconds and
source pixels, and how to find them.

## 0. Check the tools

```bash
cuttle --version
```

If the command is missing, ask the user to run `pnpm cli:install` in the cuttle repository
(`{{REPO}}`) and to open a new terminal. Recording and rendering also need ffmpeg on PATH
(Windows: `winget install Gyan.FFmpeg`). Recording works on Windows for now.

Pass the project folder as an absolute path with `-C "<project>"` and use `--json` for every
command except `record` (below): stdout is then one JSON document, the result or
`{ "error": { "code", "message" } }`. Exit codes: 0 ok, 1 usage or invalid project, 2 device or
permission, 3 render, 130 cancelled.

## 1. Agree the plan with the user (briefly)

- What the demo shows, and how it ends (Claude's answer, a page, a result on screen).
- Which screen: run `cuttle --json devices` and name the monitors (index, size, primary) and
  matching windows. A window (`--window`) or a region keeps the video small and private.
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows and notifications, and to use a clean folder or browser profile.
- The project folder: a new one per demo, e.g. `~/cuttle-demos/<name>` (`record` creates it).

## 2. Record

Never start Claude Code yourself, and never change Claude's settings to trust a folder. For an
agent demo, ask the user to start Claude Code in the demo folder in their own terminal and to
accept the trust dialog. Suggest `claude --setting-sources "project,local" --strict-mcp-config`,
which keeps their global hooks and plugins out of the video (in PowerShell keep the quotes: it
reads `a,b` as an array).

`cuttle record` runs until a stop trigger. Start it **in the background** (Bash
`run_in_background`) **before** the user acts, and without `--json`, so its status lines show:

```bash
cuttle -C "<project>" record --monitor 0 --until-claude "<demo folder>" --max 600
```

- `--until-claude "<folder>"`: stops 2 s after the first Claude Code session in that folder that
  prompts after the start finishes its turn. Its prompt, tool calls and answer become markers.
- `--until-file "<project>/stop"`: stops when the file appears. When the user says they are done,
  create it (`touch "<project>/stop"`). It must not exist at the start.
- `--until-idle 5`: stops once the screen and the input have rested 5 s.
- Always add `--max <seconds>` as a safety net. The user can also stop with Ctrl+Shift+Alt+S and
  add a marker with Ctrl+Shift+Alt+M.
- Other sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.

Read the command's output until it shows `recording takes/<n>`. Then tell the user to start (for
an agent demo: to send the prompt in their Claude Code session). Do not rely on the user's "done"
for timing: `suggest` trims the quiet start and end anyway. When the command ends, it prints the
take (`recorded takes/1: 42.0 s …`), and `cuttle.json` uses it as one clip over the whole take. A
new take replaces the previous take's scenes and overlays; older versions stay as
`cuttle.json.bak`, `.bak.1` and so on.

## 3. Edit

```bash
cuttle -C "<project>" --json suggest
cuttle -C "<project>" --json preview
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work)
and zooms on Claude's answer. Its `notes` say what it did, in source seconds. For a take recorded
without `--until-claude`, add `--claude "<demo folder>"` to read the markers from Claude Code's
transcript.

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
`cuttle -C "<project>" --json preview --at 3.5 --at 12` (output seconds).

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** Look at every still for names, email addresses, tokens and API keys, file
  paths with user names, hook or plugin errors, and notifications. To place a mask, take the
  still's `source` second and run `cuttle -C "<project>" --json frame <source second> --grid`.
  Read that PNG: a numbered grid every 100 source pixels. Then add a `masks` entry: from and to in
  source seconds, a generous rect, and `fill` for secrets. Or cut the stretch out.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`.
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, add a `card`
  scene at the end with the product name and URL, and add a `texts` caption where a step is not
  obvious.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built). Add `--wait 2500` for slow maps or
  fonts.

## 4. Render

```bash
cuttle -C "<project>" --json render --format 16:9
```

Run it in the background for takes longer than a minute; the Bash tool stops long commands. It
writes `out/16x9.mp4` (or `-o <file>`) and prints the frames, the seconds and the encoder. Render
each format the user wants. Tell the user the file's path and length. Do not upload it anywhere.

## When something fails

- `device-not-found`: run `cuttle --json devices`. Names must match exactly (`--mic "<name>"`).
- `invalid-project`: the message names the field (`scenes.2.to: …`); fix `cuttle.json`, or go back
  to `cuttle.json.bak`.
- A crash during recording: `cuttle -C "<project>" --json recover takes/<n>` makes the take usable.
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- A render fails with `render`: try `--encoder software`.
