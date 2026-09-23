/* Verifies the student sandbox and the source-agnostic audio seam.
 *
 * verify-audio.mjs proves the band math against known audio through the
 * microphone path. This file proves the three things that path cannot:
 * that the graph half of startAudio works from any MediaStream, that a
 * media file drives it, and that a student's typo changes nothing but the
 * thing they typed.
 *
 * Tab capture IS covered here, with getDisplayMedia stubbed: the options the
 * app asks for, the discard of the video track, and the error a tab shared
 * without sound produces. Only the native Chrome dialog is beyond Playwright,
 * so only the act of choosing a tab in it is verified by hand, with
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

    // A real getDisplayMedia stream carries a video track beside the audio
    // one — that is the track startTabAudio must discard. Without it here,
    // there is nothing for that discard to remove, and the check below
    // would pass for the wrong reason.
    const canvas = document.createElement('canvas');
    const videoTrack = canvas.captureStream(1).getVideoTracks()[0];
    const stream = new MediaStream([...destination.stream.getAudioTracks(), videoTrack]);

    let asked = null;
    navigator.mediaDevices.getDisplayMedia = (options) => {
      asked = options;
      return Promise.resolve(stream);
    };

    const processor = new AudioProcessor();
    await processor.startTabAudio();
    await new Promise((r) => setTimeout(r, 1200));
    const data = processor.getAudioData();
    const videoTracksLeft = stream.getVideoTracks().length;
    processor.stop();
    context.close();
    return { asked, bass: data.bass, high: data.high, videoTracksLeft };
  });

  check(
    'startTabAudio asks for video and audio',
    outcome.asked && outcome.asked.audio === true && outcome.asked.video === true,
    JSON.stringify(outcome.asked)
  );

  check(
    'startTabAudio discards the video track',
    outcome.videoTracksLeft === 0,
    `video tracks remaining: ${outcome.videoTracksLeft}`
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

// Every sandbox test gets its own page. tabCaptureTest and
// tabCaptureNoAudioTest replace navigator.mediaDevices.getDisplayMedia on
// their page and never put it back, so sharing a page with them would test a
// browser this project does not ship.
//
// The fixtures live in test/fixtures/, not in sandbox/. netlify.toml publishes
// the repository root, so anything under sandbox/ is a public page, and a
// student who lands on a deliberately broken one has no way to know it is a
// test.
async function sandboxPage(browser, base, fixture) {
  const page = await browser.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  const response = await page.goto(`${base}/test/fixtures/${fixture}`);

  // A 404 body is a page like any other: it throws nothing, boots nothing, and
  // quietly passes every check phrased as "this did not happen". A renamed or
  // missing fixture has to fail by name, here, before anything else runs.
  check(
    `${fixture} is served`,
    !!response && response.ok(),
    response ? `HTTP ${response.status()}` : 'no response'
  );

  await page.waitForTimeout(700);
  return { page, thrown };
}

// Reads the state of a booted sandbox. Every field is null-safe: when the boot
// failed there is no window.djSandbox, and a test that throws here kills the
// whole run and takes the other checks' results with it.
const readSandbox = () => {
  const el = window.djSandbox;
  const canvas = document.querySelector('#p5-canvas canvas');
  return {
    booted: !!el,
    stage: !!document.querySelector('.stage'),
    canvasHost: !!document.getElementById('p5-canvas'),
    modeSelect: !!document.getElementById('visualMode'),
    // .stage canvas also matches #collage-canvas, which is hidden and has no
    // CSS size. p5's canvas is the one the student sees.
    painted: !!canvas && canvas.width > 0,
    mode: el && el.visualizer ? el.visualizer.currentMode : null,
    colours: el && el.visualizer ? el.visualizer.colors : null,
    status: document.querySelector('.sandbox-status')
      ? document.querySelector('.sandbox-status').textContent
      : null,
    name: document.querySelector('.sandbox-name')
      ? document.querySelector('.sandbox-name').textContent
      : null,
    mediaType: el && el.visualizer ? el.visualizer.customMediaType : null,
    hasMedia: !!(el && el.visualizer && el.visualizer.customMedia),
    title: document.title
  };
};

// Plays a real file through the booted element's own processor and reports the
// bass reading. Null-safe for the same reason readSandbox is.
const playFixtureTone = async (b) => {
  const el = window.djSandbox;
  if (!el) return null;
  await el.processor.startFileAudio(b + '/test/fixtures/tone-100hz.wav');
  await new Promise((r) => setTimeout(r, 1200));
  const data = el.processor.getAudioData();
  el.processor.stop();
  return data.bass;
};

// The element has to build every DOM hook DJVisualizer.init() reaches for
// without a guard. Missing any one of them throws during boot, and a student
// sees a black page with no explanation.
//
// The mode and the name come from real attributes on the element, which is the
// only way a student sets them. An earlier version of this test passed them as
// query parameters, so it asserted that a URL had been read and never touched
// the attribute path at all.
async function elementBootTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-attributes.html');
  const state = await page.evaluate(readSandbox);

  check('the attribute fixture boots without throwing', thrown.length === 0, thrown.join(' | '));
  check('the element builds .stage', state.stage);
  check('the element builds #p5-canvas', state.canvasHost);
  check('the element builds #visualMode', state.modeSelect);
  check('p5 created a canvas', state.painted);
  check('the mode attribute is applied', state.mode === 'rings', String(state.mode));
  check('the dj-name attribute is shown', state.name === 'TEST DJ', String(state.name));

  await page.close();
}

// The page a student actually opens has to boot, so the shipped template is
// checked as it ships: no fixture, no parameters, its own committed values.
async function shippedTemplateTest(browser, base) {
  const page = await browser.newPage();
  const thrown = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  await page.goto(`${base}/sandbox/`);
  await page.waitForTimeout(700);
  const state = await page.evaluate(readSandbox);

  check('the shipped template boots without throwing', thrown.length === 0, thrown.join(' | '));
  check('the shipped template paints', state.painted);
  check('the shipped template shows its dj-name', state.name === 'DJ NOVA', String(state.name));
  check('the shipped template uses its mode', state.mode === 'flow', String(state.mode));
  const shippedBoosts = await page.evaluate(() =>
    window.djSandbox ? { ...window.djSandbox.boosts } : null
  );
  check(
    'the shipped template starts every boost at 1',
    !!shippedBoosts &&
      shippedBoosts.bass === 1 &&
      shippedBoosts.mid === 1 &&
      shippedBoosts.high === 1,
    JSON.stringify(shippedBoosts)
  );
  check(
    "the shipped template's --bass reaches the canvas",
    state.colours && String(state.colours.bass) === '255,69,58',
    JSON.stringify(state.colours)
  );

  // The instance this closes: a sentence in the student's closing fence
  // contained a literal comment-closing arrow, so the comment ended early and
  // the rest of it rendered as page text. It was invisible only because the
  // canvas is absolutely positioned on top of it.
  //
  // The class this closes: every legitimate word on this page lives in the
  // rail, and the stage holds a canvas and no text. So any text outside the
  // rail is something that escaped a comment.
  const stray = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const escaped = [];
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent.trim();
      const inRail = node.parentElement && node.parentElement.closest('.sandbox-rail');
      if (text && !inRail) escaped.push(text.slice(0, 80));
      node = walker.nextNode();
    }
    return escaped;
  });

  check(
    'the shipped template leaks no comment text into the page',
    stray.length === 0,
    stray.join(' | ')
  );

  await page.close();
}

// engine.js repeats the template's three colours so that a student whose whole
// colour block is swallowed gets the shipped palette rather than three white
// bands. Two copies of the same values drift: edit the template's --bass and
// that student silently receives the old one, with nothing failing.
//
// The template on disk is the source of truth here. Writing the expected values
// into this test a third time would be the same bug wearing a different hat, so
// the values are read out of the file and compared against what the engine
// actually restores on a page whose colour block is gone.
async function paletteDriftTest(browser, base) {
  const template = await readFile(join(ROOT, 'sandbox/index.html'), 'utf8');
  const fromTemplate = {};
  for (const name of ['bass', 'mid', 'high']) {
    const found = template.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'));
    if (found) {
      const n = parseInt(found[1], 16);
      fromTemplate[name] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
    }
  }

  check(
    'the shipped template still declares three hex colours',
    Object.keys(fromTemplate).length === 3,
    JSON.stringify(fromTemplate)
  );

  // Its style block is swallowed by a broken comment, so every colour it shows
  // came from engine.js's DEFAULT_PALETTE.
  const { page } = await sandboxPage(browser, base, 'sandbox-broken-head-comment.html');
  const state = await page.evaluate(readSandbox);

  for (const name of ['bass', 'mid', 'high']) {
    check(
      `the fallback --${name} still matches the template`,
      state.colours && String(state.colours[name]) === fromTemplate[name],
      `engine ${state.colours && state.colours[name]} vs template ${fromTemplate[name]}`
    );
  }

  await page.close();
}

// Two mistakes at once. Both messages go to the same line in the rail and the
// GIF's callback lands last, so the GIF note used to erase the explanation for
// the thing a student cannot work out on their own. A GIF that did not load is
// obvious from the stage; a colour that came out wrong is not.
async function twoMistakesTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-typo-and-gif.html');
  const state = await page.evaluate(readSandbox);

  check('a typo and a missing GIF throw nothing', thrown.length === 0, thrown.join(' | '));
  check('a typo and a missing GIF still paint', state.painted);
  check(
    'the GIF note survives',
    typeof state.status === 'string' && state.status.includes('nope.gif'),
    String(state.status)
  );
  check(
    'the typo warning survives beside it',
    typeof state.status === 'string' && /colours/i.test(state.status),
    String(state.status)
  );

  await page.close();
}

// The ticket's second condition, made executable: a typo in the block a
// student edits must not stop the audio or the visuals.
//
// The typos live in a committed fixture page rather than being injected after
// load. readPalette() runs once inside init(), so a stylesheet added after
// page.goto() arrives too late to be read and the assertion would pass
// whether the fallback worked or not. A student's typo is in their file
// before the page boots, and so is this one.
async function typoSafetyTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-typo.html');
  const state = await page.evaluate(readSandbox);
  const bass = await page.evaluate(playFixtureTone, base);

  check('a bad colour and a bad mode throw nothing', thrown.length === 0, thrown.join(' | '));
  check('the visuals still paint', state.painted);
  check('the audio still reads', bass !== null && bass > 0.02, `bass ${bass}`);
  check(
    'a nonsense mode falls back rather than blanking',
    state.mode === 'flow',
    String(state.mode)
  );
  check(
    'an unparseable colour keeps a usable value',
    !!state.colours && Array.isArray(state.colours.bass) && state.colours.bass.length === 3,
    JSON.stringify(state.colours && state.colours.bass)
  );

  await page.close();
}

// The likeliest thing a 12-year-old types is not #rrggbb. It is "red", or the
// three-digit hex they saw somewhere. DJVisualizer.parseColor accepts neither,
// so both used to reach the canvas as white with no message — an edit that
// looks like it did nothing. The sandbox resolves the token through the
// browser's own colour parser before the visualizer reads it.
async function colourWordTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-colour-words.html');
  const state = await page.evaluate(readSandbox);
  const rgb = (name) => (state.colours ? String(state.colours[name]) : 'no colours');

  check('the colour-word fixture throws nothing', thrown.length === 0, thrown.join(' | '));
  check('a named colour reaches the canvas', rgb('bass') === '255,0,0', rgb('bass'));
  check('three-digit hex reaches the canvas', rgb('mid') === '0,255,0', rgb('mid'));
  check('rgb() still reaches the canvas', rgb('high') === '10,132,255', rgb('high'));

  await page.close();
}

// The machine used to sit below the student's markup, so one missing character
// in the region a student edits could swallow the stylesheet and all four
// script tags. Nothing load-bearing sits after the student's last line any
// more, and the element itself is rebuilt when the student's markup loses it.
//
// Each fixture is one real single-character break, verified in a browser:
//   comment  — the closing --> of the block-3 comment is gone
//   quote    — the closing " of gif="" is gone
//   tag      — an element the student opened and never closed
async function brokenMarkupTest(browser, base) {
  for (const [label, fixture, costs] of [
    ['an unterminated comment', 'sandbox-broken-comment.html', true],
    ['an unclosed attribute quote', 'sandbox-broken-quote.html', true],
    ['an unclosed tag', 'sandbox-broken-tag.html', false]
  ]) {
    const { page, thrown } = await sandboxPage(browser, base, fixture);
    const state = await page.evaluate(readSandbox);
    const bass = await page.evaluate(playFixtureTone, base);

    check(`${label} throws nothing`, thrown.length === 0, thrown.join(' | '));
    check(`${label} still paints`, state.painted, JSON.stringify(state));
    check(`${label} still reads audio`, bass !== null && bass > 0.02, `bass ${bass}`);

    // A rebuilt page looks exactly like a correct one. A student who loses
    // their name to a missing quote mark learns that the name does not work,
    // not that they made a typo, unless the rail says so.
    if (costs) {
      check(
        `${label} tells the student what it cost`,
        typeof state.status === 'string' && /quote mark/.test(state.status),
        String(state.status)
      );
    } else {
      check(
        `${label} costs nothing and says nothing`,
        state.status === 'Pick your music to start' && state.name === 'Broken Tag',
        `${state.status} / ${state.name}`
      );
    }

    await page.close();
  }
}

// Every other broken fixture breaks the body. This one breaks the head: the
// closing fence of the student's title comment is gone, so the comment runs to
// the next fence in the body and swallows the <title> and the whole <style>
// block on its way. The element itself survives, so the rebuild net never
// fires — and all three colours used to come back white with nothing said,
// which is the exact symptom the colour work existed to kill.
async function brokenHeadCommentTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-broken-head-comment.html');
  const state = await page.evaluate(readSandbox);
  const bass = await page.evaluate(playFixtureTone, base);
  const rgb = (name) => (state.colours ? String(state.colours[name]) : 'no colours');

  check('a broken head comment throws nothing', thrown.length === 0, thrown.join(' | '));
  check('a broken head comment still paints', state.painted);
  check('a broken head comment still reads audio', bass !== null && bass > 0.02, `bass ${bass}`);
  check(
    'a swallowed style block does not leave white bass',
    rgb('bass') === '255,69,58',
    rgb('bass')
  );
  check('a swallowed style block does not leave white mid', rgb('mid') === '48,209,88', rgb('mid'));
  check(
    'a swallowed style block does not leave white high',
    rgb('high') === '10,132,255',
    rgb('high')
  );
  check(
    'a swallowed style block tells the student',
    typeof state.status === 'string' && /colours/i.test(state.status),
    String(state.status)
  );

  await page.close();
}

// A page that boots perfectly must stay quiet. A warning that appears on a
// correct page trains a student to ignore the rail.
async function quietWhenCorrectTest(browser, base) {
  const { page } = await sandboxPage(browser, base, 'sandbox-attributes.html');
  const state = await page.evaluate(readSandbox);

  check(
    'a correct page says nothing about typos',
    state.status === 'Pick your music to start',
    String(state.status)
  );

  await page.close();
}

// "Code how hard it hits." A boost the student wrote reaches both the slider
// and the numbers the visualizer draws from. A word or a number past the
// slider's ends is replaced, never thrown on, and the rail names it. Moving a
// slider changes the next reading without a restart, which is the reason the
// sliders exist: a CodePen edit restarts the picture and stops the music.
async function boostTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-boosts.html');

  const state = await page.evaluate(() => {
    const el = window.djSandbox;
    if (!el) return null;
    const feed = () => {
      el.processor.onDataUpdate({ bass: 0.5, mid: 0.5, high: 0.5, bpm: 0 });
      const d = el.visualizer.audioData;
      return { bass: d.bass, mid: d.mid, high: d.high };
    };
    const boosts = { ...el.boosts };
    const sliders = Object.fromEntries(
      Object.entries(el.boostSliders).map(([band, input]) => [band, input.value])
    );
    const before = feed();
    const slider = el.boostSliders.bass;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));
    const after = feed();
    return {
      boosts,
      sliders,
      before,
      after,
      shown: slider.parentElement.querySelector('.sandbox-boost-value').textContent,
      status: document.querySelector('.sandbox-status').textContent,
      inRail: !!document.querySelector('.sandbox-rail .sandbox-boosts')
    };
  });

  check('the boost fixture throws nothing', thrown.length === 0, thrown.join(' | '));
  check('the boost fixture boots', !!state);
  if (!state) {
    await page.close();
    return;
  }

  check('a written boost is applied', state.boosts.bass === 2, JSON.stringify(state.boosts));
  check('a word in a boost falls back to 1', state.boosts.mid === 1, JSON.stringify(state.boosts));
  check(
    'a boost past the top is moved to 3',
    state.boosts.high === 3,
    JSON.stringify(state.boosts)
  );
  check(
    'each slider starts where the code says',
    state.sliders.bass === '2' && state.sliders.mid === '1' && state.sliders.high === '3',
    JSON.stringify(state.sliders)
  );
  check(
    'the boost reaches the numbers the visualizer draws from',
    state.before.bass === 1 && state.before.mid === 0.5 && state.before.high === 1.5,
    JSON.stringify(state.before)
  );
  check(
    'moving a slider changes the next reading',
    state.after.bass === 0.25,
    JSON.stringify(state.after)
  );
  check('the slider shows its number', state.shown === '0.5', state.shown);
  check(
    'the rail names the boost that is not a number',
    state.status.includes('mid-boost'),
    state.status
  );
  check('the rail names the boost past the end', state.status.includes('high-boost'), state.status);
  check('the boosts sit inside the rail', state.inRail);

  await page.close();
}

// Finding 7, finished. "Has a cause" was a proxy for "this project wrote this
// string", and the proxy fails for everything thrown inside attachStream —
// a failed audioWorklet.addModule most of all. These two stubs are the two
// sides of the rule: our own words survive, the browser's never appear.
async function errorWordingTest(browser, base) {
  const { page } = await sandboxPage(browser, base, 'sandbox-attributes.html');
  const OURS =
    'That tab was shared without its sound. Try again and tick "Share tab audio" in the dialog.';
  const BROWSER = 'Failed to load module script: Expected a JavaScript module script.';

  const ourWords = await page.evaluate(async (message) => {
    const el = window.djSandbox;
    el.processor.startTabAudio = () => Promise.reject(new Error(message));
    await el.useTab();
    return document.querySelector('.sandbox-status').textContent;
  }, OURS);

  check('a message this project wrote survives', ourWords === OURS, ourWords);

  const tabJargon = await page.evaluate(async (message) => {
    const el = window.djSandbox;
    el.processor.startTabAudio = () => Promise.reject(new DOMException(message, 'AbortError'));
    await el.useTab();
    return document.querySelector('.sandbox-status').textContent;
  }, BROWSER);

  check(
    "the browser's words never reach the rail on the tab path",
    !/module script/i.test(tabJargon) && tabJargon.length > 0,
    tabJargon
  );

  const fileJargon = await page.evaluate(async (message) => {
    const el = window.djSandbox;
    el.processor.startFileAudio = () =>
      Promise.reject(new DOMException(message, 'NotSupportedError'));
    Object.defineProperty(el.fileInput, 'files', {
      configurable: true,
      get: () => [{ name: 'song.flac' }]
    });
    await el.useFile();
    return document.querySelector('.sandbox-status').textContent;
  }, BROWSER);

  check(
    "the browser's words never reach the rail on the file path",
    !/module script/i.test(fileJargon),
    fileJargon
  );

  check(
    'a file the browser cannot play says what to try instead',
    /MP3/.test(fileJargon),
    fileJargon
  );

  await page.close();
}

// The third Done-when condition: a GIF that is not there must fail as a
// message, never as a stopped visualization. It must also not cost the student
// the mode they chose, which the failure path used to reset to a hard-coded
// default.
async function gifMissingTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-gif-missing.html');
  const state = await page.evaluate(readSandbox);
  const bass = await page.evaluate(playFixtureTone, base);

  check('a missing GIF throws nothing', thrown.length === 0, thrown.join(' | '));
  check('a missing GIF still paints', state.painted);
  check('a missing GIF still reads audio', bass !== null && bass > 0.02, `bass ${bass}`);
  check(
    'a missing GIF names the file it could not find',
    typeof state.status === 'string' && state.status.includes('nope.gif'),
    String(state.status)
  );
  check("a missing GIF keeps the student's own mode", state.mode === 'rings', String(state.mode));

  await page.close();
}

// `custom` was offered to students in the template's mode comment, and with no
// GIF it draws the empty drop target: a pulsing square on the whole stage, with
// no message. The word is gone from both lists now, so a student who typed it
// from an older handout has to land on a mode that really draws.
async function modeFallbackTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-mode-custom.html');
  const state = await page.evaluate(readSandbox);
  const bass = await page.evaluate(playFixtureTone, base);

  check('mode="custom" with no GIF throws nothing', thrown.length === 0, thrown.join(' | '));
  check('mode="custom" with no GIF still paints', state.painted);
  check(
    'mode="custom" with no GIF still reads audio',
    bass !== null && bass > 0.02,
    `bass ${bass}`
  );
  check(
    'mode="custom" with no GIF falls back to a drawing mode',
    state.mode === 'flow',
    String(state.mode)
  );
  check(
    'mode="custom" with no GIF draws no GIF',
    state.hasMedia === false,
    String(state.mediaType)
  );

  await page.close();
}

// The success path, which was also untested. A GIF that loads takes over the
// stage, and the template's comment now says so.
async function gifLoadedTest(browser, base) {
  const { page, thrown } = await sandboxPage(browser, base, 'sandbox-gif-ok.html');
  const state = await page.evaluate(readSandbox);

  check('a loaded GIF throws nothing', thrown.length === 0, thrown.join(' | '));
  check('a loaded GIF still paints', state.painted);
  check(
    'a loaded GIF becomes the custom media',
    state.hasMedia && state.mediaType === 'image',
    `${state.mediaType}`
  );
  check('a loaded GIF takes over the mode', state.mode === 'custom', String(state.mode));
  check(
    'a loaded GIF reports no error',
    state.status !== null && !/Could not find/.test(state.status),
    String(state.status)
  );

  await page.close();
}

const server = await serve();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => check('page threw', false, error.message));
  await page.goto(`${BASE}/sandbox/probe.html`);
  await page.addScriptTag({ url: `${BASE}/app/audioProcessor.js` });

  await seamTest(page);
  await fileSourceTest(page);
  await fileTeardownTest(page);
  await tabCaptureTest(page);
  await tabCaptureNoAudioTest(page);

  // Each of these boots a whole sandbox page, so each one gets its own.
  await elementBootTest(browser, BASE);
  await shippedTemplateTest(browser, BASE);
  await paletteDriftTest(browser, BASE);
  await twoMistakesTest(browser, BASE);
  await typoSafetyTest(browser, BASE);
  await colourWordTest(browser, BASE);
  await brokenMarkupTest(browser, BASE);
  await brokenHeadCommentTest(browser, BASE);
  await quietWhenCorrectTest(browser, BASE);
  await boostTest(browser, BASE);
  await errorWordingTest(browser, BASE);
  await modeFallbackTest(browser, BASE);
  await gifMissingTest(browser, BASE);
  await gifLoadedTest(browser, BASE);
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
