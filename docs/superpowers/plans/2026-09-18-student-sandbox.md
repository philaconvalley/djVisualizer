# Student Sandbox Implementation Plan

> **Redacted for a public repository.** This document is kept for its technical
> reasoning. The venue, the session dates and times, the partner organisation and
> the workshop lead's name were removed before publication, because this repository
> is public and the sessions involve minors. The unredacted copy lives outside the
> repository.


> **Historical document. Parts of this plan were overridden during execution.**
>
> The plan is kept as the record of what was intended. Where it disagrees with the
> code, the code is right and
> [the spec](../specs/2026-09-18-student-sandbox-design.md) is the authority.
> Superseded in five places:
>
> 1. **Tasks 5 and 6 were merged.** Task 5's test navigated to a file Task 6 created,
>    so Task 5 could never pass its own review.
> 2. **The typo-safety test here is broken.** It injects colours with `addStyleTag`
>    after `goto`, but `readPalette()` already ran during `init()`. It would pass on a
>    broken fallback. Replaced by committed fixture pages under `test/fixtures/`.
> 3. **The machine tags moved into `<head>`.** As written below they sit under the
>    student's markup, where one missing quote mark or unterminated comment swallows
>    them and the page dies silently. The CodePen variant must be head-first too.
> 4. **"It will never break, no matter what you type above" was false and is gone.**
>    The music and the picture survive every tested break. A student's name, mode or
>    colours can still vanish, and the page says so.
> 5. **`--stage` was removed.** The canvas paints opaque black over it, so the edit did
>    nothing. Students get three colour edits, not four.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a workshop student a link they open with no account, where editing one HTML or CSS value changes how the visualizer looks, and a typo never stops the audio.

**Architecture:** A second entry point, `sandbox/engine.js`, defines a `<dj-visualizer>` custom element. The element builds the host DOM that `DJVisualizer.init()` requires, then boots the existing `AudioProcessor` and `DJVisualizer` unmodified. `AudioProcessor.startAudio()` splits so the graph half, `attachStream()`, serves three acquirers: tab capture, a media file, and the microphone. `index.html` and `app/app.js` are never touched, so the live DJ application cannot regress.

**Tech Stack:** Plain ES5-era classic scripts, p5.js 1.9.0 vendored, Web Audio API, Playwright for verification, Node's `http` for the test server. No build step. No runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-18-student-sandbox-design.md`

## Global Constraints

- **Zero build.** No bundler, no transpile. Classic `<script>` tags only. `package.json` devDependencies serve the harness, formatter, and linter only.
- **No network at showtime.** p5 stays vendored at `vendor/p5.min.js`. Never a CDN.
- **`index.html` and `app/app.js` are not modified by this plan.** Any change to them is a plan failure.
- **`app/*.js` are classic scripts sharing one global scope.** A new global needs its name added to the matching `varsIgnorePattern` in `eslint.config.mjs`.
- **Existing behavior is the regression test.** `npm run verify` must pass at the end of every task that touches `app/audioProcessor.js`.
- **Debug logging is gated.** Use `if (DEBUG)` around argument building. Never sample. See PHI-153.
- **Band vocabulary is fixed:** bass 20–250 Hz, mid 250 Hz–4 kHz, high 4–20 kHz.
- **Prettier and ESLint gate CI.** Run `npm run format` and `npm run lint` before every commit.
- **Commit messages** use the repository's conventional format and end with the Co-Authored-By line the session is configured with. Do not push; Waskar owns git remotes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `sandbox/probe.html` | Standalone manual probe for tab audio capture. No engine. Throwaway in spirit, kept in the repo as the reproduction case. |
| `sandbox/engine.js` | Defines `<dj-visualizer>`. Builds host DOM, validates attributes, boots the processor and visualizer, owns the source buttons. |
| `sandbox/index.html` | The student template. Title, `:root` tokens, one element. Also runs directly on Netlify. |
| `app/audioProcessor.js` | Gains `attachStream`, `startTabAudio`, `startFileAudio`. `startAudio` keeps its signature and behavior. |
| `test/verify-sandbox.mjs` | Playwright driver. Seam tests, file-source test, typo-safety test. |
| `docs/workshop/edit-ladder.md` | Start here / level up / boss, in the workshop lead's format. |
| `docs/workshop/station-links.md` | Source of truth for the per-station pen URLs the workshop lead's tracker holds. |
| `README.md`, `PRODUCT.md` | The "does not play audio files" constraint is retired. |
| `eslint.config.mjs` | A block for `sandbox/**/*.js`. |
| `package.json` | A `verify:sandbox` script. |

---

## Facts the implementer needs before Task 1

These were read from the code on 2026-09-18. Do not re-derive them; do check they still hold.

- `AudioProcessor.startAudio(deviceId)` is at `app/audioProcessor.js:436`. It acquires a stream in lines 447–486, then builds the graph from line 487 to line 530. Everything from `this.stream = stream;` onward is source-agnostic. **That is the seam.**
- The error mapping in the `catch` at line 534 is microphone-specific (`NotAllowedError` → "Microphone access denied"). It must stay with `startAudio`, not move into `attachStream`.
- `AudioProcessor` exposes `onDataUpdate`, `onBeat`, and `getAudioData()`.
- `DJVisualizer.init()` at `app/visualizer.js:82` requires three DOM hooks **without a null guard**, and will throw if any is missing:
  - `document.querySelector('.stage')` — used by `measureStage()` at line 178 and `ensureCollage()` at line 231.
  - `document.getElementById('p5-canvas')` — p5 parents the canvas to this id.
  - `document.getElementById('visualMode')` — line 90 attaches a listener with no guard.
- The band fill elements (`.bass-fill`, `.mid-fill`, `.high-fill`) **are** guarded, at lines 418–430. They may be absent.
- `readPalette()` at line 154 reads `--bass`, `--mid`, `--high` from `:root` at init. `parseColor()` at line 162 returns `null` for unparseable input and the previous value stands. **This is the typo safety for colors, and it already exists.**
- `DJVisualizer` has ten modes: `spectrum`, `particles`, `rings`, `waves`, `mandala`, `tunnel`, `galaxy`, `polygons`, `custom`, `flow`.
- `netlify.toml:19` sets `img-src 'self' blob: data:`. A `gif` attribute pointing at another origin is blocked **on our own domain**. Inside a CodePen pen, CodePen's policy applies instead.

---

## Task 1: Tab-capture probe

This task is the gate. If tab audio does not reach an analyser on ChromeOS, Tasks 4 and the default source change, and the spec is revised before more code is written.

**This task has no automated test, and that is deliberate.** `getDisplayMedia` opens a native Chrome dialog. Playwright cannot operate it. The deliverable is a page a human clicks. Do not fake a passing test around it.

**Files:**
- Create: `sandbox/probe.html`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other code imports. A human verdict, recorded in the spec.

- [ ] **Step 1: Write the probe page**

Create `sandbox/probe.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tab audio probe</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #000;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      button {
        font-size: 18px;
        padding: 12px 20px;
        border-radius: 999px;
        border: 0;
        cursor: pointer;
      }
      #meter {
        height: 24px;
        background: #30d158;
        width: 0;
        transition: width 80ms linear;
      }
      dt {
        color: rgba(235, 235, 245, 0.58);
        font-size: 13px;
      }
      dd {
        margin: 0 0 12px;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </head>
  <body>
    <h1>Tab audio probe</h1>
    <p>
      Play a song in another Chrome tab. Press the button, choose that tab, and tick
      <strong>Share tab audio</strong>. The bar moves if the audio reached the analyser.
    </p>
    <button id="share" type="button">Share a tab</button>
    <div id="meter" aria-hidden="true"></div>
    <dl>
      <dt>Result</dt>
      <dd id="result">not started</dd>
      <dt>Audio tracks</dt>
      <dd id="tracks">&mdash;</dd>
      <dt>Track label</dt>
      <dd id="label">&mdash;</dd>
      <dt>Sample rate</dt>
      <dd id="rate">&mdash;</dd>
      <dt>Peak level</dt>
      <dd id="peak">&mdash;</dd>
    </dl>

    <script>
      const $ = (id) => document.getElementById(id);

      $('share').addEventListener('click', async () => {
        $('result').textContent = 'asking...';
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          $('result').textContent = 'FAIL — getDisplayMedia is not available in this browser';
          return;
        }

        let stream;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (error) {
          $('result').textContent = 'FAIL — ' + error.name + ': ' + error.message;
          return;
        }

        const audio = stream.getAudioTracks();
        $('tracks').textContent = String(audio.length);

        if (audio.length === 0) {
          $('result').textContent =
            'FAIL — the tab was shared but carried no audio track. "Share tab audio" was off, or this platform does not offer it.';
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        $('label').textContent = audio[0].label || '(no label)';

        const context = new (window.AudioContext || window.webkitAudioContext)();
        await context.resume();
        $('rate').textContent = context.sampleRate + ' Hz';

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);

        const samples = new Float32Array(analyser.fftSize);
        let best = 0;

        $('result').textContent = 'stream attached — watching for signal';

        setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i++) {
            const v = Math.abs(samples[i]);
            if (v > peak) peak = v;
          }
          best = Math.max(best, peak);
          $('meter').style.width = Math.min(100, peak * 100) + '%';
          $('peak').textContent = peak.toFixed(4) + '  (best ' + best.toFixed(4) + ')';
          if (best > 0.001) {
            $('result').textContent = 'PASS — tab audio reached the analyser';
          }
        }, 100);
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Check formatting and linting**

Run: `npm run format && npm run lint`
Expected: both clean. `sandbox/probe.html` has an inline script, which ESLint does not read, so no config change is needed yet.

- [ ] **Step 3: Serve it and run it by hand**

Run: `npm start`, then open `http://localhost:8000/sandbox/probe.html` in Chrome.

Play a song in a second tab. Press **Share a tab**, choose that tab, tick **Share tab audio**.

Expected: `Result` reads `PASS — tab audio reached the analyser`, `Audio tracks` reads `1`, and the green bar moves with the music.

**If it reads FAIL, stop the plan.** Record what it said in the spec's §8 and report to Waskar. Tasks 4 onward assume this passed.

- [ ] **Step 4: Commit**

```bash
git add sandbox/probe.html
git commit -m "test(sandbox): Add a manual probe for tab audio capture"
```

- [ ] **Step 5: Hand it to the workshop lead**

The probe must also run on a partner Chromebook before Task 4 is trusted. Waskar sends the deployed URL. This step is not blocking for Tasks 2 and 3, which do not depend on tab capture.

---

## Task 2: Split the audio graph out of `startAudio`

**Files:**
- Modify: `app/audioProcessor.js:436-556`
- Create: `test/verify-sandbox.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `async attachStream(stream)` on `AudioProcessor`. Takes a `MediaStream`. Returns `undefined`. Builds the audio context, the analyser at `fftSize` 2048, the kick worklet, the buffers, and starts the 60 Hz analysis timer. Sets `this.stream = stream` so `stop()` tears the tracks down. Throws whatever the Web Audio API throws; it does **not** map errors to microphone wording.

- [ ] **Step 1: Write the failing test**

Create `test/verify-sandbox.mjs`. This file grows across Tasks 2, 3, and 6.

```js
/* Verifies the student sandbox and the source-agnostic audio seam.
 *
 * verify-audio.mjs proves the band math against known audio through the
 * microphone path. This file proves the three things that path cannot:
 * that the graph half of startAudio works from any MediaStream, that a
 * media file drives it, and that a student's typo changes nothing but the
 * thing they typed.
 *
 * Tab capture is NOT covered here. getDisplayMedia opens a native Chrome
 * dialog that Playwright cannot operate. It is verified by hand with
 * sandbox/probe.html, once on a Mac and once on a partner Chromebook.
 *
 *   node test/verify-sandbox.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = 8124;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wav': 'audio/wav',
  '.gif': 'image/gif',
  '.png': 'image/png'
};

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function serve() {
  const server = createServer(async (req, res) => {
    const path = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(PORT, () => done(server)));
}

// The seam test builds a stream the app never sees in production: an
// oscillator routed into a MediaStreamDestination. That is the point. If
// attachStream works on a stream with no microphone anywhere behind it,
// the seam is genuinely source-agnostic.
async function seamTest(page) {
  const reading = await page.evaluate(async () => {
    const processor = new AudioProcessor();
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 100;
    oscillator.connect(destination);
    oscillator.start();

    await processor.attachStream(destination.stream);
    await new Promise((r) => setTimeout(r, 1200));
    const data = processor.getAudioData();
    processor.stop();
    context.close();
    return data;
  });

  check(
    'attachStream drives the bands from a non-microphone stream',
    reading.bass > 0.02 && reading.bass > reading.high,
    `bass ${reading.bass.toFixed(3)}, mid ${reading.mid.toFixed(3)}, high ${reading.high.toFixed(3)}`
  );
}

const server = await serve();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => check('page threw', false, error.message));
  await page.goto(`${BASE}/sandbox/probe.html`);
  await page.addScriptTag({ url: `${BASE}/app/audioProcessor.js` });

  await seamTest(page);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
  process.exit(1);
}
```

Add the script to `package.json`, after the `"verify"` line:

```json
    "verify:sandbox": "node test/verify-sandbox.mjs",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/verify-sandbox.mjs`
Expected: FAIL. The message names `processor.attachStream is not a function`.

- [ ] **Step 3: Make the split**

In `app/audioProcessor.js`, cut everything from `// Store stream for cleanup` / `this.stream = stream;` (line 486–487) through the end of the `try` block at line 532 — that is, up to and including the `if (DEBUG) { console.log('Audio started successfully...') }` block — and put it in a new method placed directly **above** `startAudio`:

```js
  // The graph half of starting audio, with no opinion about where the stream
  // came from. A microphone, a shared tab, and a media element all arrive here
  // as the same MediaStream, so the analyser, the band math, and the beat
  // detector have exactly one implementation. Splitting this out is what let
  // the student sandbox add two sources without touching any of that. PHI-223.
  //
  // Errors are NOT translated here. startAudio owns the microphone wording,
  // because "Microphone access denied" is a lie when the user declined a tab.
  async attachStream(stream) {
    this.stream = stream;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Configure analyser for stable performance
    this.analyserNode = this.audioContext.createAnalyser();
    // 2048 puts bin width near 23 Hz at 48 kHz, which gives the 20–250 Hz bass
    // band about ten bins to work with instead of five. At 1024 the band the
    // whole beat detector keys off was resolved more coarsely than it is wide.
    // The cost is a ~43 ms analysis window, still short enough to feel live.
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.3;
    this.analyserNode.minDecibels = -90;
    this.analyserNode.maxDecibels = -10;

    this.sourceNode.connect(this.analyserNode);
    await this.startKickWorklet();

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    this.timeDataArray = new Uint8Array(this.analyserNode.fftSize);
    this.floatTimeData = new Float32Array(this.analyserNode.fftSize);
    this.silentSince = null;
    this.reportedErrors.clear();

    this.rms = this.bass = this.mid = this.high = 0;

    // Analysis runs on its own clock, not on requestAnimationFrame. Chained
    // to rAF it inherited the renderer's frame rate, so a heavy visualization
    // or a warm laptop starved the beat detector of samples — the failure got
    // worse precisely as the machine got busier. Listening is not drawing and
    // must not be throttled by it.
    this.isRunning = true;
    this.lastAnalysisAt = 0;
    this.analysisTimer = setInterval(() => this.updateAudioData(), 1000 / 60);
    this.updateAudioData();

    if (DEBUG) {
      console.log('Audio started successfully with sample rate:', this.audioContext.sampleRate);
    }
  }
```

Then, inside `startAudio`, replace the removed block with a single call. The end of its `try` becomes:

```js
      await this.attachStream(stream);
```

Leave the `catch` block at line 534 exactly as it is. Leave `stop()` exactly as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/verify-sandbox.mjs`
Expected: PASS on `attachStream drives the bands from a non-microphone stream`.

Run: `npm run verify`
Expected: every check passes, the same count as before the change. This is the regression gate for the live DJ app.

- [ ] **Step 5: Format, lint, commit**

```bash
npm run format && npm run lint
git add app/audioProcessor.js test/verify-sandbox.mjs package.json
git commit -m "refactor(audio): Split the graph out of startAudio as attachStream"
```

---

## Task 3: Add the file source

**Files:**
- Modify: `app/audioProcessor.js` — add `startFileAudio`, extend `stop()`
- Modify: `test/verify-sandbox.mjs`

**Interfaces:**
- Consumes: `attachStream(stream)` from Task 2.
- Produces: `async startFileAudio(source)` on `AudioProcessor`. `source` is a `File` or a URL string. Returns the `HTMLAudioElement` it created, so a caller can pause or seek it. Stores it as `this.mediaElement` and the object URL as `this.mediaElementURL`. The element is connected to the analyser **and** to `context.destination`, so the student hears the track.

The microphone path must never connect to `destination`. Doing so feeds the room back into itself.

- [ ] **Step 1: Write the failing test**

Add to `test/verify-sandbox.mjs`, above the `const server = await serve();` line:

```js
// The file path has to light the same bands as the microphone path for the
// same audio. tone-100hz.wav is a pure 100 Hz tone, which sits squarely in
// the 20–250 Hz bass band and nowhere else.
async function fileSourceTest(page) {
  const reading = await page.evaluate(async (base) => {
    const processor = new AudioProcessor();
    await processor.startFileAudio(base + '/test/fixtures/tone-100hz.wav');
    await new Promise((r) => setTimeout(r, 1500));
    const data = processor.getAudioData();
    processor.stop();
    return data;
  }, BASE);

  check(
    'startFileAudio lights bass for a 100 Hz tone',
    reading.bass > 0.02 && reading.bass > reading.high,
    `bass ${reading.bass.toFixed(3)}, high ${reading.high.toFixed(3)}`
  );
}

// stop() has to release the element and revoke its object URL, or a student
// switching tracks ten times leaks ten decoded files.
async function fileTeardownTest(page) {
  const state = await page.evaluate(async (base) => {
    const processor = new AudioProcessor();
    await processor.startFileAudio(base + '/test/fixtures/tone-1khz.wav');
    await new Promise((r) => setTimeout(r, 400));
    processor.stop();
    return {
      element: processor.mediaElement,
      url: processor.mediaElementURL,
      running: processor.isRunning
    };
  }, BASE);

  check(
    'stop() releases the media element',
    state.element === null && state.url === null && state.running === false,
    JSON.stringify(state)
  );
}
```

And call them, after `await seamTest(page);`:

```js
  await fileSourceTest(page);
  await fileTeardownTest(page);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/verify-sandbox.mjs`
Expected: FAIL. The message names `processor.startFileAudio is not a function`.

Note: the fixtures must exist first. If `test/fixtures/tone-100hz.wav` is missing, run `npm run fixtures`.

- [ ] **Step 3: Implement the file source**

In `app/audioProcessor.js`, add to the `constructor` beside the other null initialisers near line 97:

```js
    // Media element source, used by the student sandbox's file path. Null on
    // the microphone and tab paths.
    this.mediaElement = null;
    this.mediaElementURL = null;
```

Add this method directly below `attachStream`:

```js
  // A song the student chose, from a file or a URL. Unlike the microphone and
  // the shared tab, this source is also routed to the speakers — the student
  // has to hear what they are watching. The microphone path must never do
  // this; it would feed the room back into itself.
  //
  // A media element is not a MediaStream, so this builds the graph directly
  // rather than going through attachStream. Everything downstream of the
  // analyser is identical. PHI-223.
  async startFileAudio(source) {
    this.stop();

    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    if (typeof source !== 'string') this.mediaElementURL = url;

    const element = new Audio();
    element.crossOrigin = 'anonymous';
    element.loop = true;
    element.src = url;
    this.mediaElement = element;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaElementSource(element);

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.3;
    this.analyserNode.minDecibels = -90;
    this.analyserNode.maxDecibels = -10;

    this.sourceNode.connect(this.analyserNode);
    this.sourceNode.connect(this.audioContext.destination);
    await this.startKickWorklet();

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    this.timeDataArray = new Uint8Array(this.analyserNode.fftSize);
    this.floatTimeData = new Float32Array(this.analyserNode.fftSize);
    this.silentSince = null;
    this.reportedErrors.clear();
    this.rms = this.bass = this.mid = this.high = 0;

    await element.play();

    this.isRunning = true;
    this.lastAnalysisAt = 0;
    this.analysisTimer = setInterval(() => this.updateAudioData(), 1000 / 60);
    this.updateAudioData();

    if (DEBUG) console.log('File audio started:', url);

    return element;
  }
```

In `stop()`, add this immediately after the `if (this.stream) { ... }` block:

```js
    // Media element source, if the file path was used.
    if (this.mediaElement) {
      this.mediaElement.pause();
      this.mediaElement.removeAttribute('src');
      this.mediaElement.load();
      this.mediaElement = null;
    }

    if (this.mediaElementURL) {
      URL.revokeObjectURL(this.mediaElementURL);
      this.mediaElementURL = null;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/verify-sandbox.mjs`
Expected: all three checks PASS.

Run: `npm run verify`
Expected: unchanged. `stop()` gained two guarded blocks that are inert on the microphone path.

- [ ] **Step 5: Format, lint, commit**

```bash
npm run format && npm run lint
git add app/audioProcessor.js test/verify-sandbox.mjs
git commit -m "feat(audio): Add a file source that plays a track and drives the bands"
```

---

## Task 4: Add the tab-capture source

Task 1 must have passed by hand before starting this.

**Files:**
- Modify: `app/audioProcessor.js` — add `startTabAudio`
- Modify: `test/verify-sandbox.mjs`

**Interfaces:**
- Consumes: `attachStream(stream)` from Task 2.
- Produces: `async startTabAudio()` on `AudioProcessor`. Takes nothing. Returns `undefined`. Throws an `Error` whose message is written for a 12-year-old when the browser cannot capture, when the student cancels, or when the shared tab carried no audio track. Discards the video track before attaching, so nothing holds a video encoder open for two hours.

- [ ] **Step 1: Write the failing test**

The native dialog cannot be driven, so the test replaces `getDisplayMedia` with a stub that returns a real stream. That checks every line this repository owns: the call shape, the video-track discard, the no-audio-track error, and the handoff to `attachStream`.

Add to `test/verify-sandbox.mjs`, above `const server = await serve();`:

```js
// getDisplayMedia opens a native dialog Playwright cannot touch, so the
// browser's half is stubbed and this repository's half is tested in full.
// The real dialog is exercised by hand with sandbox/probe.html. Anything
// this stub hides is named in the spec, §9.
async function tabCaptureTest(page) {
  const outcome = await page.evaluate(async () => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 100;
    oscillator.connect(destination);
    oscillator.start();

    let asked = null;
    navigator.mediaDevices.getDisplayMedia = (options) => {
      asked = options;
      return Promise.resolve(destination.stream);
    };

    const processor = new AudioProcessor();
    await processor.startTabAudio();
    await new Promise((r) => setTimeout(r, 1200));
    const data = processor.getAudioData();
    processor.stop();
    context.close();
    return { asked, bass: data.bass, high: data.high };
  });

  check(
    'startTabAudio asks for video and audio',
    outcome.asked && outcome.asked.audio === true && outcome.asked.video === true,
    JSON.stringify(outcome.asked)
  );

  check(
    'startTabAudio drives the bands from the shared stream',
    outcome.bass > 0.02 && outcome.bass > outcome.high,
    `bass ${outcome.bass.toFixed(3)}, high ${outcome.high.toFixed(3)}`
  );
}

// The commonest real failure is not a refusal. It is a student who shares the
// right tab and forgets to tick "Share tab audio". The message has to say so.
async function tabCaptureNoAudioTest(page) {
  const message = await page.evaluate(async () => {
    const context = new AudioContext();
    const canvas = document.createElement('canvas');
    const videoOnly = canvas.captureStream(1);

    navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(videoOnly);

    const processor = new AudioProcessor();
    try {
      await processor.startTabAudio();
      context.close();
      return null;
    } catch (error) {
      context.close();
      return error.message;
    }
  });

  check(
    'a tab shared without audio gives an instructive message',
    typeof message === 'string' && /share tab audio/i.test(message),
    message === null ? 'no error was thrown' : message
  );
}
```

Call them after `await fileTeardownTest(page);`:

```js
  await tabCaptureTest(page);
  await tabCaptureNoAudioTest(page);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/verify-sandbox.mjs`
Expected: FAIL. The message names `processor.startTabAudio is not a function`.

- [ ] **Step 3: Implement tab capture**

In `app/audioProcessor.js`, add directly below `attachStream`:

```js
  // The student's own song, captured from a tab playing it. This is the only
  // way a browser can analyse audio from a site it does not own: the embed
  // itself is cross-origin and unreachable, so the sound is taken after it
  // leaves the player rather than from inside it. PHI-223.
  //
  // Streaming services are out of reach even this way. Their audio is DRM
  // protected and Chrome refuses to capture it, so the shared tab arrives
  // silent. YouTube carries no DRM on standard videos and does arrive.
  async startTabAudio() {
    this.stop();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('This browser cannot share a tab. Use Chrome, or pick a song file instead.');
    }

    let stream;
    try {
      // Audio-only capture is not offered by any browser: the picker is a
      // screen picker, so video must be requested to get the audio beside it.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('No tab was shared. Press the button again and choose your music tab.', {
          cause: error
        });
      }
      throw new Error('Could not share a tab: ' + error.message, { cause: error });
    }

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(
        'That tab was shared without its sound. Try again and tick "Share tab audio" in the dialog.'
      );
    }

    // Nothing here draws the tab, and an unread video track keeps an encoder
    // running for the length of the set.
    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    await this.attachStream(stream);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/verify-sandbox.mjs`
Expected: all seven checks PASS.

Run: `npm run verify`
Expected: unchanged.

- [ ] **Step 5: Format, lint, commit**

```bash
npm run format && npm run lint
git add app/audioProcessor.js test/verify-sandbox.mjs
git commit -m "feat(audio): Add tab capture so a student can visualize a YouTube link"
```

---

## Task 5: The `<dj-visualizer>` element

**Files:**
- Create: `sandbox/engine.js`
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: `AudioProcessor` with `attachStream`, `startFileAudio`, `startTabAudio` (Tasks 2–4); `DJVisualizer` from `app/visualizer.js`, unmodified.
- Produces: the custom element `<dj-visualizer>`, with attributes `dj-name`, `mode`, and `gif`. Also `window.djSandbox`, set to the element instance once connected, so the tests and a curious student can reach it from the console.

The element builds the DOM `DJVisualizer.init()` requires: a `.stage` container, `#p5-canvas` inside it, and a `<select id="visualMode">` holding all ten modes. Without those three, `init()` throws — the band fills are optional and are omitted.

- [ ] **Step 1: Write the failing test**

Add to `test/verify-sandbox.mjs`, above `const server = await serve();`:

```js
// The element has to build every DOM hook DJVisualizer.init() reaches for
// without a guard. Missing any one of them throws during boot, and a student
// sees a black page with no explanation.
async function elementBootTest(page) {
  const state = await page.evaluate(() => {
    const el = document.querySelector('dj-visualizer');
    return {
      stage: !!document.querySelector('.stage'),
      canvasHost: !!document.getElementById('p5-canvas'),
      modeSelect: !!document.getElementById('visualMode'),
      canvasDrawn: !!document.querySelector('.stage canvas'),
      mode: el && el.visualizer ? el.visualizer.currentMode : null,
      name: document.querySelector('.sandbox-name')
        ? document.querySelector('.sandbox-name').textContent
        : null
    };
  });

  check('the element builds .stage', state.stage);
  check('the element builds #p5-canvas', state.canvasHost);
  check('the element builds #visualMode', state.modeSelect);
  check('p5 created a canvas', state.canvasDrawn);
  check('the mode attribute is applied', state.mode === 'rings', String(state.mode));
  check('the dj-name attribute is shown', state.name === 'TEST DJ', String(state.name));
}
```

Change the page setup block near the bottom to load the sandbox instead of the probe:

```js
  const page = await browser.newPage();
  page.on('pageerror', (error) => check('page threw', false, error.message));
  await page.goto(`${BASE}/sandbox/probe.html`);
  await page.addScriptTag({ url: `${BASE}/app/audioProcessor.js` });

  await seamTest(page);
  await fileSourceTest(page);
  await fileTeardownTest(page);
  await tabCaptureTest(page);
  await tabCaptureNoAudioTest(page);

  // The element tests need a real sandbox page, not the bare probe.
  const sandbox = await browser.newPage();
  sandbox.on('pageerror', (error) => check('sandbox page threw', false, error.message));
  await sandbox.goto(`${BASE}/sandbox/index.html?mode=rings&name=TEST%20DJ`);
  await sandbox.waitForTimeout(600);
  await elementBootTest(sandbox);
```

The query parameters are a test affordance the element reads in Step 3, so the test can boot a known configuration without a second HTML file. They are not part of the student contract, and `docs/workshop/edit-ladder.md` never mentions them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/verify-sandbox.mjs`
Expected: FAIL on the element checks, because `sandbox/index.html` does not exist. Task 6 creates it, so run this again at the end of Task 6 rather than expecting a pass here.

- [ ] **Step 3: Write the element**

Create `sandbox/engine.js`:

```js
/* The student sandbox's entry point.
 *
 * app/app.js cannot serve this page. It is welded to index.html's console —
 * the transport button, the device select, three band sliders, the readouts,
 * the help dialog — and reproducing that markup in a student's file is the
 * opposite of what this is for. So the sandbox gets its own boot, and the
 * analyser and the stage are used unmodified.
 *
 * The student's file is a configuration, not a program. Every value below is
 * read from HTML or CSS, validated, and replaced with a default when it does
 * not parse. Nothing a student can type in this file throws. PHI-223.
 */

const MODES = [
  'spectrum',
  'particles',
  'rings',
  'waves',
  'mandala',
  'tunnel',
  'galaxy',
  'polygons',
  'custom',
  'flow'
];

const DEFAULT_MODE = 'flow';
const RAIL_HEIGHT = 64;

class DJVisualizerSandbox extends HTMLElement {
  connectedCallback() {
    if (this.booted) return;
    this.booted = true;

    // A test affordance, not part of the student contract. See the plan.
    const params = new URLSearchParams(location.search);

    this.buildDom(
      params.get('name') || this.getAttribute('dj-name') || '',
      params.get('mode') || this.getAttribute('mode') || ''
    );

    this.processor = new AudioProcessor();
    this.visualizer = new DJVisualizer();
    this.visualizer.init();
    this.visualizer.setRailHeight(RAIL_HEIGHT);
    this.visualizer.currentMode = this.modeSelect.value;

    this.processor.onDataUpdate = (data) => this.visualizer.updateAudioData(data);
    this.processor.onBeat = () => this.visualizer.onBeatEvent();

    this.applyGif(this.getAttribute('gif'));

    window.djSandbox = this;
  }

  // Every hook DJVisualizer.init() reaches for without a null guard is built
  // here. Omitting one throws during boot and the student sees a black page.
  buildDom(name, mode) {
    const stage = document.createElement('div');
    stage.className = 'stage';

    const host = document.createElement('div');
    host.id = 'p5-canvas';
    stage.appendChild(host);
    this.appendChild(stage);

    const rail = document.createElement('div');
    rail.className = 'sandbox-rail';

    const label = document.createElement('span');
    label.className = 'sandbox-name';
    label.textContent = name;
    rail.appendChild(label);

    this.tabButton = document.createElement('button');
    this.tabButton.type = 'button';
    this.tabButton.textContent = 'Play a YouTube tab';
    this.tabButton.addEventListener('click', () => this.useTab());
    rail.appendChild(this.tabButton);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,video/*';
    this.fileInput.className = 'sandbox-file';
    this.fileInput.addEventListener('change', () => this.useFile());
    rail.appendChild(this.fileInput);

    // DJVisualizer.init() attaches a change listener to this without a guard.
    // Students never see it; the mode is an attribute on the element.
    this.modeSelect = document.createElement('select');
    this.modeSelect.id = 'visualMode';
    this.modeSelect.hidden = true;
    for (const value of MODES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.modeSelect.appendChild(option);
    }
    this.modeSelect.value = MODES.indexOf(mode) === -1 ? DEFAULT_MODE : mode;
    rail.appendChild(this.modeSelect);

    this.status = document.createElement('span');
    this.status.className = 'sandbox-status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = 'Pick your music to start';
    rail.appendChild(this.status);

    this.appendChild(rail);
  }

  // A GIF is optional and its path is the one student value that can point at
  // a file which is simply not there. It must fail as a message, never as a
  // stopped visualization. See PHI-222.
  applyGif(path) {
    const value = (path || '').trim();
    if (!value) return;

    this.modeSelect.value = 'custom';
    this.visualizer.currentMode = 'custom';
    this.visualizer.onModeChange('flow');

    this.visualizer.p5Instance.loadImage(
      value,
      (image) => {
        this.visualizer.customMedia = image;
        this.visualizer.customMediaType = 'image';
      },
      () => {
        this.status.textContent = 'Could not find the GIF at "' + value + '". Check the name.';
        this.modeSelect.value = DEFAULT_MODE;
        this.visualizer.currentMode = DEFAULT_MODE;
        this.visualizer.onModeChange('custom');
      }
    );
  }

  async useTab() {
    this.status.textContent = 'Choose your music tab, and tick "Share tab audio".';
    try {
      await this.processor.startTabAudio();
      this.visualizer.start();
      this.status.textContent = 'Playing your tab';
    } catch (error) {
      this.status.textContent = error.message;
    }
  }

  async useFile() {
    const file = this.fileInput.files[0];
    if (!file) return;
    this.status.textContent = 'Loading ' + file.name;
    try {
      await this.processor.startFileAudio(file);
      this.visualizer.start();
      this.status.textContent = 'Playing ' + file.name;
    } catch (error) {
      this.status.textContent = 'Could not play that file: ' + error.message;
    }
  }
}

customElements.define('dj-visualizer', DJVisualizerSandbox);
```

Add a block to `eslint.config.mjs`, directly after the `app/app.js` block:

```js
  // The sandbox entry point. Classic script, loaded after the app's files, so
  // it reads their globals from the shared scope the same way app.js does.
  {
    files: ['sandbox/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, AudioProcessor: 'readonly', DJVisualizer: 'readonly' }
    }
  },
```

- [ ] **Step 4: Format and lint**

Run: `npm run format && npm run lint`
Expected: clean. If ESLint reports `DJVisualizerSandbox` as unused, add `varsIgnorePattern: '^DJVisualizerSandbox$'` to the new block's rules, matching the pattern used for `app/visualizer.js`.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run lint
git add sandbox/engine.js eslint.config.mjs
git commit -m "feat(sandbox): Add the dj-visualizer element that boots from HTML attributes"
```

---

## Task 6: The student template and the typo-safety proof

**Files:**
- Create: `sandbox/index.html`
- Modify: `test/verify-sandbox.mjs`

**Interfaces:**
- Consumes: `<dj-visualizer>` from Task 5.
- Produces: the file a student copies into a CodePen pen, and the file served at `https://dj-visualizer.netlify.app/sandbox/`.

- [ ] **Step 1: Write the failing test**

Add to `test/verify-sandbox.mjs`, above `const server = await serve();`:

```js
// The ticket's second condition, made executable: a typo in the block a
// student edits must not stop the audio or the visuals. This loads the page
// with an unparseable colour and a nonsense mode, then asserts that the
// canvas still paints and the analyser still reads.
async function typoSafetyTest(browser, base) {
  const page = await browser.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));

  await page.goto(`${base}/sandbox/index.html?mode=purple-elephant&name=Oops`);
  await page.addStyleTag({ content: ':root { --bass: notacolour; --mid: #zzzzzz; }' });
  await page.waitForTimeout(600);

  const state = await page.evaluate(async (b) => {
    const el = window.djSandbox;
    await el.processor.startFileAudio(b + '/test/fixtures/tone-100hz.wav');
    await new Promise((r) => setTimeout(r, 1200));
    const data = el.processor.getAudioData();
    const canvas = document.querySelector('.stage canvas');
    el.processor.stop();
    return {
      bass: data.bass,
      mode: el.visualizer.currentMode,
      colours: el.visualizer.colors,
      painted: !!canvas && canvas.width > 0
    };
  }, base);

  check('a bad colour and a bad mode throw nothing', thrown.length === 0, thrown.join(' | '));
  check('the visuals still paint', state.painted);
  check('the audio still reads', state.bass > 0.02, `bass ${state.bass.toFixed(3)}`);
  check(
    'a nonsense mode falls back rather than blanking',
    state.mode === 'flow',
    String(state.mode)
  );
  check(
    'an unparseable colour keeps a usable value',
    Array.isArray(state.colours.bass) && state.colours.bass.length === 3,
    JSON.stringify(state.colours.bass)
  );

  await page.close();
}
```

Call it after `await elementBootTest(sandbox);`:

```js
  await typoSafetyTest(browser, BASE);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/verify-sandbox.mjs`
Expected: FAIL, because `sandbox/index.html` does not exist.

- [ ] **Step 3: Write the template**

Create `sandbox/index.html`. The fences and the comment tone are the product here: this is the file a 6th grader reads.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <!-- ================= YOU CAN CHANGE EVERYTHING BELOW ================= -->

    <!-- 1. The name of your page. Look at the browser tab after you reload. -->
    <title>My Playlist, Brought to Life</title>

    <style>
      :root {
        /* 2. Your colours. Each one belongs to a part of the music. */
        --bass: #ff453a; /* the low drums you feel in your chest */
        --mid: #30d158; /* the voice and most instruments */
        --high: #0a84ff; /* the cymbals and the bright edges */
        --stage: #000000; /* the background behind everything */
      }
    </style>
  </head>

  <body>
    <!-- 3. Your name, your look, and your GIF.
         mode can be: spectrum, particles, rings, waves, mandala,
                      tunnel, galaxy, polygons, custom, flow -->
    <dj-visualizer dj-name="DJ NOVA" mode="flow" gif=""></dj-visualizer>

    <!-- ================= YOU CAN CHANGE EVERYTHING ABOVE ================= -->
    <!-- Below this line is the machine. Leave it alone and it will never
         break, no matter what you type above. -->

    <link rel="stylesheet" href="sandbox.css" />
    <script src="../vendor/p5.min.js"></script>
    <script src="../app/audioProcessor.js"></script>
    <script src="../app/visualizer.js"></script>
    <script src="engine.js"></script>
  </body>
</html>
```

Create `sandbox/sandbox.css`:

```css
/* The sandbox's own chrome. The stage itself is styled by the tokens the
   student edits, so nothing here sets a band colour. */

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}

body {
  background: var(--stage, #000);
  color: #fff;
  font-family: system-ui, -apple-system, sans-serif;
}

dj-visualizer {
  display: block;
  height: 100%;
}

.stage {
  position: absolute;
  inset: 0;
}

.sandbox-rail {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 64px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: rgba(28, 28, 30, 0.86);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.sandbox-name {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.sandbox-rail button {
  border: 0;
  border-radius: 999px;
  padding: 10px 18px;
  font-size: 15px;
  cursor: pointer;
}

.sandbox-status {
  color: rgba(235, 235, 245, 0.8);
  font-size: 13px;
}
```

**Note on the paths.** The relative `../app/` paths work when the page is served from this repository. The version a student opens in CodePen uses absolute URLs against `https://dj-visualizer.netlify.app/`. Task 7 records both, and the CodePen variant is not a second file in this repository.

Now handle the nonsense mode. `engine.js` already falls back via `MODES.indexOf(mode) === -1`, so this test should pass with no change. If it does not, the bug is in `buildDom`, not in the template.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/verify-sandbox.mjs`
Expected: every check PASS, including the six element checks from Task 5 and the five typo-safety checks.

Run: `npm run verify`
Expected: unchanged.

- [ ] **Step 5: Run it as a first-time student**

Run: `npm start`, then open `http://localhost:8000/sandbox/`.

Do exactly what the ladder will ask a student to do, in order, and time yourself:

1. Change `--bass` to `#ffcc00`. Reload. The low drums are yellow.
2. Change the `dj-name` attribute. Reload. The rail shows it.
3. Change `mode` to `mandala`. Reload. The shape changes.
4. Press **Play a YouTube tab** and share a tab playing music.
5. Type a deliberate typo into `--mid`. Reload. Everything still runs.

**If step 1 takes longer than a minute, the ticket's first Done-when condition is not met.** Report what was slow rather than adjusting the test.

- [ ] **Step 6: Format, lint, commit**

```bash
npm run format && npm run lint
git add sandbox/index.html sandbox/sandbox.css test/verify-sandbox.mjs
git commit -m "feat(sandbox): Add the student template and prove a typo cannot stop it"
```

---

## Task 7: Documentation and the retired constraint

**Files:**
- Create: `docs/workshop/edit-ladder.md`
- Create: `docs/workshop/station-links.md`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the finished template from Task 6.
- Produces: the paper checklist content for the workshop, and an honest `README.md`.

- [ ] **Step 1: Write the edit ladder**

Create `docs/workshop/edit-ladder.md`:

```markdown
# Your Playlist, Brought to Life — the edit ladder

For the workshop. The first session is middle school. The second is high school.

Each rung is one small edit. Change the value, reload the page, look at the screen.
Nothing you type in the top part of the file can break the music or the visuals.

## Start here

1. **Pick your music.** Press **Play a YouTube tab**. Choose the tab playing your song,
   and tick **Share tab audio**. If that does not work, plug in the station USB stick and
   choose a song file instead.
2. **Change one colour.** Find `--bass` near the top. Change `#ff453a` to `#ffcc00`.
   Reload. The low drums are now yellow.

Stop here and look at the screen while a song plays. Watch which colour moves when.

## Level up

3. **Name your page.** Change the text inside `<title>`. Reload, and look at the browser tab.
4. **Name yourself.** Change `dj-name="DJ NOVA"` to your DJ name.
5. **Change the whole look.** Change `mode="flow"` to one of these, one at a time:
   `spectrum`, `particles`, `rings`, `waves`, `mandala`, `tunnel`, `galaxy`, `polygons`.
6. **Change the background.** Change `--stage` from `#000000` to a very dark colour of your own.

## Boss

7. **Set all three colours** so they look like they belong together, rather than three
   colours that happen to be in the same place.
8. **Add your GIF.** Upload your GIF in CodePen, copy its address, and paste it into
   `gif=""`. If the name is wrong the page tells you, and the music keeps playing.
9. **Explain your choice.** Tell the person next to you which colour you gave the bass,
   and why that fits your song.

## If something looks wrong

The page never breaks from a typo. If nothing is moving, it is almost always the music,
not your code. Check these in order:

1. Is the song actually playing in the other tab?
2. Did you tick **Share tab audio** in the dialog?
3. Does the bar at the bottom say it is playing?
```

- [ ] **Step 2: Write the station links file**

Create `docs/workshop/station-links.md`:

```markdown
# Station links

One CodePen pen per station. Students open the link, edit, and reload. No account, and
nothing to save. These URLs are what the workshop lead's session tracker holds.

Created by Waskar from the template at `sandbox/index.html`, with the local `../app/`
paths replaced by absolute ones:

```html
<link rel="stylesheet" href="https://dj-visualizer.netlify.app/sandbox/sandbox.css" />
<script src="https://dj-visualizer.netlify.app/vendor/p5.min.js"></script>
<script src="https://dj-visualizer.netlify.app/app/audioProcessor.js"></script>
<script src="https://dj-visualizer.netlify.app/app/visualizer.js"></script>
<script src="https://dj-visualizer.netlify.app/sandbox/engine.js"></script>
```

| Station | Pen URL | Checked on a Chromebook |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |

Fill the table when the pens exist. An empty row is a station without a link, which on
the day is a student without a screen.
```

- [ ] **Step 3: Retire the constraint in `README.md`**

Replace this paragraph, which currently sits under the opening description:

```markdown
It does not play audio files. There is no file to load and no track to select:
you plug in, press Start, and it reads the room.
```

with:

```markdown
The live application does not play audio files. There is no file to load and no track to
select: you plug in, press Start, and it reads the room.

The student sandbox at `sandbox/` is the exception, and it exists for a different user. A
student has no mixer, so it takes audio from a shared browser tab or from a song file. It
uses the same analyser, the same bands, and the same beat detection. See
[the design spec](docs/superpowers/specs/2026-09-18-student-sandbox-design.md).
```

Add `sandbox/` to the project structure block, directly after the `styles/styles.css` line:

```
sandbox/
  index.html            Student template — HTML and CSS only
  engine.js             <dj-visualizer> element, config-driven boot
  sandbox.css           Sandbox chrome
  probe.html            Manual probe for tab audio capture
docs/workshop/          Edit ladder and station links
```

Add a verification line after the `npm run smoke` block:

```markdown
```sh
npm run verify:sandbox
```

Checks the student sandbox: that the audio graph works from any source, that a song file
drives the bands, and that a typo in the block a student edits stops neither the audio nor
the visuals. Tab capture is verified by hand with `sandbox/probe.html`, because
`getDisplayMedia` opens a native dialog no test driver can operate.
```

- [ ] **Step 4: Retire the constraint in `PRODUCT.md`**

Find the line stating that the app does not play audio files and replace it with the two
users made explicit:

```markdown
**The live application reads hardware input only.** No file, no track, no transport. The
operator plugs in and presses Start.

**The student sandbox is the exception**, and it is a different product for a different
user. A student in a workshop has no mixer and no controller, so the sandbox accepts a
shared browser tab or a song file. Everything below the source — the bands, the beat
detection, the ten modes — is shared. The exception is the source, and only the source.
```

- [ ] **Step 5: Verify the whole suite**

```bash
npm run format && npm run lint
npm run verify
npm run verify:sandbox
```

Expected: all three clean. Report the check counts rather than summarising them as fine.

- [ ] **Step 6: Commit**

```bash
git add docs/workshop/edit-ladder.md docs/workshop/station-links.md README.md PRODUCT.md package.json
git commit -m "docs(sandbox): Add the edit ladder and retire the no-audio-files constraint"
```

---

## What this plan does not do

Named here so nobody mistakes an omission for an oversight.

- **The shared submit-a-link playlist.** Its own ticket, by Waskar's decision on 2026-09-18.
- **PHI-222, the custom GIF failure.** The `gif` attribute calls `p5.loadImage`, which is
  the same path PHI-222 reports as broken for animated GIFs. This plan makes the failure
  *visible and survivable* — a message in the rail, with the music still playing — but it
  does not fix the underlying load. The boss rung depends on PHI-222 landing.
- **Creating the CodePen pens.** Waskar holds the account. Task 7 gives him the exact
  script block to paste; the pens themselves are not a code change.
- **The CodePen file cap.** The spec's one open question. This design needs one HTML file
  per pen, so three is enough, but confirm before anyone adds a second student file.
