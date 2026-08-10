# DDJ-REV1 — MIDI control map

Measured 2026-08-10 against the physical controller, one control at a time, with
Serato DJ Pro running and holding the device — so this is the mapping under
performance conditions rather than with the DJ software closed.

Captured during the PHI-171 session; see `2026-08-10-ddj-rev1.md` in
`docs/hardware-checks/` for the run this came out of. Reference data only:
nothing in `app/` reads this yet. It exists so the implementation (PHI-179) does
not have to rediscover it.

## How the controller reports itself

```
input:  DDJ-REV1  [AlphaTheta Corporation]
output: DDJ-REV1
```

Read in Chrome via `navigator.requestMIDIAccess({ sysex: false })` at a secure
origin. **The browser and Serato read the device simultaneously** — CoreMIDI
shares it, and Serato does not claim it exclusively. That was the one risk that
could have ruled this approach out, so it is worth restating: it was tested, not
assumed.

Serato's connection *expands* the surface. Pads only appear across four MIDI
channels once Serato has the controller.

## The map

Every continuous control is a **14-bit MSB/LSB pair**, LSB exactly 32 above the
MSB, per the MIDI convention. Combine as `(msb << 7) | lsb` for 16,384 steps
rather than 128 — fine enough that a fader driving a visual parameter moves
smoothly instead of in visible stairs.

| Control | Ch | MSB / LSB | Type |
|---|---|---|---|
| Crossfader | 7 | CC 31 / 63 | 14-bit absolute |
| Channel 1 fader | 1 | CC 19 / 51 | 14-bit absolute |
| Channel 2 fader | 2 | CC 19 / 51 | 14-bit absolute |
| Channel 1 TRIM | 1 | CC 4 / 36 | 14-bit absolute |
| Channel 2 TRIM | 2 | CC 4 / 36 | 14-bit absolute |
| Channel 1 EQ HI | 1 | CC 7 / 39 | 14-bit absolute |
| Channel 1 EQ MID | 1 | CC 11 / 43 | 14-bit absolute |
| Channel 1 EQ LOW | 1 | CC 15 / 47 | 14-bit absolute |
| Channel 1 FILTER | 7 | CC 23 / 55 | 14-bit absolute |
| Channel 2 FILTER | 7 | CC 24 / 56 | 14-bit absolute |
| Tempo slider 1 | 1 | CC 0 / 32 | 14-bit absolute |
| Tempo slider 2 | 2 | CC 0 / 32 | 14-bit absolute |
| Jog 1 (top) | 1 | CC 34 | relative, centre 64 |
| Jog 2 (top) | 2 | CC 34 | relative, centre 64 |
| Browse knob | 7 | CC 64 | relative |
| PLAY deck 1 | 1 | note 11 | button |
| CUE deck 1 | 1 | note 12 | button |
| PAD 1 deck 1 | 8 | note 0 | pad |
| PAD 2 deck 1 | 8 | note 1 | pad |
| PAD 1 deck 2 | 10 | note 0 | pad |

## What the structure tells you

**The MIDI channel encodes the scope.** Deck controls sit on ch1/ch2, so the
channel identifies the deck. Mixer-wide controls — crossfader, both filters,
browse — sit on **ch7**. Pads sit on **ch8 (deck 1)** and **ch10 (deck 2)**.

That means "deck control or mixer control", and "which deck", are answerable from
the channel alone. The map stays a small structured thing rather than a flat
table of every CC on the device.

**Pads are sequential from note 0**, so the note number *is* the pad index. No
per-pad entry is needed.

**CC 33 is the jog touch sensor, not a control.** It fired as low-count noise
while unrelated controls were moved — n=39 during Channel 1 EQ LOW, n=21 during
Channel 2 FILTER — because a hand passed near the platter. Any auto-mapper that
picks "the loudest CC in the window" will mis-assign it. Ignore it unless
hand-on-platter is wanted as a signal in its own right, which is plausible but
was never isolated (see below).

**Throughput is roughly 420 messages/second**, overwhelmingly jog wheel. Trivial
to parse, but it must be coalesced to the frame before it touches render state.

## Suggested shape when this is implemented

```js
// Deck controls carry the deck in the MIDI channel; mixer controls live on ch7.
// Absolute controls are 14-bit: value = (msb << 7) | lsb, 0..16383.
const DDJ_REV1 = {
  absolute: {                        // "channel|msbCC" -> name
    '7|31': 'crossfader',
    '1|19': 'deck1.fader',    '2|19': 'deck2.fader',
    '1|4':  'deck1.trim',     '2|4':  'deck2.trim',
    '1|7':  'deck1.eq.high',  '1|11': 'deck1.eq.mid',  '1|15': 'deck1.eq.low',
    '7|23': 'deck1.filter',   '7|24': 'deck2.filter',
    '1|0':  'deck1.tempo',    '2|0':  'deck2.tempo'
  },
  relative: { '1|34': 'deck1.jog', '2|34': 'deck2.jog', '7|64': 'browse' },
  notes:    { '1|11': 'deck1.play', '1|12': 'deck1.cue' },
  pads:     { 8: 'deck1', 10: 'deck2' },   // note number is the pad index, 0-based
  ignore:   [33]                            // jog touch sensor
};
```

Data, not logic. It also makes the per-controller cost visible: supporting a
second controller is one more object like this, not a second code path.

## Unmeasured — do not treat as known

A confirmation pass for these was attempted on 2026-08-10 and captured nothing,
because the controller disconnected from the bus mid-pass. They are listed here
as open, not filled in by inference:

- **Channel 2's EQ.** Symmetry with channel 1 suggests ch2 CC 7/39, 11/43,
  15/47. Not verified.
- **Pads 3–8** on both decks. The sequential pattern suggests notes 2–7 on ch8
  and ch10. Not verified.
- **Deck 2 PLAY and CUE.** Symmetry suggests ch2 notes 11 and 12. Not verified.
- **CC 33 in isolation.** Never captured on its own, so "jog touch sensor" is
  read off its behaviour in other windows rather than measured directly.

Each is about thirty seconds of work with the controller attached.

## Reliability note

The DDJ-REV1 dropped off the USB bus **three times** during the 2026-08-10
session, unprompted, with Serato still running. Each time it vanished from
CoreAudio and from the MIDI device list together. Any feature built on this map
must treat disconnection as normal and handle `MIDIAccess.onstatechange`
accordingly — and the underlying cause is worth finding before a show, because
the same disconnection takes the audio input with it.
