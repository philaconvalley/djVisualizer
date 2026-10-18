# Hardware check — 2026-10-18 — DDJ-REV1 with no network (PHI-270)

The four show modes run on the DDJ-REV1 with Wi-Fi off. The result is a pass.

The app loads no outside URLs: `index.html` and `app/*.js` reference only
local files and `vendor/`. This run confirms it on the hardware.

## How the run was made

A script turned Wi-Fi off and checked that `google.com` was unreachable. Then
it ran `LIVE=1 REAL_FS=1 MODES=spectrum,waves,mandala,flow ROTATE=120000
MINUTES=8 WINDOW=2 node test/soak.mjs`. At the end, it checked again that the
Mac was still offline. Then it turned Wi-Fi back on.

- Wi-Fi was the only network connection. No wired connection was active.
- The soak driver serves the repo from `127.0.0.1`, as `python3 -m http.server`
  does in the README. Only local files load.
- The driver switches the modes. The number keys were not tested in this run.

## Setup

- **Controller:** DDJ-REV1, selected by the app as `DJ · DDJ-REV1 (2b73:003f)`
- **Main at:** `7ef8eeb`
- **Surface:** the laptop panel, fullscreen
- **Display resolution:** 1512 x 982 CSS pixels (3024 x 1964 Retina)
- **Device pixel ratio:** 2
- **Music:** Serato DJ Pro, one track on deck Repeat. The app read 129 to 130
  BPM. The deck tempo was not recorded.
- **Power:** AC, battery charged, Low Power Mode off
- **Ambient light:** indoor, not recorded
- **Time:** 11:19 to 11:27, 10/18/2026

## Network

| When | Wi-Fi | `google.com` |
|---|---|---|
| Before the run | off | unreachable |
| After the run | off | unreachable |

## Results

Two minutes per mode. FPS counts only frames with the window in front.

| Mode | p50 FPS | p05 FPS | Min FPS | Slow /1000 | Samples | Skipped (hidden/unfocused) |
|------|---------|---------|---------|------------|---------|----------------------------|
| spectrum | 59 | 49 | 39 | 0.0 | 7195 | 0 |
| waves | 59 | 49 | 39 | 0.0 | 7105 | 0 |
| mandala | 59 | 56 | 36 | 0.0 | 7108 | 0 |
| flow | 59 | 49 | 42 | 0.0 | 7109 | 0 |

| Mode | BPM p50 (p05-p95) | Bass / mid / high, mean | Silent buckets |
|------|-------------------|-------------------------|----------------|
| spectrum | 130 (128-130) | 0.51 / 0.35 / 0.37 | 0 |
| waves | 129 (128-130) | 0.47 / 0.35 / 0.38 | 0 |
| mandala | 129 (128-130) | 0.51 / 0.36 / 0.38 | 0 |
| flow | 130 (128-131) | 0.47 / 0.34 / 0.38 | 0 |

Page errors: 0.

## Manual checklist (CONTRIBUTING.md)

This run checks the network only. The other items were not checked in it.

- [x] Controller enumerated, prefixed `DJ ·`
- [ ] Bass/mid/high meters each move independently
- [ ] Solo-bass / solo-hats each move only their own meter
- [ ] BPM settles within a few beats and holds through a mix, incl. a heavy mode
- [ ] Rail legible fullscreen from the back of the room, nothing important
      underneath it
- [ ] Reduce flash visibly damps beat accents

## Notes

- The soak report marks the duration and JS heap checks as failed. Those
  checks are for runs of an hour or more and do not apply here. The heap floor
  rose 28.0 to 37.5 MB over eight minutes. Eight minutes is too short to
  judge memory. PHI-268 covers memory over long runs.
- Nobody pressed the number keys. Before the event, open
  `?modes=spectrum,waves,mandala,flow` and check that keys 1 to 4 select the
  four modes.
