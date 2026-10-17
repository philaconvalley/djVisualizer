# Soak test — 2026-10-16 — M1 Max, mains, DDJ-REV1 and Serato (PHI-178)

The first hour-long run on the live signal chain: Serato DJ Pro playing
through the DDJ-REV1, the app reading the controller's input, and the stage in
real fullscreen on an external 4K display. It also confirms the Spectrum Bars
fix from PHI-266 under real load.

Driven by `LIVE=1 REAL_FS=1 node test/soak.mjs`, 21:48 to 22:48 EDT. Report:
`test/output/soak-2026-10-17T01-48-22-279Z.md`.

A first attempt at 21:44 was stopped after 3 minutes. Serato's master output
was down, so the app read silence. That run is not part of these results.

## Setup

- **Machine:** MacBook Pro, M1 Max, ANGLE Metal renderer, Chrome 151
- **Branch at:** `f1441af` (PHI-266, Spectrum Bars fix), on top of `main` at `76d3733`
- **Controller:** DDJ-REV1, selected by the app as `DJ · DDJ-REV1 (2b73:003f)`
- **Audio:** Serato DJ Pro 4.0.7. One track on Repeat for the whole hour:
  "Alright" (Kendrick Lamar), 110 BPM at +8.0% pitch, so 118.8 BPM on the
  deck. The tempo did not change. This Serato version shows no Auto Play
  setting, so Repeat kept the music from stopping.
- **Surface:** external 4K display (3840 × 2160, page saw 1920 × 1080 at
  device pixel ratio 2), real fullscreen. The laptop screen also showed Serato.
- **Rotation:** once a minute over all modes but custom
- **Duration:** 60 minutes

## Power

- **Source:** mains for the whole run
- **Low Power Mode:** off for the whole run
- **Battery:** 92% charging at the start, 100% charged at the end

## Physical state

| When | Fan | Case temperature | Notes |
|------|-----|------------------|-------|
| Start | not recorded | not recorded | |
| 30 min | quiet | warm, not hot | |
| End | not audible | warm | |

- **Surface under the laptop:** wood desk
- **Protective case:** none (the laptop never has one)
- **Room temperature:** indoor, not measured
- **Lid:** open

## Results

| Check | Result | Detail |
|---|---|---|
| Duration 60+ min | PASS | 60 min |
| FPS within 10% | FAIL | worst p05 change: particles -35.7% |
| JS heap floor (MB) plateaus | PASS | 31.9 -> 34.1 (+6.9%) |
| DOM nodes plateaus | PASS | 150 -> 150 (0%) |
| Browser footprint (MB) plateaus | PASS, but see below | 988.0 -> 1015.0 (+2.7%) |
| BPM no worse | PASS | jitter 26 -> 25 BPM, no-BPM 0 -> 0 |

FPS per mode, first ten minutes against last ten:

| Mode | p50 first | p50 last | p05 first | p05 last | p05 change | Slow /1000 first | Slow /1000 last | Result |
|---|---|---|---|---|---|---|---|---|
| spectrum | 59 | 59 | 57 | 54 | -5.3% | 0 | 0.6 | PASS |
| particles | 59 | 59 | 56 | 36 | -35.7% | 0 | 18.5 | FAIL |
| rings | 59 | 59 | 45 | 45 | 0% | 5.9 | 9.5 | PASS |
| waves | 59 | 59 | 57 | 54 | -5.3% | 0 | 0.3 | PASS |
| mandala | 59 | 59 | 57 | 54 | -5.3% | 0 | 2.2 | PASS |
| tunnel | 59 | 59 | 56 | 42 | -25% | 0 | 5.7 | FAIL |
| galaxy | 59 | 59 | 56 | 42 | -25% | 1.4 | 8.3 | FAIL |
| polygons | 59 | 59 | 37 | 48 | +29.7% | 10.5 | 6.1 | PASS |
| flow | 59 | 59 | 57 | 47 | -17.5% | 0.3 | 1.2 | FAIL |

FPS bins are whole numbers rounded down, so 59.9 FPS reads 59.

Frames under 40 FPS and under 50 FPS, all modes, per ten-minute window:

| From (min) | Frames | Under 40 FPS /1000 | Under 50 FPS /1000 |
|---|---|---|---|
| 0 | 34,818 | 10.7 | 30.6 |
| 10 | 34,513 | 16.8 | 55.0 |
| 20 | 34,469 | 18.0 | 63.1 |
| 30 | 34,622 | 13.5 | 40.8 |
| 40 | 34,200 | 26.1 | 78.6 |
| 50 | 34,037 | 29.2 | 68.2 |

Memory per ten-minute window, and footprint by process:

| From (min) | JS heap floor MB | DOM nodes | Browser footprint MB (median) |
|---|---|---|---|
| 0 | 30.7 | 150 | 965 |
| 10 | 31.9 | 150 | 988 |
| 20 | 34.1 | 150 | 994 |
| 30 | 34.5 | 150 | 1000 |
| 40 | 30.9 | 150 | 1005 |
| 50 | 34.1 | 150 | 1015 |

| Minute | Renderer footprint MB | GPU footprint MB | Total footprint MB |
|---|---|---|---|
| 0 | 129 | 608 | 904 |
| 10 | 222 | 647 | 1033 |
| 20 | 210 | 659 | 1033 |
| 31 | 228 | 650 | 1046 |
| 41 | 228 | 645 | 1041 |
| 51 | 236 | 656 | 1061 |
| 59 | 238 | 649 | 1056 |

| | First ten minutes | Last ten minutes |
|---|---|---|
| BPM median (p05-p95) | 62 (53-138) | 62 (53-145) |
| Bands bass / mid / high | 0.406 / 0.367 / 0.222 | 0.405 / 0.367 / 0.222 |
| Frames skipped (hidden / unfocused) | 0 / 0 | 0 / 0 |

Page errors: 0. Silent buckets: 0.

## What the numbers mean

**Spectrum Bars is fixed (PHI-266).** It held p50 59 FPS and p05 54 to 57
for the whole hour, with Serato running. On 10/13 it ran at 27 FPS.

**Slow frames grow over the hour.** The median stayed at 59 FPS in every mode.
Frames under 40 FPS rose from 10.7 to 29.2 per 1,000, and the frame count per
window fell 2.2%. Visit to visit the numbers bounce rather than slide, and
macOS recorded no thermal warning. The 10/13 run had almost no slow frames, but
it differed in two ways: no Serato, and the laptop screen instead of a 4K
display. This run cannot tell heat, Serato, and the display apart.

**No JavaScript leak.** The heap floor stayed at 31 to 35 MB with no trend,
and the DOM at 150 nodes.

**Browser memory climbs slowly.** The footprint median rose in every window,
965 to 1,015 MB, about 50 MB an hour. That is inside the 10% limit, so the
check passes. It is still a climb, not a plateau. The renderer grew 222 to
238 MB after the first ten minutes while the JS heap stayed flat, so the growth
is inside Chrome, not in the app's JavaScript. This matches the renderer climb
seen on 10/13 (about 48 MB an hour, measured on RSS).

**BPM reads half tempo on this track.** The deck showed 118.8 BPM. The app
read a median of 62, with a wide spread. The reading did not get worse over
the hour, so the soak check passes, but the accuracy belongs to PHI-175.

**The controller held.** Sound reached the app in every bucket, so the USB
dropouts of PHI-181 did not recur.

## Definition of done (PHI-178)

- [x] 60+ minutes of continuous running captured: 10/13 on recorded audio,
      10/16 on the DDJ-REV1 with Serato
- [ ] FPS in the final ten minutes within 10% of the first ten. p50: yes, in
      every mode. p05: no, in four modes. Filed as PHI-267.
- [ ] Memory plateaus rather than climbing monotonically. JS heap and DOM:
      yes. Browser footprint: a slow climb of about 50 MB an hour. Filed as PHI-268.
- [x] BPM behaviour at the end no worse than at the start
- [x] Power configuration and physical setup recorded. The start note for fan
      and case was not taken.
- [x] Anything that degrades gets its own ticket: PHI-267 and PHI-268.

## Failures found

- Slow frames rise about three times over an hour with Serato on a 4K display.
  Ticket: PHI-267.
- Browser footprint climbs about 50 MB an hour, outside the JS heap. Ticket:
  PHI-268.
- BPM reads half tempo on "Alright" at 118.8 BPM. Belongs to PHI-175.

## For Founders Alley (10/20)

The event runs all day, and this test covered one hour. Reload the page between
sets: a reload resets both the memory and the frame pacing. Spectrum, Waves,
Mandala, and Flow were the cleanest modes through the hour.

The operator checklist for the day is
[`2026-10-20-founders-alley-checklist.md`](2026-10-20-founders-alley-checklist.md) (PHI-269).
