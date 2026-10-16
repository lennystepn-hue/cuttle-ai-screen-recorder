# Cuttle

Screen recordings that edit themselves: record a monitor, region or window with webcam and mic,
then turn the take into a polished demo with cuts, speed-ups, smooth zooms, masks, a framed window
on a designed background, text overlays and an end card. A desktop app for people, a CLI and a
skill for Claude, one project file (`cuttle.json`) and one render engine for both.

Status: phase 1 in progress. Spec: `docs/superpowers/specs/2026-10-16-cuttle-design.md`.

## Packages

| Package | What it does |
|---|---|
| `@cuttle/project` | `cuttle.json` schema, defaults and readable validation errors |
| `@cuttle/timeline` | What is on screen at any output time: scenes, speed, zooms, masks, texts, cursor, crossfades |

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```
