# Contributing

Thanks for looking. This is a small, deliberately plain codebase, and the
fastest way to be useful is to understand three constraints before writing
anything.

## The three constraints

**1. Zero build.** No bundler, no transpiler, no runtime dependencies. The app
is `index.html`, three scripts in `app/`, one stylesheet, and a vendored copy of
p5. You open the file and it runs. This is protective rather than minimalist:
there is no build that can fail ten minutes before a set. Dev tooling in
`devDependencies` is fine. A compile step between source and running app is not.

**2. Nothing may require a network at showtime.** The venue's Wi-Fi is assumed
hostile. p5 is vendored in `vendor/` for exactly this reason — do not replace it
with a CDN tag. Anything new must be local, and any failure must be visible and
recoverable in the moment.

**3. The three bands are the product's idea, not a colour scheme.** Bass, mid,
and high are one composition seen three ways. A change that makes them
indistinguishable, or that makes them look like three unrelated things, breaks
the central concept even if it looks good in a screenshot.

## Running it

```sh
git clone https://github.com/philaconvalley/djVisualizer.git
cd djVisualizer
python3 -m http.server 8000    # or: npx serve .
```

Then open `http://localhost:8000`. A server is preferred over opening the file
directly — `getUserMedia` needs a secure context, and `localhost` counts.

You need an audio input. Any microphone works for development; DJ hardware is
auto-detected and sorted first when present.

## Verifying a change

```sh
npm install       # devDependencies only — Playwright
npm run verify
```

This runs the real app in Chromium against generated WAV files played through
the fake audio device. Everything below the physical hardware is the production
path: a real `MediaStream`, a real `AudioContext`, a real `AnalyserNode`, the
real FFT, the real DOM. Only the microphone is substituted.

It checks that a 100 Hz tone lights bass and nothing else, that 1 kHz lights mid,
that 10 kHz lights high, that four kick patterns are detected at their real
tempos, that all ten modes paint pixels without throwing, and that the meters
return to zero on stop. Screenshots of every mode land in `test/output/`.

One tempo fixture is not a bare kick. `kick-125bpm-bassline.wav` puts a bassline
on the dotted eighth, in the same band as the kick, because a bare kick is the
one signal a tempo estimator cannot get wrong — and a real 125 BPM track on the
DDJ-REV1 read 147-158 while every bare-kick fixture passed. When you add a
tempo fixture, make it something a DJ would actually play.

Run it before opening a pull request. It has already caught band splits that were
off by an order of magnitude and a beat detector that starved under render load —
neither of which was visible by looking at the app.

### Checking the deployed site

```sh
npm run smoke                                    # the live site
npm run smoke -- https://deploy-preview-9--dj-visualizer.netlify.app
```

Two different questions, and it is worth keeping them apart:

- `npm run verify` asks **does the code work** — real audio, real FFT, real
  render, in a local browser.
- `npm run smoke` asks **does the deployed site work** — which is not the same
  thing, and not something the host will tell you. A deploy reporting success
  says only that a build finished.

The smoke check loads the page, reads out every script and stylesheet it
actually references, and fetches each one. The assertion that matters is that
the response is not `index.html`: a host with a catch-all rewrite answers a
missing asset with the page and a 200, so the status looks healthy while the
browser gets HTML where it wanted a script and dies on `Unexpected token '<'`.
That is a real bug this repo shipped, and it survived two pull requests because
every check was green.

It reads the asset list from the page rather than a hard-coded list, so adding
a file cannot escape the check. That is deliberate: a stale hard-coded list is
what caused the original bug.

It runs on every merge to `main` and every six hours via
`.github/workflows/smoke.yml`.

On a merge the job first waits until the live site is serving that exact commit,
by polling `/build-info.json` — one small file the Netlify build writes naming
`COMMIT_REF`. Nothing in the app reads it, and it never exists locally. It is
there because a check that runs seconds after a merge would otherwise test the
*previous* build and pass, which is a green light for code that was never
checked. That is the same class of false signal the smoke check exists to
catch, and it would have been embarrassing to build it in.

**What it does not cover.** Device enumeration and DJ-hardware prioritisation,
USB line level and gain staging, sustained thermal behaviour, and the projector.
Those still need the controller in the room; see the checklist below.

## Hardware check before a show

Twenty minutes with the controller, in this order. Every step has a specific
thing to look at, because "it looked fine" is not a check.

1. **Connect the controller by USB before opening the browser.** Chrome
   enumerates devices at page load; a device plugged in afterwards may not be
   listed until you reload.
2. **Confirm the source.** The controller should already be selected, prefixed
   `DJ ·`, and listed above the built-in microphone. If it is not, the label did
   not match `isDJDevice()` and the prefix list needs the new name.
3. **Start, and watch the three meters with music playing.** All three should
   move independently. If bass moves and the others sit still, the input is
   likely mono-summed or the mixer's output level is low.
4. **Solo the bass on the mixer.** Only the bass meter should move. Then solo the
   hats: only high should move. This is the same check the automated band tests
   do, on the real signal chain — and it is the one that catches a wiring or
   channel-mapping problem the tone tests never see.
5. **Watch the BPM readout over a full track, against the deck's own display.**
   Write down what the deck says; an estimate compared against nothing proves
   nothing. It should land within a few BPM and stay there. On a mix it takes
   roughly the length of the onset window — about 12 seconds — to adopt the new
   tempo. Pick a track with a busy bassline, not just a clean four-on-the-floor:
   the failure this replaced only appeared on real music (PHI-175).
6. **Cycle all ten modes with keys 1–9 and 0 while the music plays.** Nothing should
   stall, and the FPS readout should stay usable. Spectrum and Particles are the
   documented safe modes on a slower machine.
7. **Go fullscreen and check the projector, not the laptop.** Confirm the console
   rail is legible from the back of the room and that nothing important sits
   underneath it.
8. **Toggle Reduce flash.** Confirm the beat accents visibly damp. This is a
   safety control, not a preference — see below.

## Adding a visualization mode

1. Add an `<option>` to `#visualMode` in `index.html`. Keys 1–9 then 0 map to
   dropdown order automatically, so position matters — and there are ten modes
   already, so an eleventh would need a shortcut scheme that is not digits.
2. Add a `case` to the switch in `DJVisualizer.draw()`.
3. Write the draw function. It must obey the stage grammar documented in the
   header of `app/visualizer.js` and explained in `DESIGN.md`:
   - Take colour from `this.colors.bass|mid|high`, which is read from the CSS
     tokens. Never hard-code a hue.
   - Read levels through `this.band('bass')`, never from `audioData` directly —
     that is what gives every mode the same response curve and the same honest
     behaviour in silence.
   - Draw light with `emissiveStroke` / `emissiveDot` rather than flat strokes.
   - Time motion off `this.phase` and `this.beat` rather than `this.time`, unless
     you specifically want something that ignores the music.
   - Compose inside `this.vw` × `this.vh`, which already excludes the rail.
4. Run `npm run verify` and look at your mode's screenshot in `test/output/`.

Do not reintroduce a `|| Math.sin(this.time)` fallback for a missing signal.
Every mode used to have one, and the result was that a dead input looked like a
loud room — a meter that invents a reading is worse than one that reads zero.

## Accessibility is not optional here

This app renders full-field luminance changes at beat rate and is projected to
audiences who did not opt in and cannot easily look away. WCAG 2.3.1 governs.

- Drive flashes and pulses from `this.beat`, which is already struck at the
  current flash allowance. Do not introduce a second luminance channel that
  bypasses it — the gating is at the source precisely so it cannot be forgotten.
- `prefers-reduced-motion` means reduced *flashing*, never a still visualizer —
  a visualizer with no motion has no function.
- `prefers-reduced-transparency` and `prefers-contrast` are honoured in CSS.
  Keep them working.

## Pull requests

Small and focused. Say what you changed and, more usefully, why. Include the
`npm run verify` result. If you changed how something looks, include the
before-and-after screenshots from `test/output/`.

Open an issue first for anything that touches the audio pipeline or adds a
dependency — those have constraints that are easier to discuss than to review.
