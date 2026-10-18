# Soak test — 2026-10-17 — MacBook Pro M1 Max, mains (PHI-268)

A three-hour run to see whether browser memory levels off. It uses the
fixture file, not the controller: `MINUTES=180 REAL_FS=1 node test/soak.mjs`.

## Setup

- **Machine:** MacBook Pro, Apple M1 Max (ANGLE Metal renderer)
- **Main at:** `9291985` on the PHI-268 branch (`1dc2f9d` plus the per-process report)
- **Controller:** none. The fixture run plays `broadband-124bpm.wav` as the input.
- **Audio:** `broadband-124bpm.wav` in a loop, 124 BPM, no tempo change
- **Surface:** the laptop panel, the main display. The driver set no window
  position. An LG UltraFine 4K was also connected when the results were
  written; nobody confirmed it was connected during the runs.
- **Display resolution and DPR:** 3024 x 1964 Retina, DPR 2
- **Rotation:** once a minute over all modes but custom (the default)
- **Duration:** 180 minutes, 22:01 to 01:01

## Power

- **Source:** mains for the whole run
- **Low Power Mode:** off for the whole run
- **Battery at start and end:** 22% charging, 80% charged

## Physical state

Nobody watched the run. Fill in what you know, or leave it blank.

| When | Fan | Case temperature | Notes |
|------|-----|------------------|-------|
| Start | ____ | ____ | |
| 30 min | ____ | ____ | |
| End | ____ | ____ | |

- **Surface under the laptop:** ____
- **Room temperature:** ____
- **Lid:** open

## Answer to PHI-268

The climb slows a little but does not level off within three hours.

Rates are least-squares fits to the one-minute samples, in MB an hour:

| Process | Hour 1 (min 10-60) | Hour 2 (min 60-120) | Hour 3 (min 120-180) |
|---|---|---|---|
| Browser total | 20.7 | 15.3 | 13.4 |
| Renderer | 15.5 | -0.7 | 5.0 |
| GPU | 2.5 | 14.7 | 7.4 |
| Storage | 1.7 | 1.4 | 0.9 |

- The total climbs about 52 MB over the run (871 to 923 MB, window means).
  That is 13 to 21 MB an hour, not the 50 MB an hour in the ticket.
- The JavaScript heap (27 to 31 MB) and the DOM (146 nodes) stay flat. The
  growth is outside the JavaScript heap, as the ticket says.
- The renderer does not slow steadily. It climbs in hour 1, holds in hour 2,
  and climbs again in hour 3.
- The GPU process jumps about 24 MB at minute 71 (514 to 538 MB). Without
  that step, it climbs about 4 MB an hour.
- The audio, network, and video capture processes stay flat. This does not
  clear audio buffers: the app's Web Audio buffers live in the renderer.
- Power stayed on AC with Low Power Mode off. No frames were skipped for focus
  or visibility. The page logged 0 errors. 177 of 180 host samples are present.

## Results

Run 2026-10-18T02:01:15.233Z, 180 min, 10-minute windows.
Rotation: every 60 s over spectrum, particles, rings, waves, mandala, tunnel, galaxy, polygons, flow.

| Check | Result | Detail |
|---|---|---|
| Duration 60+ min | PASS | 180 min |
| FPS within 10% | FAIL | worst p05 change: rings -15.8% |
| JS heap floor (MB) plateaus | PASS | 27.7 -> 28.4 (+2.5%) |
| DOM nodes plateaus | PASS | 146 -> 146 (0%) |
| Browser footprint (MB) plateaus | PASS | 869.0 -> 921.0 (+6%) |
| BPM no worse | PASS | jitter 0 -> 0 BPM, no-BPM 0 -> 0 |

FPS per mode, first window against last:

| Mode | p50 first | p50 last | p50 change | p05 first | p05 last | p05 change | Slow /1000 first | Slow /1000 last | Result |
|---|---|---|---|---|---|---|---|---|---|
| spectrum | 59 | 59 | 0% | 56 | 55 | -1.8% | 0.1 | 0.3 | PASS |
| particles | 59 | 59 | 0% | 56 | 48 | -14.3% | 0 | 0.3 | FAIL |
| rings | 59 | 59 | 0% | 57 | 48 | -15.8% | 0 | 0.3 | FAIL |
| waves | 59 | 59 | 0% | 57 | 54 | -5.3% | 0 | 0.3 | PASS |
| mandala | 59 | 59 | 0% | 57 | 53 | -7% | 0 | 0.3 | PASS |
| tunnel | 59 | 59 | 0% | 52 | 49 | -5.8% | 0 | 0.3 | PASS |
| galaxy | 59 | 59 | 0% | 57 | 52 | -8.8% | 0 | 0.3 | PASS |
| polygons | 59 | 59 | 0% | 51 | 48 | -5.9% | 0 | 0.2 | PASS |
| flow | 59 | 59 | 0% | 48 | 55 | +14.6% | 0 | 0.1 | PASS |

Memory per window:

| From (min) | JS heap floor MB | DOM nodes (median) | Browser footprint (MB) (median) |
|---|---|---|---|
| 0 | 27.4 | 146 | 848.0 |
| 10 | 27.7 | 146 | 869.0 |
| 20 | 29.6 | 146 | 877.0 |
| 30 | 29.7 | 146 | 878.0 |
| 40 | 28.8 | 146 | 882.0 |
| 50 | 31.4 | 146 | 885.0 |
| 60 | 31.7 | 146 | 888.0 |
| 70 | 29.4 | 146 | 908.0 |
| 80 | 27.4 | 146 | 910.0 |
| 90 | 28.2 | 146 | 906.0 |
| 100 | 29.1 | 146 | 908.0 |
| 110 | 29.5 | 146 | 907.0 |
| 120 | 29.2 | 146 | 915.0 |
| 130 | 27.3 | 146 | 913.0 |
| 140 | 27.3 | 146 | 915.0 |
| 150 | 29.3 | 146 | 916.0 |
| 160 | 29.2 | 146 | 918.0 |
| 170 | 28.4 | 146 | 921.0 |

Browser footprint (MB) per process, median per window. Reported, not judged:

| From (min) | browser | renderer | GPU | network | storage | audio | video_capture |
|---|---|---|---|---|---|---|---|
| 0 | 62.0 | 191.0 | 509.0 | 22.0 | 19.0 | 30.0 | 23.0 |
| 10 | 62.0 | 200.0 | 513.0 | 22.0 | 20.0 | 30.0 | 25.0 |
| 20 | 62.0 | 201.0 | 514.0 | 22.0 | 20.0 | 30.0 | 25.0 |
| 30 | 63.0 | 207.0 | 513.0 | 22.0 | 21.0 | 30.0 | 25.0 |
| 40 | 62.0 | 209.0 | 514.0 | 22.0 | 21.0 | 30.0 | 25.0 |
| 50 | 63.0 | 212.0 | 514.0 | 22.0 | 21.0 | 30.0 | 25.0 |
| 60 | 63.0 | 211.0 | 515.0 | 22.0 | 21.0 | 30.0 | 25.0 |
| 70 | 63.0 | 213.0 | 535.0 | 22.0 | 22.0 | 30.0 | 25.0 |
| 80 | 63.0 | 213.0 | 535.0 | 22.0 | 22.0 | 30.0 | 25.0 |
| 90 | 63.0 | 213.0 | 534.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 100 | 63.0 | 212.0 | 533.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 110 | 63.0 | 213.0 | 532.0 | 22.0 | 22.0 | 30.0 | 25.0 |
| 120 | 63.0 | 217.0 | 534.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 130 | 63.0 | 216.0 | 534.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 140 | 63.0 | 215.0 | 537.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 150 | 63.0 | 214.0 | 539.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 160 | 63.0 | 218.0 | 539.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| 170 | 63.0 | 221.0 | 541.0 | 22.0 | 23.0 | 30.0 | 25.0 |
| Second -> last window | +1.6% | +10.5% | +5.5% | 0% | +15% | 0% | 0% |

| | First window | Last window |
|---|---|---|
| FPS p50 / p05 (all modes) | 59 / 56 | 59 / 51 |
| BPM median (p05-p95) | 124 (124-124) | 124 (124-125) |
| Bands bass / mid / high | 0.396 / 0.45 / 0.551 | 0.396 / 0.45 / 0.551 |
| Frames skipped (hidden / unfocused) | 0 / 0 | 0 / 0 |
| Host | AC Power, battery 22%; charging, Low Power Mode off, thermal: none recorded | AC Power, battery 80%; AC attached, Low Power Mode off, thermal: none recorded |

Page errors: 0

## Memory-infra run, 2026-10-18

A second run finds which memory pool grows. It runs for 62 minutes at
`5352d83`, on AC power, with Low Power Mode off:
`MINUTES=62 REAL_FS=1 MEMDUMP=10,35,60 node test/soak.mjs`.
The driver takes a detailed Chrome memory dump at minutes 10, 35, and 60.

No pool climbs steadily. The three sources the ticket names are flat:

| Pool | Process | Minute 10 | Minute 35 | Minute 60 | What it holds |
|---|---|---|---|---|---|
| `webgl` | renderer | 258.6 | 258.6 | 258.6 | the WebGL context |
| `malloc` | renderer | 43.4 | 42.2 | 43.2 | general native memory |
| `partition_alloc` | renderer | 26.1 | 25.9 | 25.8 | Blink objects and array buffers, Web Audio buffers included |
| `iosurface` | GPU | 214.4 | 219.7 | 217.1 | GPU textures shown on screen |
| `gpu` | GPU | 100.0 | 95.0 | 100.0 | GPU command and texture memory |
| `canvas` | renderer | 29.8 | 34.8 | 29.8 | canvas backing stores |
| `cc` | renderer | 26.2 | 31.5 | 28.8 | compositor tiles |

Sizes are in MB. Pools that go up and come back down are caches. Each dump
came in a different mode (particles, flow, galaxy), and each mode fills the
caches by a different amount.

At the dump minutes, the renderer footprint reads 200, 206, then 203 MB. The
GPU process reads 514, 521, then 519 MB.

Two numbers in this run's report are not app memory:

- The network, storage, audio, and video capture services each gain 4 to 5 MB
  at the first dump. That is the trace's own buffers.
- A tracing service process (61 MB) runs from the first dump to the end.

**Conclusion.** The three-hour run shows a slow climb of 13 to 21 MB an hour.
One hour of dumps finds no pool that leaks. The WebGL context, the GPU
textures, and the audio buffers are flat at this resolution. Any steady
climb is smaller than the normal swing of the caches. A six-hour show at this
rate adds about 100 MB.

To find a climb this small, a later run needs three hours of dumps, all taken
in the same mode.

## Failures found

- FPS p05 fails in the last window: particles -14.3%, rings -15.8%. The p50
  stays at 59 in every mode. The memory-infra run repeats it in the same two
  modes, within one hour: particles -14.3%, rings -13%. No ticket yet.
