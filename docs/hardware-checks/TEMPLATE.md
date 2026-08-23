# Hardware check — YYYY-MM-DD — <label>

Fill this in from `test/hardware-probe.js`'s `hw.sweep()` output
(`toMarkdownTable()` produces the table below directly) plus the manual
checklist in `CONTRIBUTING.md`'s "Hardware check before a show" section.

## Setup

- **Controller:** DDJ-REV1 (or note the actual device)
- **Surface:** laptop panel / external display / projector — be specific
- **Display resolution:** `window.screen.width` x `window.screen.height`
- **Device pixel ratio:** `window.devicePixelRatio`
- **Music:** track(s) used, and whether the bassline was busy enough to stress
  BPM detection (PHI-175)
- **Ambient light:** dark room / representative venue lighting — matters for
  projector legibility checks (PHI-177), not for FPS

## Sweep results

| Mode | p50 FPS | p05 FPS | Samples |
|------|---------|---------|---------|
| spectrum | | | |
| particles | | | |
| rings | | | |
| waves | | | |
| mandala | | | |
| tunnel | | | |
| galaxy | | | |
| polygons | | | |
| flow | | | |
| custom | (skipped unless media loaded) | | |

## Manual checklist (CONTRIBUTING.md)

- [ ] Controller enumerated, prefixed `DJ ·`, sorted above built-in mic
- [ ] Bass/mid/high meters each move independently
- [ ] Solo-bass / solo-hats each move only their own meter
- [ ] BPM settles within a few beats and holds through a mix, incl. a heavy mode
- [ ] Rail legible fullscreen from the back of the room, nothing important
      underneath it
- [ ] Reduce flash visibly damps beat accents

## Notes

Anything that failed gets its own ticket rather than a note here (per PHI-171's
Definition of Done). Record only what was actually measured — mark any
reconstructed or estimated figure explicitly as such, don't blend it in as if
it were a fresh reading.
