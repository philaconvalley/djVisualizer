# Show-day checklist — 2026-10-20 — Founders Alley Philadelphia (PHI-269)

One page for the operator, in the order the day runs. It takes the show-day
advice from the 10/16 soak test (`2026-10-16-soak-ddj-rev1.md`, PHI-178) and the
pre-show check in `CONTRIBUTING.md` and puts them where you read them on the day.

**Operator:** ________ · **Who owns the outdoor sound, and does it have a line out:** ________

## The day before, in daylight (PHI-177)

The station is outdoors, on a TV, from the morning. Daylight washes out the
dark field and adds glare. Run this outside, in daytime, with the TV, the
laptop, and the DDJ-REV1 you use on 10/20. It takes about 70 minutes.

**TV owner (PhilaCon, Erik, or loaned):** ________ · **Outdoor power for the TV confirmed:** ________

Set up:

- [ ] Plug the laptop into mains. `pmset -g | grep lowpowermode` reads `0`.
- [ ] Open the show URL. Put the stage on the TV. Press <kbd>F</kbd>.
- [ ] Start audio. Play a track. All three meters move.

Legibility (with the panel shown, then hidden with <kbd>?</kbd>):

- [ ] Walk to the far edge of where the crowd will stand. Read the rail: BPM,
      FPS, and the three band meters. First item to become hard to read: ________
- [ ] The rail is not cut off at any edge of the TV (overscan).
- [ ] Shade and angle that make the screen readable: ________. If the canopy
      has arrived, test under it.

Modes in daylight. Press each key. Watch for a minute. The show URL only
allows these four.

| Key | Mode | Readable in daylight? | Notes |
|---|---|---|---|
| <kbd>1</kbd> | Spectrum Bars | | |
| <kbd>2</kbd> | Wave Forms | | |
| <kbd>3</kbd> | Mandala | | |
| <kbd>4</kbd> | Flow | | |

- [ ] A mode that washes out does not go in the 10/20 set. Take it out of the
      show URL, then bookmark the URL again.

Frame rate on the TV (PHI-174). A 4K TV can report a 3840-pixel width, which
changes the density budget.

- [ ] In the console: `await import('http://localhost:8000/test/hardware-probe.js')`,
      then `await hw.init()`, then `await hw.sweep()`. The sweep covers the four
      show modes. Keep the browser frontmost. Do not touch it.
- [ ] Copy `hw.toMarkdownTable()` into the record.
- [ ] Spectrum Bars p05 is 30 FPS or more. If not, take `spectrum` out of the
      show URL. The "Choppy frames" fix below then has no Spectrum key: use
      the steadiest mode from the table.

BPM readout against the deck (PHI-175):

- [ ] Three tracks: one under 100 BPM, one over 160, and one with a sparse or
      broken kick. For each, the app median is within 3 BPM of the deck, and
      the spread is under 10 BPM.
- [ ] Mix between two tempos. The readout follows the new tempo and does not stick.
- [ ] If any BPM check fails, treat the BPM readout as unchecked on 10/20. Do
      not call out a tempo from it.

Record:

- [ ] Write the results in `docs/hardware-checks/2026-10-19-daylight-tv.md`,
      from `TEMPLATE.md`. Attach a photo of the rail from the far edge of the crowd.

## The night before

- [ ] PHI-270 passed: the app runs from the local server with Wi-Fi off.
- [ ] Bookmark the show URL: `http://localhost:8000/?modes=spectrum,waves,mandala,flow`.
      Open the page, check that the Mode dropdown lists four modes, then press
      <kbd>Cmd</kbd>+<kbd>D</kbd>. Do not type the URL on the day. On 10/18, a
      cut-off URL loaded two modes, and keys 3 and 4 did nothing.
- [ ] PHI-177 passed: the stage is readable on the actual TV, outdoors, in daylight.
- [ ] Decide Reduce motion for the day, on or off. If on, turn it on in macOS:
      **System Settings → Accessibility → Display → Reduce motion.** Do not
      rely on the in-app toggle. A reload resets the toggle to the macOS
      setting, and the warning that offers it does not come back after a reload.

## Load-in

- [ ] Plug the laptop into mains. `pmset -g | grep lowpowermode` reads `0`.
      Low Power Mode halved the frame rate on 10/13.
- [ ] Connect the controller by USB **before** you open the browser.
- [ ] Start the local server: `python3 -m http.server 8000`. Open the show
      URL from the bookmark, not the Netlify URL.
- [ ] Open the Mode dropdown. It lists exactly four modes. If it lists fewer,
      the URL is cut off: open the bookmark again.
- [ ] Answer the flash warning.
- [ ] The source reads `DJ ·` and the controller name. If it reads
      `No DJ hardware found`, check the cable, then reload.
- [ ] Press <kbd>Space</kbd>. Play a track. All three meters move.
- [ ] No feed from the outdoor sound? The stage shows one slow breath. That is
      the app working as designed with no signal, not a fault. Fix the feed,
      not the app.
- [ ] Put the stage on the TV. Press <kbd>F</kbd> for fullscreen and
      <kbd>?</kbd> to hide the panel.

## During each set

The show URL limits the app to these four modes. They were the cleanest
through the soak hour.

| Key | Mode |
|---|---|
| <kbd>1</kbd> | Spectrum Bars |
| <kbd>2</kbd> | Wave Forms |
| <kbd>3</kbd> | Mandala |
| <kbd>4</kbd> | Flow |

The other number keys do nothing. No key can select Particles, Tunnel, or Galaxy,
which lost the most frame rate over an hour (PHI-267). No key can select Custom
Upload, which puts an upload target on the screen when no file is loaded.

## Between sets

- [ ] Reload the page (<kbd>Cmd</kbd>+<kbd>R</kbd>). A reload resets memory and
      frame pacing (PHI-267, PHI-268).
- [ ] Press <kbd>Space</kbd> to start audio again.
- [ ] Press your mode key. The mode resets on reload. The show list stays,
      because it is in the URL.
- [ ] If you chose Reduce motion: confirm the stage only glides. If beat strikes
      came back, macOS Reduce motion is off. Turn it on there.
- [ ] Press <kbd>F</kbd> and <kbd>?</kbd> again.

## If something goes wrong

| What you see | Do this |
|---|---|
| Stage only breathes slowly | No signal. Check the cable and the sound desk's output level. |
| Only the bass meter moves | The feed may be mono or too quiet. Ask for more level from the desk. |
| Choppy frames | Press <kbd>1</kbd> for Spectrum, then reload at the next break. |
| Controller missing from the source list | Unplug and replug it, then reload. |

## After the show

- [ ] Note anything that failed in the event debrief, with the time it happened.
