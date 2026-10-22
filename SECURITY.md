# Security policy

Cuttle records screens, so a flaw in it can expose what people did not mean to show. Thank you for
taking the time to report one privately.

## Supported versions

Only the latest release gets fixes. The app updates itself within a day (or at once with *Restart
and update*, Settings > General), so a fix reaches everyone through a new release.

| Version | Supported |
|---|---|
| The [latest release](https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/releases/latest) | yes |
| Older releases | no: update first |
| `main` | yes, for what is not released yet |

## Report a vulnerability

**Please do not open a public issue.** Report it privately through GitHub instead:
[Report a vulnerability](https://github.com/lennystepn-hue/cuttle-ai-screen-recorder/security/advisories/new)
(the repository's *Security* tab).

Please include:

- what the flaw lets someone do, and to whom;
- the steps to reproduce it, with the Cuttle version and the system (Windows or macOS, and its
  version);
- a proof of concept if you have one. Leave real private data out of it: a test account, a made-up
  key or a sample recording is enough.

You get an answer within seven days. Once the flaw is confirmed, a fix is released as soon as it
is ready, and the advisory is published with it, crediting you if you like.

## What counts

Reports about anything that breaks what Cuttle promises are welcome, for example:

- **Privacy:** something leaves the computer (Cuttle runs locally and uploads nothing), a mask that
  Cuttle shows as covering a secret leaves it readable in the export, or a project keeps what the
  screen showed in a place the README does not say. A secret Cuttle simply did not find is a normal
  bug: open an issue without the secret in it.
- **The app:** a page reaching the network, the file system or the main process beyond what it is
  given (the editor, motion pages, music pages), a crafted `cuttle.json`, motion page or take that
  runs code or reads files outside its project, or the IPC between the windows.
- **Updates and installers:** anything that would let someone else's build or update reach users.
- **The CLI and the Claude skill:** a command that writes or deletes outside the project it is
  given, or a skill instruction that makes Claude leak a project's private data.

Not in scope: flaws in Electron, ffmpeg, whisper.cpp or the operating system themselves (report
them to those projects; tell us if Cuttle should update one), the Windows installer not being
code-signed yet (known), and attacks that need someone who already controls the computer.
