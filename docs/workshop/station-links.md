# Station links

Every station uses the same CodePen pen. Students open the link and edit the HTML and CSS boxes.
They need no account. CodePen keeps each student's changes in their own browser tab, so
one student's edits never reach another station. These URLs are what the workshop lead's
session tracker holds.

**Template pen:** <https://codepen.io/Waskar-Paulino-the-encoder/pen/Wbpjeax?editors=1110>

The `?editors=1110` part opens the HTML, CSS, and JS boxes. The console stays closed.

## What is in the pen

The pen's source lives in [`codepen/`](codepen/). Change it there first, then paste it
into the pen and save the pen. The two must stay the same.

| File | Where it goes in the pen |
| --- | --- |
| [`codepen/head.html`](codepen/head.html) | Settings, HTML, "Stuff for `<head>`" |
| [`codepen/html-panel.html`](codepen/html-panel.html) | The HTML box: name, mode, boosts, and GIF |
| [`codepen/css-panel.css`](codepen/css-panel.css) | The CSS box: the three colours |
| [`codepen/js-panel.js`](codepen/js-panel.js) | The JS box: a note only. Students do not edit it |

The head lines load the machine from the live site. Since PHI-163 the machine is one ES module,
`sandbox/engine.js`, which imports the rest. A browser loads a module from another site only if
that site allows it, so `netlify.toml` sends `Access-Control-Allow-Origin` for `/app/*` and
`/sandbox/*`. Without that header the pen shows a black stage. CodePen puts them in the page's
`<head>`, above the HTML box. That keeps the rule from `sandbox/index.html`: the browser
reads a page from the top down, so a student's typo in the HTML box cannot stop the
machine from loading. Do not move these lines into CodePen's "Add External Scripts"
list. CodePen places that list after the HTML box, below the student's part, where
one missing quote mark can swallow it.

## How the pen differs from `sandbox/index.html`

- **Three boxes.** The colours are in the CSS box. The name, mode, boosts, and GIF are in the HTML
  box. The JS box holds only a note that says where the machine's code lives. CodePen puts
  the CSS box in `<head>` as its own style sheet, so an HTML typo cannot swallow the
  colours, and a CSS typo cannot touch the HTML.
- **No `<title>` edit.** The pen runs in a frame, so a student's title never reaches the
  browser tab.
- **No reload.** CodePen updates the picture by itself when the student stops typing. A
  student who reloads the whole page loses their changes, because they have no account
  to save to.
- **Music stops on each change.** Each update starts the picture again, so the student
  presses Play again after every edit.

## Checked

| Check | Result |
| --- | --- |
| The machine loads in the pen (2026-09-22, Chrome on macOS) | Yes |
| A missing quote mark in `dj-name` does not stop the machine (2026-09-22) | Yes |
| CodePen's frame allows the microphone and tab sharing (`allow` includes `microphone` and `display-capture`) | Yes |
| Tab audio plays through the visualizer in the pen (2026-09-22, Chrome on macOS, YouTube tab) | Yes |
| The pen and the main app work on a Coded by: Chromebook 3100, microphone input (2026-09-28, Miracle Chatman) | Yes. The microphone prompt, the picture, and the FPS readout work |
| The Coded by: network allows `codepen.io`, `cdpn.io`, and `dj-visualizer.netlify.app` (2026-09-28) | Yes |
| The BPM readout shows a number on the Chromebook (2026-09-28) | Not checked. It showed a dash, because the test song had no kick drum |
| "Choose a GIF" works on the Chromebook (2026-10-07) | Yes |
| No "Verify you are human" box appears in the pen on the Chromebook (2026-10-07) | Yes |
| Tab audio from a YouTube tab plays through the pen on the Chromebook | Not yet. Asked for the 10/21 run-through |
| "Choose a song" plays an MP3 through the pen on the Chromebook | Not yet. Asked for the 10/21 run-through |
| Flow, the template's default mode, stays smooth on the Chromebook | Not yet. Asked for the 10/21 run-through |
| The pen loads the machine as an ES module (PHI-163) after the new `head.html` is pasted into the pen | Not yet. Checked only in a two-origin local test, not on codepen.io |

## Frame rate on the Chromebook

The Chromebook 3100 has a slow processor. On 2026-10-17 the modes ran in a
headless browser with the processor slowed six times, as a rough model of it.
Particles, Rings, Tunnel, and Polygons kept their full frame rate. Spectrum,
Waves, and Flow fell to between 16 and 28 FPS. The model does not slow the
graphics chip, and the Chromebook's graphics chip is also much weaker. Only a
test on the real Chromebook gives the real numbers.

Flow is the mode the template starts in. If it is slow on the real Chromebook
at the run-through, change `mode="flow"` to `mode="rings"` in
[`codepen/html-panel.html`](codepen/html-panel.html) and in the pen.
