# Story: what the video is, before any scene

Read this before you build a video written in code that runs longer than about ten seconds (a
launch, a promo, an explainer, a release or changelog video, a social clip), and for the opening and
the end of a recorded demo. Skip it for an edit to a project that already has its story, a single
overlay, a lower third, captions or a title alone: there the request is the story. When the person
brings a script, a storyboard or a video to follow, theirs wins; use what follows to fill its gaps.

Most dull videos are good motion around no story: a title, one slide per feature, a logo, a URL.
Cuttle's own first tries land there too when nothing else is decided. The way out is to decide the
film before you write a page.

## 1. The one thing

- **What it is**, in one line: "you can now …" for a launch, the one idea the viewer must get for
  an explainer, what changed and why it matters for a release. A whole release is not one thing:
  take its headline.
- **What the viewer keeps** when it ends, in their words, not the brand's slogan.
- **One viewer doing one real task**, from the moment they need it to the result. That task is the
  spine, and one real piece of data travels through it from the first shot to the last: a prompt, a
  file, a photo, a number, an address. An explainer's spine is one concrete example, worked through.
- **Facts from the source only**: the site, the README, the release notes, the person's words. Use
  the person's own copy as it is. Never derive a claim the source did not make ("from 40 min to
  2 min" is not "20× faster"); say so when a number is only an example; a screen you cannot get is
  rebuilt from what you know of it, or left out, never invented.

## 2. Three storylines, then one

Write three storylines that are three different films, not three titles on one film. Each pairs an
**idea** (what the story is) with a **form** (how the camera and the cuts carry it). Sketch five or
more pairs first, a line each; drop the ones the subject cannot carry, and keep the three that
differ most, in their idea and in their form. One of them is the bold one you would not have picked
first.

| Idea | What the viewer sees |
| --- | --- |
| The result first | the finished thing plays at full size, then the film goes back to show how it was made |
| The moment of need | a real situation with a time and a pressure (a message at 23:40: "demo tomorrow?"), then the product answers it |
| One thing travels | one real object (a file, a prompt, a photo) moves from app to app into the product, which changes it |
| Before, then after | the old way as a scene of its own (twelve tabs, a spinner, a wall of logs), then the same shot with the product |
| A question with a blank | "What if your ⟨changelog⟩ made its own video?", and a real input fills the blank |
| A number earns its place | one real number, earned by a scene, then made physical: it fills the frame, stacks, counts up, pours |
| The cursor is the actor | the pointer (or a hand, a mascot) does the work, and every cut has a cause it made |
| Type is the argument | huge words carry the claim, colour fields change on the beat, the product shows in between |
| The machine opened | the product as an object whose working is the idea: an exploded view, a cutaway the camera tours |
| Claude at work | the prompt, the tools flying past, the result arriving: the waiting turned into a rhythm |

| Form | What the viewer sees | In Cuttle |
| --- | --- | --- |
| One continuous camera | no cut: the camera pushes, pans and travels from one world into the next | one long page with a camera (a transform on a wrapper around its world, or a Three.js camera), or scenes whose last frame is the next one's first, with `look.transition.enabled: false` |
| Every shot hands over | each shot ends on the thing that opens the next: a button becomes a card becomes a phone | a transition page that draws `cuttle.from` into `cuttle.to` (`motion add --as transition --into <scene>`), or a shape that grows to fill the frame in the next scene's colour |
| The endless zoom | the camera dives into a detail that turns out to be the next world, again and again | each page ends inside a detail that the next one starts as; a transition page scales `cuttle.from` down into `cuttle.to` |
| A journey across one world | a map, a desk, a 3D set: each idea is a stop on the route | one world in Three.js or SVG, shared by several pages that each set the camera's stop |
| Cut on the beat | hard cuts on the music, a new layout every bar | `look.transition.enabled: false`, the music's tempo fitted to the scene changes (`fitTempo`, [music.md](music.md)), and `music check` saying `hit` at every cut |
| Match cuts | one shape holds while everything around it changes: a circle becomes a lens, a record, the logo | the shape at the same place and size on both sides of a hard cut |
| Many to one | a grid of panes plays at once, then collapses into the one that matters | one page with several moments of the take (`cuttle.take.frame`) or clips (`cuttle.video`), one of them growing to fill the frame |
| One frame rebuilds | a single composition keeps rearranging itself and never cuts | one page whose layout changes on the beats |

A recorded take joins any of them: `cuttle.take.frame` puts the take inside a world (frozen, tilted,
on a wall, on a desk), and the `device-3d` template plays it on a laptop's screen and flies into it
([motion.md](motion.md)).

Each storyline says, in a few lines:

- its name, its idea and its form, and in two sentences what the viewer sees and feels;
- the first two seconds, exactly;
- its beats in one line (`hook → … → end card`);
- its look in one line: the ground, the type, the one material, taken from the subject or the brand;
- its sound in one line: the mood, the tempo, where it drops and where it hits.

Three storylines that are all plain cuts between scenes have not tried the forms.

Put your recommendation first, with its reason in a clause, and show the three to the person. Then
stop once until they pick; a mix of two ("A's opening with C's middle") is one storyline. Ask
nothing else unless only they can answer it (a screen you cannot get, a voice or music only), and
state the rest in one line of assumptions: the length as a range, the format, music or a voice.
When they asked for the video without stops, take your recommendation, build it, and name the other
two in a line each when you hand it over. Build nothing before one is picked.

## 3. The hook

The first two seconds are the densest of the video, and frame 0 is its thumbnail on every player.
Look at it as a picture of its own: `cuttle -C "<project>" --json render --still 0` writes it to
`out/still-0.00s.png`. It is never empty, never a logo alone, never a title alone on a gradient.

Open on the product working on something the viewer recognises, a real moment that makes the need,
a question with the input in it, a sentence whose last word becomes the picture, or the bug itself.
Then let the old way fail on screen (the wait, the wall of text, the wrong result) before the
product brings relief; the proof is often the same shot, better, in front of the viewer. Typing into
an empty prompt box with nothing else on screen is the tell of a generated video when it opens one;
a few seconds in, as a step of the story, it is fine.

## 4. Beats

The shape of a launch of about 30–40 s, as shares of its length. Scale it, and let the storyline
bend it:

| Beat | Share | What it does |
| --- | --- | --- |
| Hook | ~8 % | the world and the need, or the product already working |
| Need | ~12 % | the old way failing on screen, or a gag |
| Reveal | ~8 % | the product named, 20–30 % in |
| Proof | ~40 % | the real task as three to six verbs (paste, pick, watch it build, ship), a shot each |
| Payoff | ~17 % | the result arrives, already moving: the biggest moment of the video, once, 60–80 % in |
| Claim | ~7 % | the one thing, in one line |
| End card | ~8 % | the mark carried in, the name and the call to action, held 2–3 s |

- **An explainer**: the question, one example worked through step by step, the rule it shows, the
  rule once more on a new example.
- **A release or changelog video**: the headline change is the hook and gets the proof; two to four
  more changes follow, each with an idea and a layout of its own, never a list.
- **A 9:16 social clip**: the hook in the first second, type large enough for a phone, one idea, an
  ending that loops into the start.
- **A recorded demo**: open on the result (a short clip from the end of the take, or a still of the
  finished page, put first in `scenes`), then the take is the proof. Speed up the work, play the
  payoff at normal speed and hold it. Step titles from a script are a choice, not a default: leave
  them out (`--no-step-titles`) where the screen says what happens.

Length follows the story: a launch is usually 20–45 s. A length the person names is a range, never
a reason to pad.

## 5. Worlds and handovers

A video visits several worlds, each with its own ground, light and scale: the product on a colour
field, a desk from above, a white void with one object in it, a 3D studio, the take itself. Not one
dark canvas with small panels floating in it. Enter each world through something already on screen:
the button clicked becomes the next shot, the card grows into the next ground, a colour floods the
frame. Keep one home to come back to, one carrier the eye follows (the cursor, the thing that
travels), and the same palette and type in every world.

## 6. STORY.md

Write the picked storyline into the project as `STORY.md`, next to `cuttle.json`: the brief you
build from, check against, and change when a review changes the video. Put a number wherever you
would have written an adjective. An adjective leaves the gap to the defaults, and the defaults look
the same in every video.

```text
IDEA:      the one thing, in one line; what the viewer keeps
VIEWER:    who watches, where (X, a launch page, a README), with sound or without
STORY:     the picked storyline: its idea, its form, its beats in one line
HOOK:      what is on screen at 0 s, 1 s and 2 s
LOOK:      ground (hex, its texture and how much of it), ink, one accent and where it may appear;
           display face, weight, size as a share of the short side, tracking; body face;
           the medium (paper and ink, glass, the product's UI, a 3D studio) with its numbers;
           shadows (offset, blur, opacity), grain, vignette
MOTION:    eases by role (enter, move, exit, camera), springs, staggers, holds
SOUND:     mood, tempo, where it drops and where it hits; the sounds and where they play
SHOTS:     a line a scene: its seconds, its one move, what the viewer reads, how it hands over
BANNED:    the defaults of section 8, and what this video must not become
CHECK:     the moments to look at (output seconds) and what each must show
NOT BUILT: the other two storylines, a line each
```

| You would write | Write instead |
| --- | --- |
| premium | a matte ground with 3 % grain, one light from the upper left, soft shadows (24 px blur at 30 %), nothing faster than 0.5 s |
| modern | one display face at 8 % of the short side with −2 % tracking, one push of the camera a shot, on one ease |
| clean | a 12-column grid with 96 px margins, two weights, the accent on one word a shot |
| dynamic | cuts on the beat, a new layout every bar, one hero move a shot |
| playful | springs that overshoot on position and scale (damping about 12), poses exaggerated by 10–30 % |
| cinematic | a wide framing with a 2.39:1 band, a key light from the upper left and a rim from behind, 6 % vignette, motion blur |

A look holds together when it is the rules of one medium, not a palette. A risograph print is a
paper with fibre, two inks, a third colour where they overlap, halftone dots instead of gradients,
and it moves the way print does: plate by plate, not by fading in. Write any look this way: its
parts, what each may carry, and how the medium itself moves (paper is cut and lifted, ink is
printed, glass refracts, the product's UI answers the cursor). `motion/shared.css` and
`motion/shared.js` are the look in code, imported by every page; the numbers for its motion are in
[motion.md](motion.md) ("Motion that feels designed").

## 7. Copy

- One line on screen at a time, at most about six words a line (an explainer's may run to ten), and
  no full stop at the end of a title.
- Show, do not list: no bullet slides, no row of three cards. Things that repeat get an idea and a
  layout each.
- Real numbers from the source only.
- The first words are never "Introducing", "Meet" or "Built with"; after the need, naming the
  product is fine.
- No "unlock", "seamless", "supercharge", "effortless", "game-changer" or "revolutionise", and no
  "in seconds" unless it was measured.
- Read the lines alone: a stranger gets the pitch. Look at the pictures alone: they tell the same
  story.
- With a narration, the screen never repeats the spoken sentence word for word.
- The brand's mark lands once, with weight, usually on the end card; before it the brand shows
  inside the product and the story, not docked in a corner. The accent colour is rationed: one word,
  the payoff, the end card. The end card is built (the mark carried in, typed or wiped in), not a
  still.

## 8. Banned by default

This is where a video lands when nothing was decided, Cuttle's own first tries included. Each is
banned unless the brand's own material or the person's reference does it, and then only as they do:

- a title card as the first scene: a `card`, the `title` template, or the name on a gradient;
- every scene as an eyebrow label ("01 · EDITOR"), a big heading, a paragraph and a mocked-up panel
  beside them;
- a dark gradient void (navy, purple, the accent glowing in a corner) with small things floating in
  its middle;
- glow, bloom, starfields, particles and orbs as decoration;
- everything centred;
- everything rising out of a blur or sliding up as it fades in, every scene entering the same way;
- three cards in a row, a grid of KPI tiles, chips and pills as decoration;
- text that keeps drifting or scaling after it lands, breathing and floating loops in place of
  motion;
- the logo docked small in a corner;
- a crossfade at every cut.

Copy the list into `STORY.md`'s BANNED line and let it grow: every default a review finds goes on
it.

## 9. Review

You wrote the pages, so you know what they mean; the viewer sees the video once, at full speed,
often on a phone. After the first full preview, look at it as a harsh director would, not as its
author:

```bash
cuttle -C "<project>" --json preview
cuttle -C "<project>" --json preview --at 4.8 --at 5.2
cuttle -C "<project>" --json preview --format 9:16
cuttle -C "<project>" --json render --still 0
```

The sheet of the whole video; the seams, 0.2 s before and after each cut (here one at 5.0 s); the
smallest format the video goes to, for the phone; frame 0. Then:

1. Describe each still in one sentence as a stranger would, naming what is in it. A thing you would
   have to explain ("those bars are the takes") is a P0.
2. Read the stills in order without their words: do they tell the storyline, each one causing the
   next? Compare each with its line in SHOTS; what does not match is a note.
3. Name every default on screen (section 8, or one that is not on the list yet) and add it to
   BANNED.
4. Write each problem as one line, `t=4.2 s · scene s3 · problem → change`, and weigh it: **P0**
   breaks the read (unreadable, wrong, broken, a default in the hero shot), **P1** weakens the video
   (a dead stretch, a soft payoff, a seam that jumps), **P2** is polish.
5. Fix the P0s and the P1s worth their time: the words first, then the timing, then the detail. Look
   again only at what you changed. A video that feels busy loses a third of its motion and keeps the
   moves that lead the eye.

Then write into `STORY.md` the calls you made, the weakest shot and what you would change with more
time, so a later turn starts from there.
