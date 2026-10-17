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

If the command is missing, {{INSTALL_CLI}}, and to open a new terminal. Recording and
rendering also need ffmpeg on PATH (Windows: `winget install Gyan.FFmpeg`, macOS:
`brew install ffmpeg`). Recording works on Windows and macOS. macOS asks the app that runs
`cuttle` (the terminal) for Screen Recording, Microphone and Camera, and the input log needs Input
Monitoring: a `permission-denied` error or an input warning names the setting to ask the user for.

Give the project folder as an absolute path, `-C "<project>"`, for example
`-C "$HOME/cuttle-demos/<name>"` (a `~` inside quotes is not expanded). Use `--json` for every
command except `record` (below): stdout is then one JSON document, the result or
`{ "error": { "code", "message" } }`. Exit codes: 0 ok, 1 usage or invalid project, 2 device or
permission, 3 render, 130 cancelled.

## 1. Agree the plan with the user (briefly)

- What the demo shows, and how it ends (Claude's answer, a page, a result on screen).
- Which screen: run `cuttle --json devices` and name the monitors (index, size, primary) and
  matching windows. A window (`--window`) or a region keeps the video small and private.
- The format: 16:9 for X, YouTube and LinkedIn; 9:16 for Shorts, Reels and TikTok; 1:1 for feeds.
  X takes H.264 up to 1920×1200; keep demos under 60 s. A 16:9 screen fills only about a third
  of a 9:16 video: for 9:16 record a narrow window or region, or plan tight zooms.
- Webcam and mic only when asked (`--webcam`, `--mic`). A muted mic is reported as a warning.
  When the user will speak, Cuttle transcribes the mic on this computer and cuts filler words and
  pauses. That needs a speech model: `cuttle --json models` lists them. If none is downloaded, ask
  the user before `cuttle models download small` (488 MB, once). Tell them that a slip needs no
  new take: press Ctrl+Shift+Alt+X (or say "nochmal", "again") and do the bit again.
- Ask the user to make text large (terminal font 16 px or more, or zoom the browser), to close
  private windows, to switch on Do not disturb (Cuttle masks the notifications it sees, but none is
  better), and to use a clean folder or browser profile.
- The project folder: a new one per demo (`record` creates it).

## 2. Record

Never start Claude Code yourself, and never change Claude's settings to trust a folder. For an
agent demo, ask the user to start Claude Code in the demo folder in their own terminal and to
accept the trust dialog. Suggest `claude --setting-sources "project,local" --strict-mcp-config`,
which keeps their global hooks and plugins out of the video (in PowerShell keep the quotes: it
reads `a,b` as an array).

`cuttle record` runs until a stop trigger. Start it **in the background** (Bash
`run_in_background`) **before** the user acts, and without `--json`, so its status lines show.
Always give it a stop file and a time limit:

```bash
cuttle -C "<project>" record --monitor 0 --until-file "<project>/stop" --until-claude "<demo folder>" --max 600
```

- `--until-file "<project>/stop"`: the take ends when the file appears. **This is how you stop
  it**: create the file (`touch "<project>/stop"`) when the user is done or something goes wrong,
  but only while the task still runs (a file left after another trigger ended the take blocks the
  next one). Never stop the background task by killing it: a killed take is cut off, and
  `cuttle.json` still points at the previous take. After a stop by file, `record` removes the file
  again.
- `--until-claude "<folder>"`: also ends the take 2 s after the first Claude Code session in that
  folder that prompts after the start finishes its turn; its prompt, tool calls and answer become
  markers. If that folder is the one you run in, tell the user not to write to you until the
  recording has stopped: your own next turn would end it.
- `--until-idle 5`: also ends once the screen and the input have rested 5 s.
- `--max <seconds>` is the safety net (it counts recorded time, not pauses). The user can also stop
  with Ctrl+Shift+Alt+S, add a marker with Ctrl+Shift+Alt+M and pause or resume with
  Ctrl+Shift+Alt+P (Alt is Option on a Mac; nothing is recorded while paused; the pieces are
  joined at the stop). Other
  sources: `--window "<part of the title>"`, `--region x,y,w,h` (pixels of `--monitor`).
  `--countdown 3` is the default.
- A project open in the Cuttle app is refused (`project-open`): the app records it itself
  ("Record again"). Ask the user to record there or to close it; `--force` only if they say so.

The Bash tool's result names the background task's output file. Wait until the recording runs
(at most 40 s: the countdown plus up to 20 s for the tracks to start):

```bash
for i in $(seq 40); do grep -qE "recording takes/|^error:" "<output file>" && break; sleep 1; done; cat "<output file>"
```

If it shows `recording takes/<n>`, tell the user to start (for an agent demo: to send the prompt
in their Claude Code session). If it shows `error:`, or nothing after 40 s, the recording did not
start: read the error. Do not rely on the user's "done" for timing: `suggest`
trims the quiet start and end anyway. When the take ends, the output shows
`recorded takes/<n>: 42.0 s …` and `cuttle.json` uses the take as one clip over the whole take. If
the task ended without that line (killed, crashed), run
`cuttle -C "<project>" --json recover takes/<n>` before anything else. A new take replaces the
previous take's scenes and overlays; older versions stay as `cuttle.json.bak`, `.bak.1` and so on.

## 3. Edit

```bash
cuttle -C "<project>" --json suggest
cuttle -C "<project>" --json preview
```

`suggest` trims the quiet start and end, cuts idle stretches, speeds up waiting (Claude at work),
and crops each clip to the content: a browser's page without its tabs and bars, without the
taskbar (from the window's content area the recorder saw, else from the screen's still edges;
`--no-crop` leaves it out). It zooms on Claude's answer, on a dialog while it is open ("Dialog";
`--no-dialog-zooms`), in where someone types, following the text along ("Typing": the camera
moves on as the text leaves the middle of the view; `--no-typing-zooms`), and where clicks
happen at normal speed ("Click", "Clicks"; `--no-click-zooms`; `--no-zoom` leaves out every zoom). Its `notes` say what it did, in
source seconds. It replaces every clip and the zooms it made before (tagged `auto`; masks, texts,
cuts, stills, cards and zooms made by hand stay), so run it once, before your hand edits. Its clips and zooms have ids, and labels where Claude's markers say
what they show ("Claude at work", "Answer"): keep them when you edit, and give items you add an
unused id and a label (project.md).
For a take recorded without `--until-claude`, add `--claude "<demo folder>"` to read the markers
from Claude Code's transcript.

**Speech.** With a mic, `suggest` keeps the stretches where someone speaks (never cut or sped up),
and when a speech model is downloaded it first transcribes the mic into `takes/<n>/transcript.json`
(every word with its source seconds; read it to find what was said where). It then cuts filler
words ("äh", "um") and pauses longer than a second down to 0.4 s, only where the picture rests
(cuts tagged `filler` and `pause`). `--no-speech` leaves the speech out.
`cuttle -C "<project>" --json transcribe --language de` transcribes again (`--model` picks one).
Transcribing also writes a cleaned-up mic (less noise, even loudness) that the video plays.

**Slips.** The mistake key (Ctrl+Shift+Alt+X, or the scissors in the recording bar) marks a slip
in `markers.json` (kind `retake`). A spoken cue counts too when the bit is then said again ("…die
Art. Nochmal. Die App erkennt die Art …"; also "noch mal", "again", "one more time"). `suggest`
cuts each slip from the pause before it to where the bit starts again (cuts tagged `retake`,
"Retake" or "Retake: “Nochmal”"); the key needs no speech model. Check each with `preview --at`
just before and after the cut; if it took too much or too little, move its `from` or `to` and
remove its `auto`.

**Subtitles.** A transcribed take gets subtitles in the video (`captions`, project.md): as
subtitles at the bottom, `karaoke` (the spoken word in colour) or `bold` (a few big words, for
9:16). `cuttle -C "<project>" transcript --text` prints what was said; `--srt` the subtitles on
the video's time. Read them for misheard names and fix them in `captions.fixes`. Check a still
with a subtitle on it before you render.

`preview` writes 12 stills and `preview/sheet.png`. **Look at the sheet** (Read the PNG). Each
still in the JSON has its output second `t` and the `source` second it shows. For details, run
`cuttle -C "<project>" --json preview --at 3.5 --at 12` (output seconds). Each run replaces the
stills in `preview/`; add `-o "<folder>"` to keep a set.

Then refine `cuttle.json` ([project.md](project.md)) and preview again:

- **Privacy first.** `suggest` masks each notification (a toast, the notification centre) while it
  was open (`auto: "notification"`). It also reads the screen's text (Windows' own OCR or macOS's
  Vision, on this computer) and masks what it finds: email addresses, keys and tokens, the value of a `…KEY=`,
  `…TOKEN=` or `password:` line, IBANs, card and phone numbers (masks tagged `auto: "privacy"`,
  following text that scrolls). Pass the user's name and address once with
  `--mask "<word>"` (kept in cuttle.json). This is a help, not a guarantee: the OCR misses small
  grey text and some lines, so **still look** yourself. Look for names, email addresses, tokens and
  API keys, file paths with user names, hook or plugin errors, and notifications.
  - Twelve stills miss things: step through sped-up stretches with `preview --at` about every
    output second.
  - For each find, take the still's `source` second and run
    `cuttle -C "<project>" --json frame <source second> --grid`. Read that PNG: a numbered grid
    every 100 source pixels. Read the rect off it, generously.
  - Find when it appears and when it goes: run `frame` at earlier and later source seconds
    (halving the step), then pad 0.5 s on each side for the mask's `from` and `to`. Text that
    scrolls moves: give each position its own mask, or cut the stretch out.
  - Use `fill` for secrets. Check every mask with `preview --at` 0.1 s inside each end and in the
    middle (output second = scene start + (source second − `from`) ÷ `speed`); each still's
    `source` must lie inside the mask's `[from, to)`, since a still shows the whole frame its time
    falls in.
  - Masks apply to clips only: look at a captured page yourself before you add it.
- **Story.** Trim what does not help. Keep the prompt readable (1.5 s or more) and the answer on
  screen for 2–3 s. A speed-up shows a "12× speed" badge.
- **Length.** For a length the user names (X: under 60 s), fit it last, after your zooms and
  texts: `cuttle -C "<project>" --json fit 45`. It cuts where the video rests (`auto: "length"`),
  never speech, clicks, typing, a zoom or a text, and says the shortest it can make when the
  length is out of reach. A new fit replaces the last; `fit --off` takes it out.
  (`suggest --length 45` fits in the same run, before any hand edits.)
- **Focus.** Add or fix `zooms` on what matters: 2–4 s on the answer or a result, with the rect
  read off a `frame --grid`. Over a sped-up clip, durations are source seconds: 3 s at 12× is a
  quarter second on screen (see project.md).
- **Look.** Set `look.frame.title` (e.g. `claude · ~/demo`) and a background preset, and add a
  `texts` caption where a step is not obvious. Typing clicks softly, a click per key where the clip
  is heard (`look.audio.typing`, `typingVolume`); switch it off when the user wants a quiet video.
- **Pages.** `cuttle -C "<project>" --json capture-page <url or file> --scroll --add` appends a
  scrolling still of a web page (the result the agent built); add `--wait 2500` for slow maps or
  fonts. It goes after every scene, so capture pages before you add the end card (or move the
  still in `scenes`).
- **End card.** A `card` scene at the end with the product name and URL.

## 4. Render

```bash
cuttle -C "<project>" --json render --format 16:9
```

With a transcript, `--srt` and `--vtt` also write the subtitles next to the video, and
`--no-captions` leaves them out of the picture. Run it in the background when the video is longer than about a minute; the Bash tool stops long
commands. It writes `out/16x9.mp4` (or `-o <file>`); the JSON has the frames, the seconds and the
encoder (`stats`). For 9:16, check `preview --format 9:16` first. Render each format the user
wants. Tell the user the file's path and length. Do not upload it anywhere.

## When something fails

- `device-not-found`: run `cuttle --json devices`. Names must match exactly (`--mic "<name>"`).
- `invalid-project`: the message names the field, counted from 0 (`scenes[1].to: …`); fix
  `cuttle.json`, or go back to `cuttle.json.bak`. A clip must end inside the take.
- `record` refuses a stop file that already exists: delete it (`rm "<project>/stop"`), then start
  again.
- A crash or a killed recording: `cuttle -C "<project>" --json recover takes/<n>` makes the take
  usable.
- `suggest` found no Claude markers: pass `--claude "<demo folder>"`.
- `model-missing` (or the note "the mic was not transcribed"): no speech model is downloaded; ask
  the user before `cuttle models download small`.
- `ffmpeg-old`: nothing here can transcribe: ffmpeg has no whisper filter (before 8.0, or built
  without whisper, as every macOS ffmpeg is) and whisper.cpp's `whisper-cli` is not installed. Ask
  the user to run `winget upgrade Gyan.FFmpeg` (macOS: `brew install whisper-cpp`).
- `frame` says no frame starts at that second: the take ends there; take an earlier second.
- A render fails with `render`: try `--encoder software`.
- `conflict`: `cuttle.json` was saved by someone else (the user, or the Cuttle app) while the
  command ran, and nothing was written. Read the file again, then run the command again.
