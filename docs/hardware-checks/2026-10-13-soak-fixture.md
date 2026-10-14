# Soak test — 2026-10-13 — M1 Max, mains, recorded audio (PHI-178)

The first run of the app longer than a few minutes. It ran for 60 minutes in
real fullscreen against the `soak-medley.wav` fixture, not the DDJ-REV1. It
covers heat, memory, and duration. It does not cover the controller's audio
path, Serato's load on the chip, or USB dropouts (PHI-181). A run with the
controller is still needed for those.

Driven by `WAV=soak-medley.wav REAL_FS=1 MINUTES=60 node test/soak.mjs`,
21:09 to 22:09 EDT. Branch at `180a52f`.

## Setup

- **Machine:** MacBook Pro, M1 Max, ANGLE Metal renderer
- **Controller:** none. Chromium's fake audio device played the fixture.
- **Audio:** `soak-medley.wav`: broadband mix (kick, chord, hats) at 124, 128,
  120, 174, 85, and 126 BPM, 90 s each, hard cuts. It loops every 9 minutes,
  so each 10-minute window hears all six tempos.
- **Surface:** built-in display, real fullscreen, on its own Space
- **Rotation:** every 60 s over all modes but custom
- **Duration:** 60 minutes
- **Other load:** Serato was not running. At minute 35, CPU was 68% idle and
  the GPU 41% busy.

## Power

- **Source:** mains for the whole run
- **Low Power Mode:** off for the whole run
- **Battery:** 84% charging at the start, 100% charged at the end

## Physical state

Not recorded during this run. The thermal verdict below rests on the FPS
series and on macOS reporting no thermal warning. It does not include fan
noise or case temperature.

- **Fan / case:** not recorded
- **Surface under the laptop:** not recorded
- **Room:** not recorded

## Results

| Check | Result | Detail |
|---|---|---|
| Duration 60+ min | PASS | 60 min |
| FPS within 10% | PASS | worst p05 change: galaxy -7.1% |
| JS heap floor (MB) plateaus | PASS | 27.2 -> 27.5 (+0.9%) |
| DOM nodes plateaus | PASS | 146 -> 146 (0%) |
| Browser RSS (MB) plateaus | PASS, but see below | 1309.4 -> 1078.7 (-17.6%) |
| BPM no worse | PASS | jitter 0 -> 0 BPM, no-BPM 0 -> 0 |

FPS per mode, first ten minutes against last ten:

| Mode | p50 first | p50 last | p05 first | p05 last | p05 change | Slow /1000 first | Slow /1000 last |
|---|---|---|---|---|---|---|---|
| spectrum | 27 | 27 | 24 | 23 | -4.2% | 1000 | 1000 |
| particles | 59 | 59 | 50 | 49 | -2% | 0 | 0.3 |
| rings | 59 | 59 | 50 | 47 | -6% | 0 | 0 |
| waves | 59 | 59 | 57 | 57 | 0% | 0 | 0.9 |
| mandala | 59 | 59 | 57 | 56 | -1.8% | 0 | 0.3 |
| tunnel | 59 | 59 | 49 | 51 | +4.1% | 0 | 0 |
| galaxy | 59 | 59 | 56 | 52 | -7.1% | 0 | 0 |
| polygons | 59 | 59 | 49 | 51 | +4.1% | 0 | 0.3 |
| flow | 59 | 59 | 48 | 48 | 0% | 0 | 0 |

FPS bins are whole numbers rounded down, so 59.9 FPS reads 59. Spectrum's
27 FPS is the known PHI-174 failure on this machine, unchanged across the hour.

Memory per ten-minute window:

| From (min) | JS heap floor MB | DOM nodes | Browser RSS MB | Renderer RSS MB |
|---|---|---|---|---|
| 0 | 27.3 | 146 | 1249.5 | 433 |
| 10 | 27.2 | 146 | 1309.4 | 527 |
| 20 | 28.1 | 146 | 1320.8 | 529 |
| 30 | 30.4 | 146 | 1334.7 | 538 |
| 40 | 29.5 | 146 | 1340.3 | 551 |
| 50 | 27.5 | 146 | 1078.7 | 356-456 |

BPM by medley section, whole hour (share of samples):

| Tempo played | Most common reading | Second |
|---|---|---|
| 85 | 86 (83%) | 85 (6%) |
| 120 | 120 (77%) | 121 (14%) |
| 124 | 124 (84%) | 125 (16%) |
| 126 | 126 (88%) | 127 (5%) |
| 128 | 128 (87%) | 129 (6%) |
| 174 | 175 (77%) | 176 (17%) |

Page errors: 0. Frames skipped as hidden or unfocused: 0.

## What the numbers mean

**No thermal slide.** p50 is unchanged in every mode across the hour, and macOS
recorded no thermal warning. On mains, with the GPU 41% busy, the M1 Max does
not heat enough to slow the stage.

**No JavaScript leak.** The heap floor stays at 27 to 30 MB and the DOM at 146
nodes. A separate 5-minute test with 631 mode switches also held the floor flat
(17.5 to 19.1 MB), so the arrays rebuilt on a switch return their memory.

**Browser memory: not settled.** The RSS verdict passes, but for the wrong
reason. At minute 52 every browser process lost memory at once, the audio and
network processes too. That is macOS compressing memory system-wide, which RSS
does not count. Before it, the renderer climbed 527 -> 551 MB over 30 minutes,
about 48 MB an hour. That is inside the 10% limit, and the JS heap did not grow
with it, so the growth is outside JavaScript. Since this run, the driver also
records each process's footprint, which counts compressed pages, and the
analysis judges on that. The controller run will show whether the renderer
levels off.

**BPM: a fixed bias, no drift.** The estimator reads 85 as 86 and 174 as 175,
by the same amount at the start and at the end. Within the "a few BPM" rule in
`CONTRIBUTING.md`.

## Definition of done (PHI-178)

- [x] 60+ minutes of continuous running captured (recorded audio, not the controller)
- [x] FPS in the final ten minutes within 10% of the first ten
- [ ] Memory plateaus rather than climbing monotonically. JS heap and DOM: yes.
      Browser process memory: not settled; re-measure with footprint.
- [x] BPM behaviour at the end no worse than at the start
- [ ] Power configuration and physical setup recorded. Power: yes. Fan, case,
      and surface: not recorded.
- [ ] Anything that degrades gets its own ticket. Nothing failed. The renderer
      climb waits for the footprint re-measure before it gets a ticket.

## Still to do

A controller run: `LIVE=1 REAL_FS=1 node test/soak.mjs`, with Serato playing,
on mains, with fan and case notes at the start, at 30 minutes, and at the end.
