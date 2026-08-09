/* Runs the real app against real audio.
 *
 * Chromium's fake audio device plays a WAV file through getUserMedia, so every
 * layer below the physical hardware is the production path: a real MediaStream,
 * a real AudioContext, a real AnalyserNode, the real FFT, the real DOM. Only
 * the microphone is substituted.
 *
 * That matters because the band math is only checkable against audio whose
 * frequency content is known. A 100 Hz tone must light bass and nothing else.
 * If it lights mid, the band splits are wrong — which is exactly the defect
 * this harness was written to catch, and which no amount of injected synthetic
 * `audioData` would ever have revealed.
 *
 * What this does NOT cover, and what still needs the controller in the room:
 * device enumeration and DDJ prioritisation, USB line level and gain staging,
 * sustained thermal performance, and the projector. See CONTRIBUTING.md.
 *
 *   node test/fixtures/make-audio.mjs && node test/verify-audio.mjs
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 'output');
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png'
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
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

async function withAudio(wav, run, beforeStart) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(HERE, 'fixtures', wav)}`,
      // Headless Chromium has no GPU; p5 runs WEBGL on SwiftShader instead.
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'load' });
  // `djApp` is a top-level `let` in a classic script, so it lives in the global
  // lexical scope rather than on `window` — reachable bare, not as a property.
  await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer);
  if (beforeStart) await beforeStart(page);
  await page.click('#start');
  // Let the analyser fill and the band smoothing settle.
  await page.waitForTimeout(2500);

  try {
    await run(page, errors);
  } finally {
    await browser.close();
  }
}

const read = (page) => page.evaluate(() => ({
  bass: djApp.audioProcessor.bass,
  mid: djApp.audioProcessor.mid,
  high: djApp.audioProcessor.high,
  rms: djApp.audioProcessor.rms,
  bpm: djApp.audioProcessor.bpm,
  binHz: (djApp.audioProcessor.audioContext?.sampleRate / 2) /
         (djApp.audioProcessor.spectrum?.length || 1),
  meters: {
    bass: document.querySelector('.bass-fill')?.style.width,
    mid: document.querySelector('.mid-fill')?.style.width,
    high: document.querySelector('.high-fill')?.style.width
  }
}));

async function bandTest(wav, expected, hz) {
  console.log(`\n${hz} Hz tone → expecting "${expected}" to dominate`);
  await withAudio(wav, async (page, errors) => {
    const state = await read(page);
    const others = ['bass', 'mid', 'high'].filter(b => b !== expected);
    const top = state[expected];
    const rest = Math.max(...others.map(b => state[b]));

    console.log(`        bass=${state.bass.toFixed(3)} mid=${state.mid.toFixed(3)} high=${state.high.toFixed(3)}  binHz=${state.binHz.toFixed(1)}`);

    check(`${hz} Hz registers in ${expected}`, top > 0.05, `${expected}=${top.toFixed(3)}`);
    check(`${hz} Hz does not bleed into ${others.join('/')}`, top > rest * 2.5,
      `${expected}=${top.toFixed(3)} vs next=${rest.toFixed(3)}`);
    check(`${hz} Hz meter tracks the band`, state.meters[expected] !== '0%' &&
      state.meters[expected] !== undefined, `width=${state.meters[expected]}`);
    check(`${hz} Hz raises no page errors`, errors.length === 0, errors[0] || 'clean');
  });
}

async function beatTest() {
  console.log('\n120 BPM kick pattern → expecting BPM readout near 120');
  await withAudio('kick-120bpm.wav', async (page, errors) => {
    // BPM needs several confirmed intervals before it means anything.
    await page.waitForTimeout(5000);

    const state = await read(page);
    const shown = await page.textContent('#bpmCounter');
    const beats = await page.evaluate(() => window.__beatCount ?? null);

    console.log(`        detected=${state.bpm} readout=${shown} bass=${state.bass.toFixed(3)}`);

    check('BPM is detected at all', state.bpm > 0, `bpm=${state.bpm}`);
    check('BPM lands within 8 of 120', Math.abs(state.bpm - 120) <= 8, `bpm=${state.bpm}`);
    check('BPM readout matches the engine', shown.trim() === String(state.bpm),
      `readout="${shown.trim()}"`);
    check('kick drives the beat envelope',
      typeof beats === 'number' ? beats > 4 : true, `beats=${beats}`);
    check('beat pass raises no page errors', errors.length === 0, errors[0] || 'clean');
  }, async (page) => {
    // Count real beat events at the seam where the app wires them, so this
    // measures the event the stage actually consumes.
    await page.evaluate(() => {
      window.__beatCount = 0;
      const original = djApp.audioProcessor.onBeat;
      djApp.audioProcessor.onBeat = (t) => { window.__beatCount++; original(t); };
    });
  });
}

// Tempo accuracy across the range, and specifically the octave behaviour.
// An earlier build doubled anything between 45 and 90 BPM, so 85 reported 171;
// these assertions exist so that cannot come back unnoticed.
async function tempoTest(wav, bpm) {
  console.log(`\n${bpm} BPM kick pattern`);
  await withAudio(wav, async (page, errors) => {
    await page.waitForTimeout(14000);
    const state = await read(page);
    const off = Math.abs(state.bpm - bpm);
    console.log(`        detected=${state.bpm} (off by ${off})`);
    check(`${bpm} BPM detected within 6`, off <= 6, `detected ${state.bpm}`);
    check(`${bpm} BPM not octave-shifted`, state.bpm < bpm * 1.5 && state.bpm > bpm * 0.6,
      `detected ${state.bpm}`);
    check(`${bpm} BPM pass raises no page errors`, errors.length === 0, errors[0] || 'clean');
  });
}

async function modeTest() {
  console.log('\nAll nine modes, rendering against the 120 BPM pattern');
  await mkdir(OUT, { recursive: true });

  await withAudio('kick-120bpm.wav', async (page, errors) => {
    const modes = await page.$$eval('#visualMode option', opts =>
      opts.map(o => ({ value: o.value, label: o.textContent.trim() })));

    check('ten modes are offered', modes.length === 10, `${modes.length} found`);

    for (const mode of modes) {
      const before = errors.length;
      await page.selectOption('#visualMode', mode.value);
      await page.waitForTimeout(1200);

      // A mode that throws every frame still "renders" a black canvas, so the
      // pixel check and the error check both have to pass.
      const painted = await page.evaluate(() => {
        const count = (pixels) => {
          let lit = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
          }
          return lit;
        };

        let lit = 0, total = 0;

        const canvas = document.querySelector('#p5-canvas canvas');
        if (!canvas) return { ok: false, reason: 'no canvas' };
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return { ok: false, reason: 'no webgl context' };
        const buffer = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
        lit += count(buffer);
        total += canvas.width * canvas.height;

        // Polygon Collage paints into its own 2D layer beneath the WEBGL one,
        // which is deliberately transparent for that mode.
        const collage = document.querySelector('#collage-canvas');
        if (collage && !collage.hidden) {
          const ctx = collage.getContext('2d');
          lit += count(ctx.getImageData(0, 0, collage.width, collage.height).data);
        }

        return { ok: true, lit, total, ratio: lit / total };
      });

      await page.screenshot({ path: join(OUT, `mode-${mode.value}.png`) });

      const fresh = errors.slice(before);
      // Custom Upload has nothing loaded, so it draws only the drop target.
      const floor = mode.value === 'custom' ? 0.0002 : 0.001;
      check(`${mode.label} paints`, painted.ok && painted.ratio > floor,
        painted.ok ? `${(painted.ratio * 100).toFixed(2)}% of pixels lit` : painted.reason);
      check(`${mode.label} runs clean`, fresh.length === 0, fresh[0] || 'no errors');
    }

    const fps = await page.textContent('#fpsCounter');
    check('frame rate is reported', fps.trim() !== '—', `${fps.trim()} fps (SwiftShader, not indicative)`);
  });
}

async function silenceTest() {
  console.log('\nSilence → the stage must not invent a signal');
  await withAudio('tone-10khz.wav', async (page) => {
    // Stop the audio and confirm the meters return to zero rather than idling
    // at some fabricated level.
    await page.click('#start');
    await page.waitForTimeout(600);
    const meters = await page.evaluate(() => ({
      bass: document.querySelector('.bass-fill').style.width,
      mid: document.querySelector('.mid-fill').style.width,
      high: document.querySelector('.high-fill').style.width
    }));
    const zeroed = Object.values(meters).every(v => v === '0%');
    check('meters return to zero when stopped', zeroed, JSON.stringify(meters));
  });
}

const server = await serve();
try {
  if (!existsSync(join(HERE, 'fixtures', 'tone-100hz.wav'))) {
    console.error('Fixtures missing. Run: node test/fixtures/make-audio.mjs');
    process.exit(1);
  }

  await bandTest('tone-100hz.wav', 'bass', 100);
  await bandTest('tone-1khz.wav', 'mid', 1000);
  await bandTest('tone-10khz.wav', 'high', 10000);
  await beatTest();
  await tempoTest('kick-85bpm.wav', 85);
  await tempoTest('kick-128bpm.wav', 128);
  await tempoTest('kick-174bpm.wav', 174);
  await modeTest();
  await silenceTest();
} finally {
  server.close();
}

const failed = results.filter(r => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2)).catch(() => {});
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
  process.exit(1);
}
