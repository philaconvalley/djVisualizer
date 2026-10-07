/* Proves the flash ceiling by measurement. PHI-265.
 *
 * WCAG 2.3.1: no more than three flashes in any one second. The guard lives
 * in app/visualizer.js; this harness checks it three ways, each one closer to
 * the room:
 *
 *   1. Logic. FlashGuard alone, in Node, fed synthetic frames: a 12 Hz
 *      full-screen strobe, a 12 Hz red strobe too dim to trip the luminance
 *      rule, and a 2 Hz pulse that must pass through untouched.
 *   2. Forced strobe in the real app. One mode is replaced with a 12 Hz
 *      full-canvas strobe, white and then red, so the input is known to
 *      break the rule. The meter reads the canvas after the guard (?flashlog)
 *      and must count three flashes or fewer while the raw input counts more.
 *   3. Real audio in the real app. Every mode runs against kick fixtures, a
 *      red-heavy palette, and — if one is given — a real track at its loudest
 *      passage. Nothing here is forced, so this shows the ceiling on what the
 *      modes actually draw.
 *
 * Also checks the reduced-motion path and the warning screen at phone width,
 * and writes screenshots to test/output/flash/.
 *
 *   npm run fixtures && node test/verify-flash.mjs
 *   node test/verify-flash.mjs --track "/path/to/song.mp3"   # needs ffmpeg
 *
 * The track is cut to its loudest 40 seconds into test/fixtures/, which git
 * ignores. Do not commit music.
 *
 * Headless Chromium renders on SwiftShader at a fraction of a real GPU's frame
 * rate, and the meter counts the frames that were rendered. Run ?flashlog on
 * the event machine too: that is the measurement at 60 FPS.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 'output', 'flash');
const PORT = 8125;
const BASE = `http://127.0.0.1:${PORT}`;
const MODES = [
  'spectrum',
  'particles',
  'rings',
  'waves',
  'mandala',
  'tunnel',
  'galaxy',
  'flow',
  'polygons',
  'custom'
];
const SECONDS_PER_MODE = 6;

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------- 1. logic */

async function logicTests() {
  console.log('\n1. FlashGuard logic, synthetic frames at 60 FPS');
  const source = await readFile(join(ROOT, 'app', 'visualizer.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nthis.FlashGuard = FlashGuard;`, context);
  const { FlashGuard } = context;

  const frame = (rgb) => {
    const pixels = new Uint8ClampedArray(64 * 36 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
      pixels[i + 3] = 255;
    }
    return pixels;
  };

  // Runs a square wave through a guard. Counts flashes in the worst one-second
  // window of what the guard let through, measured by an independent counter.
  const run = (hz, on, off, seconds = 5) => {
    const guard = new FlashGuard();
    const onFrame = frame(on);
    const offFrame = frame(off);
    const shown = { lum: [], red: [] };
    const raw = { lum: [], red: [] };
    let veiled = 0;
    for (let f = 0; f < seconds * 60; f++) {
      const t = (f * 1000) / 60;
      const pixels = Math.floor((t / 1000) * hz * 2) % 2 === 0 ? onFrame : offFrame;
      const r = guard.process(pixels, t);
      if (r.scale < 1) veiled++;
      shown.lum.push([t, r.shownLuminance]);
      shown.red.push([t, r.shownRed]);
      raw.lum.push([t, r.rawLuminance]);
      raw.red.push([t, r.rawRed]);
    }
    return {
      flashes: worstFlashes(shown.lum, FlashGuard.LUMINANCE_THRESHOLD),
      redFlashes: worstFlashes(shown.red, FlashGuard.RED_THRESHOLD),
      rawFlashes: worstFlashes(raw.lum, FlashGuard.LUMINANCE_THRESHOLD),
      rawRedFlashes: worstFlashes(raw.red, FlashGuard.RED_THRESHOLD),
      veiled
    };
  };

  const white = run(12, [255, 255, 255], [0, 0, 0]);
  check(
    '12 Hz white strobe is held to 3 flashes per second',
    white.rawFlashes > 3 && white.flashes <= 3,
    `raw ${white.rawFlashes}, shown ${white.flashes}`
  );

  // Dark red: luminance swing 0.03, under the general rule's 0.1. Only the red
  // rule can see this one, which is why it is a separate rule.
  const darkRed = run(12, [110, 0, 0], [0, 0, 0]);
  check(
    '12 Hz dark-red strobe is invisible to the luminance rule',
    darkRed.rawFlashes === 0,
    `raw luminance flashes ${darkRed.rawFlashes}`
  );
  check(
    '12 Hz dark-red strobe is held to 3 red flashes per second',
    darkRed.rawRedFlashes > 3 && darkRed.redFlashes <= 3,
    `raw ${darkRed.rawRedFlashes}, shown ${darkRed.redFlashes}`
  );

  const pulse = run(2, [255, 255, 255], [0, 0, 0]);
  check(
    '2 Hz pulse (a 120 BPM kick) passes through untouched',
    pulse.veiled === 0 && pulse.flashes === 2,
    `veiled frames ${pulse.veiled}, flashes ${pulse.flashes}`
  );
}

// An independent count, written from the WCAG definition rather than shared
// with the guard: a transition is a move of `threshold` or more away from the
// last extreme, in the opposite direction to the previous transition.
function worstFlashes(series, threshold) {
  const times = [];
  let rising = false;
  let low = series[0][1];
  let high = series[0][1];
  for (const [t, v] of series) {
    if (!rising) {
      low = Math.min(low, v);
      if (v - low >= threshold) {
        times.push(t);
        rising = true;
        high = v;
      }
    } else {
      high = Math.max(high, v);
      if (high - v >= threshold) {
        times.push(t);
        rising = false;
        low = v;
      }
    }
  }
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j] - times[i] < 1000) j++;
    worst = Math.max(worst, Math.ceil((j - i) / 2));
  }
  return worst;
}

/* --------------------------------------------------------- the browser */

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.png': 'image/png'
};

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

async function withApp(wav, run, { viewport = { width: 960, height: 600 }, reducedMotion } = {}) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(HERE, 'fixtures', wav)}`,
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${BASE}/?flashlog`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer);
  try {
    await run(page, errors);
  } finally {
    await browser.close();
  }
}

async function answerWarning(page) {
  if (await page.locator('#flashWarning[open]').count()) {
    await page.click('#flashWarningContinue');
  }
}

async function start(page) {
  await answerWarning(page);
  await page.click('#start');
  await page.waitForTimeout(2000);
}

// Resets the meter, runs a mode, and returns the worst window it saw.
async function measureMode(page, mode, seconds = SECONDS_PER_MODE) {
  await page.evaluate((m) => {
    djApp.switchVisualizationMode(m);
    djApp.visualizer.flashMeter = new FlashMeter();
  }, mode);
  await page.waitForTimeout(seconds * 1000);
  return page.evaluate(() => {
    const meter = djApp.visualizer.flashMeter;
    return {
      ...meter.worst,
      frames: meter.frames,
      veiledFrames: meter.veiledFrames,
      fps: Number(document.getElementById('fpsCounter').textContent) || 0
    };
  });
}

function summarise(label, m) {
  return `${label}: shown ${m.flashes} (red ${m.redFlashes}), raw ${m.rawFlashes} (red ${m.rawRedFlashes}), veiled ${m.veiledFrames}/${m.frames} frames, ${m.fps} FPS`;
}

/* ------------------------------------------------------ 2. forced strobe */

async function strobeTests() {
  console.log('\n2. Forced 12 Hz strobe in the real app');
  await withApp('kick-128bpm.wav', async (page, errors) => {
    await start(page);

    for (const [label, rgb] of [
      ['white', [255, 255, 255]],
      ['dark red', [110, 0, 0]]
    ]) {
      // Replace one mode's drawing with a full-canvas strobe. The guard runs
      // after the mode, so it sees this exactly as it would see a real mode.
      await page.evaluate((colour) => {
        const v = djApp.visualizer;
        v.drawSpectrum = (p) => {
          if (Math.floor(performance.now() / (1000 / 24)) % 2 === 0) {
            p.noStroke();
            p.fill(...colour);
            p.rect(-v.w / 2, -v.h, v.w, v.h * 2);
          }
        };
      }, rgb);
      const m = await measureMode(page, 'spectrum', 5);
      console.log(`        ${summarise(label, m)}`);
      const rawKey = label === 'white' ? 'rawFlashes' : 'rawRedFlashes';
      check(
        `forced ${label} strobe breaks the rule before the guard`,
        m[rawKey] > 3,
        `raw ${m[rawKey]}`
      );
      check(
        `forced ${label} strobe is held to 3 or fewer after the guard`,
        m.flashes <= 3 && m.redFlashes <= 3,
        `shown ${m.flashes}, red ${m.redFlashes}`
      );
    }
    check('strobe pass raises no page errors', errors.length === 0, errors[0] || 'clean');
  });
}

/* ---------------------------------------------------------- 3. real audio */

async function audioTests(wav, label, { redPalette = false } = {}) {
  console.log(`\n3. ${label}: every mode, nothing forced`);
  await withApp(wav, async (page, errors) => {
    await start(page);
    if (redPalette) {
      // A red-heavy palette state: every band token set to a saturated red.
      await page.evaluate(() => {
        const root = document.documentElement.style;
        root.setProperty('--bass', '#ff0000');
        root.setProperty('--mid', '#e0100a');
        root.setProperty('--high', '#c00000');
        djApp.visualizer.readPalette();
      });
    }
    let worst = 0;
    let worstRed = 0;
    for (const mode of MODES) {
      const m = await measureMode(page, mode);
      console.log(`        ${summarise(mode.padEnd(9), m)}`);
      worst = Math.max(worst, m.flashes);
      worstRed = Math.max(worstRed, m.redFlashes);
    }
    check(`${label}: no mode shows more than 3 flashes per second`, worst <= 3, `worst ${worst}`);
    check(
      `${label}: no mode shows more than 3 red flashes per second`,
      worstRed <= 3,
      `worst ${worstRed}`
    );
    check(`${label}: raises no page errors`, errors.length === 0, errors[0] || 'clean');
  });
}

// Cuts the loudest 40 seconds of a track into a mono WAV fixture.
async function prepareTrack(path) {
  const name = 'track-loudest.wav';
  const full = join(HERE, 'fixtures', 'track-full.raw');
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-ac',
    '1',
    '-ar',
    '44100',
    '-f',
    's16le',
    full
  ]);
  const bytes = readFileSync(full);
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
  const perSecond = [];
  for (let s = 0; s + 44100 <= pcm.length; s += 44100) {
    let sum = 0;
    for (let i = s; i < s + 44100; i++) sum += pcm[i] * pcm[i];
    perSecond.push(sum);
  }
  let best = 0;
  let bestAt = 0;
  for (let s = 0; s + 40 <= perSecond.length; s++) {
    let sum = 0;
    for (let i = s; i < s + 40; i++) sum += perSecond[i];
    if (sum > best) {
      best = sum;
      bestAt = s;
    }
  }
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-ss',
    String(bestAt),
    '-t',
    '40',
    '-i',
    path,
    '-ac',
    '2',
    '-ar',
    '48000',
    join(HERE, 'fixtures', name)
  ]);
  await rm(full);
  console.log(`\n   Track: loudest 40 s starts at ${bestAt} s`);
  return name;
}

/* ------------------------------------------ reduced motion and the phone */

async function reducedMotionTests() {
  console.log('\n4. Reduced motion is a different path, not a slower one');
  for (const [label, reduce] of [
    ['normal', false],
    ['reduced', true]
  ]) {
    await withApp(
      'kick-128bpm.wav',
      async (page) => {
        await start(page);
        await page.evaluate(() => {
          djApp.switchVisualizationMode('mandala');
          const v = djApp.visualizer;
          window.__trace = { beat: 0, phaseMoves: 0, lastPhase: v.phase, bass: [] };
          const sample = () => {
            window.__trace.beat = Math.max(window.__trace.beat, v.beat);
            if (v.phase !== window.__trace.lastPhase) window.__trace.phaseMoves++;
            window.__trace.lastPhase = v.phase;
            window.__trace.bass.push(v.audioData.bass);
            requestAnimationFrame(sample);
          };
          sample();
        });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: join(OUT, `mandala-${label}.png`) });
        const t = await page.evaluate(() => {
          const b = window.__trace.bass;
          let swing = 0;
          for (let i = 1; i < b.length; i++) swing = Math.max(swing, Math.abs(b[i] - b[i - 1]));
          return { beat: window.__trace.beat, phaseMoves: window.__trace.phaseMoves, swing };
        });
        console.log(
          `        ${label}: peak beat ${t.beat.toFixed(2)}, phase moves ${t.phaseMoves}, largest frame-to-frame bass step ${t.swing.toFixed(3)}`
        );
        if (reduce) {
          check('reduced motion: no beat strikes', t.beat === 0, `peak beat ${t.beat}`);
          check(
            'reduced motion: beat phase is frozen',
            t.phaseMoves === 0,
            `${t.phaseMoves} moves`
          );
          check(
            'reduced motion: band levels glide instead of hit',
            t.swing < 0.05,
            `largest step ${t.swing.toFixed(3)}`
          );
        } else {
          check('normal: beats strike', t.beat > 0.5, `peak beat ${t.beat.toFixed(2)}`);
        }
      },
      { reducedMotion: reduce }
    );
  }
  // Confirm the OS preference reached the toggle.
  await withApp(
    'kick-128bpm.wav',
    async (page) => {
      const on = await page.evaluate(
        () => document.getElementById('reduceMotion').checked && djApp.visualizer.reducedMotion
      );
      check('prefers-reduced-motion turns the calm path on', on);
    },
    { reducedMotion: true }
  );
}

async function phoneTests() {
  console.log('\n5. Phone view: the warning and the control');
  await withApp(
    'kick-128bpm.wav',
    async (page) => {
      const open = await page.locator('#flashWarning[open]').count();
      check('warning is open before anything starts', open === 1);
      await page.screenshot({ path: join(OUT, 'phone-warning.png') });

      await page.keyboard.press('Escape');
      const stillOpen = await page.locator('#flashWarning[open]').count();
      check('Esc does not dismiss the warning unanswered', stillOpen === 1);

      // Space activates the focused Continue button. It must answer the
      // warning and nothing else: the audio behind it stays stopped.
      await page.keyboard.press('Space');
      const afterSpace = await page.evaluate(() => ({
        running: djApp.isRunning,
        open: document.getElementById('flashWarning').open
      }));
      check(
        'Space answers the warning without starting the audio',
        !afterSpace.open && !afterSpace.running
      );

      // Fresh session, then answer with Reduce motion.
      await page.evaluate(() => sessionStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer);
      await page.click('#flashWarningReduce');
      const state = await page.evaluate(() => ({
        open: document.getElementById('flashWarning').open,
        checked: document.getElementById('reduceMotion').checked,
        calm: djApp.visualizer.reducedMotion
      }));
      check(
        'Reduce motion on the warning selects the calm path',
        !state.open && state.checked && state.calm
      );

      const box = await page.locator('label.toggle').boundingBox();
      const viewport = page.viewportSize();
      check(
        'Reduce motion control is on screen at phone width',
        !!box &&
          box.x >= 0 &&
          box.x + box.width <= viewport.width &&
          box.y + box.height <= viewport.height,
        box ? `at ${Math.round(box.x)},${Math.round(box.y)}` : 'not found'
      );
      await page.screenshot({ path: join(OUT, 'phone-rail.png') });

      await page.reload({ waitUntil: 'load' });
      const again = await page.locator('#flashWarning[open]').count();
      check('an answered warning stays answered on reload', again === 0);
    },
    { viewport: { width: 390, height: 844 } }
  );
}

/* ------------------------------------------------------------------ run */

const trackArg = process.argv.indexOf('--track');
const track = trackArg > -1 ? process.argv[trackArg + 1] : null;

await mkdir(OUT, { recursive: true });
if (!existsSync(join(HERE, 'fixtures', 'kick-128bpm.wav'))) {
  console.error('Fixtures missing. Run: npm run fixtures');
  process.exit(1);
}

await logicTests();
const server = await serve();
try {
  await strobeTests();
  await audioTests('kick-174bpm.wav', 'kick at 174 BPM');
  await audioTests('broadband-124bpm.wav', 'red-heavy palette', { redPalette: true });
  if (track) await audioTests(await prepareTrack(track), 'real track, loudest 40 s');
  await reducedMotionTests();
  await phoneTests();
} finally {
  server.close();
}

const failed = results.filter((r) => !r.passed);
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (!track) console.log('No --track given: the real-track measurement did not run.');
process.exit(failed.length ? 1 : 0);
