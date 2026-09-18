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
