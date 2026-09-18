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
  await page.goto(`${base}/test/fixtures/${fixture}`);
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
    hasMedia: !!(el && el.visualizer && el.visualizer.customMedia)
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
  check(
    "the shipped template's --bass reaches the canvas",
    state.colours && String(state.colours.bass) === '255,69,58',
    JSON.stringify(state.colours)
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
  for (const [label, fixture] of [
    ['an unterminated comment', 'sandbox-broken-comment.html'],
    ['an unclosed attribute quote', 'sandbox-broken-quote.html'],
    ['an unclosed tag', 'sandbox-broken-tag.html']
  ]) {
    const { page, thrown } = await sandboxPage(browser, base, fixture);
    const state = await page.evaluate(readSandbox);
    const bass = await page.evaluate(playFixtureTone, base);

    check(`${label} throws nothing`, thrown.length === 0, thrown.join(' | '));
    check(`${label} still paints`, state.painted, JSON.stringify(state));
    check(`${label} still reads audio`, bass !== null && bass > 0.02, `bass ${bass}`);

    await page.close();
  }
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
  await typoSafetyTest(browser, BASE);
  await colourWordTest(browser, BASE);
  await brokenMarkupTest(browser, BASE);
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
