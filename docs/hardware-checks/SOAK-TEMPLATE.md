# Soak test — YYYY-MM-DD — <machine>, <mains | battery> (PHI-178)

Fill this in after `LIVE=1 REAL_FS=1 node test/soak.mjs`. The driver writes
the report to `test/output/soak-<start>.md`. Paste its tables under "Results".
Fill in "Physical state" by hand, during the run. The driver cannot measure it,
and a thermal result means nothing without it.

## Setup

- **Machine:** model and chip
- **Main at:** commit hash
- **Controller:** DDJ-REV1, as the app selected it (`DJ · ...`)
- **Audio:** Serato DJ Pro playing through the controller. Name the tracks or
  the playlist, and say whether the tempo changed during the hour.
- **Surface:** laptop panel / external display / TV — be specific
- **Display resolution and DPR:**
- **Rotation:** once a minute over all modes but custom (the default), or note
  the change
- **Duration:** minutes

## Power

- **Source:** mains / battery
- **Low Power Mode:** off for the whole run / on from minute N. Low Power Mode
  caps the frame rate, so an FPS drop after it turned on is not thermal.
- **Battery at start and end:** % (battery runs only)

## Physical state

Record these at the start, at 30 minutes, and at the end.

| When | Fan | Case temperature | Notes |
|------|-----|------------------|-------|
| Start | silent / audible / loud | cool / warm / hot | |
| 30 min | | | |
| End | | | |

- **Surface under the laptop:** hard desk / stand / soft surface
- **Room temperature:** about N °C, or indoor / outdoor in sun
- **Lid:** open / closed (clamshell on an external display)

## Results

Paste the driver's report here.

## Definition of done (PHI-178)

- [ ] 60+ minutes of continuous running captured
- [ ] FPS in the final ten minutes within 10% of the first ten
- [ ] Memory plateaus rather than climbing monotonically
- [ ] BPM behaviour at the end no worse than at the start
- [ ] Power configuration and physical setup recorded alongside the numbers
- [ ] Anything that degrades gets its own ticket

## Failures found

One line per failure, with the ticket it went to.
