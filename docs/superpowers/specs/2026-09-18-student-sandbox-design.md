# Student Sandbox — Design

> **Redacted for a public repository.** This document is kept for its technical
> reasoning. The venue, the session dates and times, the partner organisation and
> the workshop lead's name were removed before publication, because this repository
> is public and the sessions involve minors. The unredacted copy lives outside the
> repository.


**Ticket:** PHI-223 — Set up a beginner HTML sandbox where students change how the visualizer looks
**Date:** 2026-09-18
**Status:** Awaiting review by Waskar. No code written.
**Related:** PHI-222 (custom GIF fails to load), PHI-226 (lab laptop test), PHI-232 (offline backup)

---

## 1. Why this exists

The workshop "Your Playlist, Brought to Life" runs two autumn sessions at the partner's venue. Each session has 100 minutes of programmed time. The
promotional description tells families that students "use HTML to code and change how the whole
thing looks."

Students need a page they can open with no account, edit in one place, reload, and see change. The
audio and drawing code must stay somewhere a student cannot break it.

### Corrections to the ticket

The ticket was written on 9/16. the workshop lead's email of 2026-09-17 changes four things in it.

| Ticket says | Actually true |
| --- | --- |
| One audience, both sessions | The first session is middle school. The second is high school. |
| "Innovation Lab laptop" | Chromebooks running Chrome. Model to follow. |
| Use CodeHS; confirm before another host | CodePen **or** CodeHS, "whichever is simpler on your end" |
| In-person practice session | The run-through is virtual |

Also from that email: the room has HDMI and USB-C into a TV with audio through it, the venue Wi-Fi
is an open guest network, and the workshop lead's "tracker" is a page of links set up at the
run-through.

---

## 2. Decisions this design assumes

| Decision | Who | When |
| --- | --- | --- |
| CodePen is the host | Waskar, on the workshop lead's written approval | 2026-09-18 |
| A student edits HTML and CSS, never JavaScript | Waskar and the workshop lead | 2026-08-28 |
| Start here / level up / boss edit ladder | The workshop lead | 2026-08-18 |
| YouTube tab capture leads; a file library is the fallback | Waskar | 2026-09-18 |
| The shared submit-a-link playlist is a separate ticket | Waskar | 2026-09-18 |

### Non-goals

- The shared playlist queue that drives the room TV. Its own ticket.
- Spotify and Apple Music. See §4.
- Any change to `index.html`, `app/app.js`, or the live DJ application.

---

## 3. Findings that constrain the design

Each of these was verified, not assumed.

1. **CodePen grants the permissions the visualizer needs.** Its preview iframe carries
   `allow="... camera; display-capture; microphone; ..."` and a sandbox with `allow-scripts` and
   `allow-same-origin`. Verified in Chrome on 2026-09-18 on both the new-pen page and the editor.
2. **CodePen needs no student account.** A shared pen opens, edits, and runs without signing in.
   Waskar already holds an account for creating the station pens.
2a. **The workshop lead has the visualizer link.** Sent 2026-09-18 with three checks: microphone prompt,
   visuals moving to music, and BPM and FPS reading numbers. She tests on a Chromebook early the
   week of 2026-09-21.
3. **The live site cannot be framed.** `netlify.toml:14` sets `X-Frame-Options = DENY`. A pen must
   load `app/*.js` with script tags. It can never put the app in an iframe.
4. **Our CSP blocks outside media.** `netlify.toml:19` sets `default-src 'self'` and
   `media-src 'self' blob:`. A student GIF must be a CodePen upload or live in this repository.
   This bears on PHI-222.
5. **The band colors are already tokens.** `app/visualizer.js:154` reads `--bass`, `--mid`, and
   `--high` from `:root` at run time. `parseColor` at line 162 returns `null` for anything it
   cannot read, and the caller keeps the previous value.
6. **The audio graph has a clean seam.** `app/audioProcessor.js:436` `startAudio()` acquires a
   stream, then builds the graph. Everything from line 487 onward is source-agnostic.

---

## 4. Why streaming services are excluded

A Spotify or Apple Music player runs in a cross-origin iframe. The Web Audio API reads samples only
from media on the same page, so no analyser can reach it. Both services then add DRM, and Chrome
refuses to capture protected content. Tab capture returns silence.

YouTube carries no DRM on standard videos, so tab capture reads it. This has not been tested here,
and §8 treats it as the design's first risk.

---

## 5. Architecture

Three layers. The student touches one.

### 5.1 Engine

The existing `app/audioProcessor.js`, `app/visualizer.js`, and `vendor/p5.min.js`, served from the
Netlify origin and loaded by the pen with script tags.

`app/app.js` does not come along. It binds to the exact markup in `index.html`: the transport
button, the device select, three band sliders, the mode select, the readouts, and the help dialog.
Reproducing that markup in a student file is the opposite of what the ticket asks for.

So the engine gains a second entry point, `sandbox/engine.js`. It defines a custom element,
builds its own canvas and a small control rail, and reads the student's values from the DOM. It
imports the same analyser and the same visualizer. `index.html` and `app/app.js` are not modified,
so the live DJ application is unaffected.

**The student's file is a configuration, not a program.**

### 5.2 Student file

One `index.html` in the pen. A title, a `:root` block of colors, and one custom element. Nothing
else. §6 gives the contract.

### 5.3 Station links

One pen per station, shared as a plain URL. A student opens it, edits, and reloads without an
account and without saving. Those URLs are what the workshop lead's link tracker holds.

The CodePen editor reports a file cap ("3/3 Files") on the current plan. The design uses one HTML
file per pen and loads every script from our origin, so it fits inside that cap. Confirm the cap
before adding a second student file.

---

## 6. The student contract

```html
<title>My Playlist, Brought to Life</title>

<style>
  :root {
    --bass: #ff453a;   /* the low drums you feel in your chest */
    --mid:  #30d158;   /* the voice and most instruments */
    --high: #0a84ff;   /* the cymbals and the bright edges */
  }
</style>

<dj-visualizer dj-name="DJ NOVA" mode="flow" gif=""></dj-visualizer>
```

Three surfaces, all of them genuinely HTML and CSS, which is what the promotional description
promised families.

| Surface | Controls | Failure behavior |
| --- | --- | --- |
| `<title>` | The browser tab name | Empty title. Nothing else changes. |
| `:root` custom properties | The three band colors | An unreadable value keeps the previous color, and the rail names the token |
| `<dj-visualizer>` attributes | DJ name, mode, GIF path | Unknown attribute ignored; invalid value falls back |

`--stage` was in this table and is not in the product. The canvas paints its own background on
every frame, so the token changed nothing a student could see. An edit that does nothing is worse
than one the file never offered, and making it work means changing the live app's draw path.
Removed from `sandbox/index.html` during Task 5, and filed as a follow-up.

`mode` accepts nine values. `custom` is not one of them: it draws the GIF, so without a GIF it
renders an empty pulsing square. `gif` selects that mode on its own.

### Why a typo cannot stop the audio

This is the ticket's second Done-when condition, and the design answers it by choice of language
rather than by defensive code.

HTML has no syntax error that halts parsing. A malformed attribute is ignored. A missing quote
swallows one tag and the parser continues. There is no student-authored JavaScript in the file, so
there is no statement that can throw and stop the engine.

CSS behaves the same way. A declaration the parser cannot read is dropped, and the rest of the
block applies.

`sandbox/engine.js` validates every attribute it reads and substitutes a default. It never assumes
an attribute is present or well-formed.

### The edit ladder

Written out in full in `docs/workshop/edit-ladder.md`, in the workshop lead's format.

- **Start here** — change `--bass` to your favorite color. Reload.
- **Level up** — change the title, the DJ name, and the mode.
- **Boss** — add your own GIF, then paste a YouTube link and share the tab.

---

## 7. The audio change

`startAudio()` splits in two. The graph half — audio context, analyser at `fftSize` 2048, the kick
worklet, the buffers, and the 60 Hz analysis timer — moves into `attachStream(stream)` unchanged.
No band split, no beat detection, and no tempo behavior changes.

Three acquirers feed it.

| Method | Source | Role |
| --- | --- | --- |
| `startTabAudio()` | `getDisplayMedia({ video: true, audio: true })` | The default. The boss rung. |
| `startFileAudio(source)` | `<audio>` on a `File` or a URL, connected to the analyser and to the speakers | The fallback |
| `startAudio(deviceId)` | `getUserMedia`, exactly as today | Unchanged. The live DJ app depends on it. |

`startFileAudio` connects the element to the destination as well as to the analyser, so the student
hears the track. The microphone path does not, and must not.

`stop()` gains the matching teardown for a media element source.

### Why the microphone is not the default

Twelve students in one room, each visualizing through a microphone, hear each other's songs.
The workshop lead is sourcing headphones, and the microphone path fails completely the moment headphones go
on. This is true independently of the request for song playback.

---

## 8. Risks

| Risk | Severity | Handling |
| --- | --- | --- |
| Tab audio capture does not work on ChromeOS | Blocks the chosen default | The probe in §10, step 1. Fails safe to the file path. |
| The share dialog defeats a 6th grader | Costs session minutes | Watch it at the run-through. The file path is the same button. |
| Twelve Chromebooks streaming YouTube over venue guest Wi-Fi | Session-wide | The file library needs no network. Tracks travel on a USB stick per station. |
| PHI-222 unresolved; the GIF rung fails | One rung of three | The boss rung is last. Start here and level up do not touch GIFs. |
| Commercial tracks in footage Caitlin posts | Reputational, minor | Keep instrumental or royalty-free tracks for anything filmed. |

### Open questions

- The CodePen file cap on Waskar's plan. Three files is enough for this design; confirm it.

**Closed on 2026-09-18:**

- *How files reach twelve Chromebooks.* A USB stick per station. PhilaCon Valley already owns USB
  drives for DJing, so this costs nothing and needs nothing from the partner. The file source
  therefore works with no network and no help from the fleet's administrators, which also settles
  most of PHI-232.

---

## 9. Verification

- `test/verify-sandbox.mjs` loads the sandbox with a deliberately mangled color and a mangled
  attribute, then asserts the canvas paints and the analyser reads. This is the Done-when condition
  made executable.
- The test drives the **file** source, not tab capture. Playwright cannot operate the native share
  dialog. Tab capture is therefore verified by hand, once by Waskar and once by the workshop lead, per §10
  step 1. The spec states this rather than leaving a gap the test appears to cover.
- `npm run verify` must stay green. The live DJ app is untouched, so a regression there means the
  `attachStream` split was wrong.
- `npm run smoke` covers content types for the new files.

---

## 10. Work order

The first item gates every other item.

1. **Tab-capture probe.** One throwaway page. Waskar clicks the share dialog on his Mac. the workshop lead
   clicks it on a Chromebook, using the offer in her 9/17 email. If ChromeOS does not deliver tab
   audio, the file path becomes the default, and we know in September.
2. `attachStream` split, `startTabAudio`, `startFileAudio`, with tests.
3. `sandbox/engine.js` and `sandbox/index.html`.
4. `docs/workshop/edit-ladder.md` and `docs/workshop/station-links.md`.
5. Run the template as a first-time student, then hand it to the workshop lead before the run-through.

---

## 11. Changes to existing documents

`README.md` and `PRODUCT.md` both state: "It does not play audio files. There is no file to load and
no track to select." The decision in §2 retires that constraint. Both files need the line replaced
with the new rule: the live DJ application reads hardware input only, and the student sandbox adds
a tab and file source.

This is a product decision, not an implementation detail. It is recorded here so the code does not
quietly contradict the documents.

---

## 12. Files

| File | Change |
| --- | --- |
| `sandbox/index.html` | New. The student template. Also runs directly on Netlify. |
| `sandbox/engine.js` | New. Custom element, boot, attribute validation. |
| `sandbox/sandbox.css` | New. The sandbox's own chrome. Sets no band color. |
| `sandbox/probe.html` | New. Manual probe for tab audio capture. Kept as the reproduction case. |
| `app/audioProcessor.js` | `attachStream` split, `startTabAudio`, `startFileAudio`, `stop()` teardown |
| `docs/workshop/edit-ladder.md` | New. Start here / level up / boss. |
| `docs/workshop/station-links.md` | New. Source for the workshop lead's link tracker. |
| `test/verify-sandbox.mjs` | New. Typo-safety test. |
| `README.md`, `PRODUCT.md` | Retire the "does not play audio files" constraint |
