# Cuttle 0.1.1: The Release Notes Name the Import, the Workflow Brings Apple's Intermediate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The draft release of 0.1.1 can be made.
- **The notes:** they name what went into main after them (`cuttle import`, `cuttle.video`, `frameAt`, #61).
- **The signing:** the macOS build is signed with the Developer ID certificate the user is adding.

**Architecture:**
- `docs/releases/0.1.1.md` gets two lines under "New in this version".
- The Release workflow's signing step imports Apple's *Developer ID - G2* intermediate certificate into the run's keychain, after the user's .p12. It comes from apple.com/certificateauthority.
- The README's Releases part says so.

**Tech Stack:** GitHub Actions (macOS `security`), Markdown.

Conventions for every task:

- Run all commands from the repo root `C:\Users\ender\Projects\cuttle`, on the branch `release-notes-g2`, in Git Bash.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

- **The intermediate in the workflow:**
  - The user's certificate showed "not trusted" in Keychain Access on their Mac, because Apple's Developer ID G2 intermediate was missing there.
  - `security find-identity -v` lists only valid identities, so on a runner without that intermediate the step would find no identity and stop with "has no Developer ID Application identity".
  - The workflow imports the intermediate itself, so the user exports only the certificate and its key.
  - A .p12 exported with the intermediate already holds it. The second import then fails with "already exists", which is fine: the step says so and goes on.
- **No test runs the workflow:** it only runs on GitHub, by hand. The YAML was parsed (js-yaml), and the signing step's lines read as written. Its first run is the draft release.
- **The notes** are written as the earlier lines are: what it does for the person, in one line each.

---

### Task 1: The notes, the intermediate, the README

**Files:**
- Modify: `docs/releases/0.1.1.md`, `.github/workflows/release.yml`, `README.md`

- [ ] **Step 1: The branch**

The plan was committed on the branch `release-notes-g2`; work there:

```bash
git switch release-notes-g2
```

- [ ] **Step 2: The notes**

In `docs/releases/0.1.1.md`, replace:

```markdown

## New in this version

- **A window take records the window by itself on Windows too**, also while another window lies over it. Closing the window ends the take. This needs ffmpeg 8 or newer.
- **Privacy:**
  - Random-looking strings (a key without a known prefix or a name beside it) are masked.
```

with:

```markdown

## New in this version

- **Videos made elsewhere:** `cuttle import <file>` makes a video from a phone, OBS or a download the project's take. Its picture is converted as Cuttle records (30 fps), and its sound becomes the mic. `--from` and `--to` take a stretch of it.
- **Videos in motion pages:** `cuttle.video(src)` draws a video of the project frame by frame, each frame once. `frameAt` in the kit says which image of a sequence shows.
- **A window take records the window by itself on Windows too**, also while another window lies over it. Closing the window ends the take. This needs ffmpeg 8 or newer.
- **Privacy:**
  - Random-looking strings (a key without a known prefix or a name beside it) are masked.
```

- [ ] **Step 3: Apple's intermediate in the signing step**

In `.github/workflows/release.yml`, replace:

```
          security unlock-keychain -p "$password" "$keychain"
          security import "$RUNNER_TEMP/cuttle.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          rm "$RUNNER_TEMP/cuttle.p12"
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"
          security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
          identity="$(security find-identity -v -p codesigning "$keychain" | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')"
```

with:

```
          security unlock-keychain -p "$password" "$keychain"
          security import "$RUNNER_TEMP/cuttle.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          rm "$RUNNER_TEMP/cuttle.p12"
          # Apple's Developer ID G2 intermediate: without it the identity is "not trusted" and
          # find-identity -v leaves it out. A .p12 exported with it holds it already.
          curl -fsSL -o "$RUNNER_TEMP/DeveloperIDG2CA.cer" https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
          security import "$RUNNER_TEMP/DeveloperIDG2CA.cer" -k "$keychain" || echo "the G2 intermediate is in the keychain already"
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain"
          security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
          identity="$(security find-identity -v -p codesigning "$keychain" | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')"
```

- [ ] **Step 4: The README**

In `README.md`, replace:

```markdown
| `APPLE_CERTIFICATE_PASSWORD` | the .p12's password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | for notarizing: the Apple ID, an app-specific password made for it (account.apple.com), the team's id |

On one computer, `pnpm app:build && pnpm app:installer` makes the installer of that platform in
`apps/desktop/build/installers` (on macOS signed with `CUTTLE_SIGN_IDENTITY`, see
`apps/desktop/scripts/package.mjs`).
```

with:

```markdown
| `APPLE_CERTIFICATE_PASSWORD` | the .p12's password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | for notarizing: the Apple ID, an app-specific password made for it (account.apple.com), the team's id |

The workflow adds Apple's *Developer ID - G2* intermediate certificate itself. Where Keychain
Access says the certificate "is not trusted", that intermediate is missing on the Mac too: install
it from apple.com/certificateauthority.

On one computer, `pnpm app:build && pnpm app:installer` makes the installer of that platform in
`apps/desktop/build/installers` (on macOS signed with `CUTTLE_SIGN_IDENTITY`, see
`apps/desktop/scripts/package.mjs`).
```

Run: `pnpm test`
Expected: PASS, 1005 passed, 82 skipped.

- [ ] **Step 5: Commit**

```bash
git add docs/releases/0.1.1.md .github/workflows/release.yml README.md
git commit -m "release: the notes of 0.1.1 name the import and cuttle.video; the workflow brings Apple's Developer ID G2 intermediate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Changes during execution

- It was written from the finished prototype and replayed on a fresh clone for its commit; the tree came out byte-identical to the prototype.
- Checked on the prototype: `pnpm test` (1005 passed, 82 skipped); the workflow parsed with js-yaml. The five Apple secrets are in the repository (their names listed, nothing more).
