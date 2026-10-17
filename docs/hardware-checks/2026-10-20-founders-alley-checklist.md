# Show-day checklist — 2026-10-20 — Founders Alley Philadelphia (PHI-269)

One page for the operator, in the order the day runs. It takes the show-day
advice from the 10/16 soak test (`2026-10-16-soak-ddj-rev1.md`, PHI-178) and the
pre-show check in `CONTRIBUTING.md` and puts them where you read them on the day.

**Operator:** ________ · **Who owns the outdoor sound, and does it have a line out:** ________

## The night before

- [ ] PHI-270 passed: the app runs from the local server with Wi-Fi off.
- [ ] PHI-177 passed: the stage is readable on the actual TV, outdoors, in daylight.
- [ ] Decide Reduce motion for the day, on or off. If on, turn it on in macOS:
      **System Settings → Accessibility → Display → Reduce motion.** Do not
      rely on the in-app toggle. A reload resets the toggle to the macOS
      setting, and the warning that offers it does not come back after a reload.

## Load-in

- [ ] Plug the laptop into mains. `pmset -g | grep lowpowermode` reads `0`.
      Low Power Mode halved the frame rate on 10/13.
- [ ] Connect the controller by USB **before** you open the browser.
- [ ] Start the local server: `python3 -m http.server 8000`. Open
      `http://localhost:8000`, not the Netlify URL.
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

Use only these four modes. They were the cleanest through the soak hour.

| Key | Mode |
|---|---|
| <kbd>1</kbd> | Spectrum Bars |
| <kbd>4</kbd> | Wave Forms |
| <kbd>5</kbd> | Mandala |
| <kbd>0</kbd> | Flow |

Keys 2, 6, and 7 are Particles, Tunnel, and Galaxy. They lost the most frame
rate over an hour (PHI-267). Key 9 is Custom Upload. With no file loaded, it puts
an upload target on the screen.

## Between sets

- [ ] Reload the page (<kbd>Cmd</kbd>+<kbd>R</kbd>). A reload resets memory and
      frame pacing (PHI-267, PHI-268).
- [ ] Press <kbd>Space</kbd> to start audio again.
- [ ] Press your mode key. The mode resets on reload.
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
