# Station links

Every station uses the same CodePen pen. Students open the link and edit the HTML box.
They need no account. CodePen keeps each student's changes in their own browser tab, so
one student's edits never reach another station. These URLs are what the workshop lead's
session tracker holds.

**Template pen:** <https://codepen.io/Waskar-Paulino-the-encoder/pen/Wbpjeax?editors=1000>

The `?editors=1000` part opens the HTML box only. The CSS and JS boxes stay closed.

## What is in the pen

The pen's source lives in [`codepen/`](codepen/). Change it there first, then paste it
into the pen and save the pen. The two must stay the same.

| File | Where it goes in the pen |
| --- | --- |
| [`codepen/head.html`](codepen/head.html) | Settings, HTML, "Stuff for `<head>`" |
| [`codepen/html-panel.html`](codepen/html-panel.html) | The HTML box |

The head lines load the machine from the live site. CodePen puts them in the page's
`<head>`, above the HTML box. That keeps the rule from `sandbox/index.html`: the browser
reads a page from the top down, so a student's typo in the HTML box cannot stop the
machine from loading. Do not move these lines into CodePen's "Add External Scripts"
list. CodePen places that list after the HTML box, below the student's part, where
one missing quote mark can swallow it.

## How the pen differs from `sandbox/index.html`

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
| The pen works on a Coded by: Chromebook | Not yet |
