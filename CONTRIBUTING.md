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
that 10 kHz lights high, that a 120 BPM kick pattern is detected as roughly 120,
that all ten modes paint pixels without throwing, and that the meters return to
zero on stop. Screenshots of every mode land in `test/output/`.

Run it before opening a pull request. It has already caught band splits that were
off by an order of magnitude and a beat detector that starved under render load —
neither of which was visible by looking at the app.

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
5. **Watch the BPM readout over a full track.** It should settle within a few
   beats and stay there through a mix. It reads the kick from the audio thread,
   so it should hold steady even when the visuals get heavy.
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
