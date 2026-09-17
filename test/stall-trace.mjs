/* Frame-stall harness — PHI-176.
 *
 * Answers one question the hardware probe cannot: when a mode drops a frame,
 * what was the browser doing? It runs the real app in headed Chromium on the
 * real GPU, injects test/hardware-probe.js for frame timing, and records a
 * Chrome trace over each mode window. Each frame over 33 ms is then matched to
 * the garbage collection (GC) events and long main-thread tasks that overlap it.
 *
 * Headed, not headless, on purpose. Headless Chromium renders WEBGL on
 * SwiftShader, which measures the CPU instead of the stage. The window must stay
 * in front for the whole run: an unfocused window throttles frames, and the
 * probe drops those frames rather than count them.
 *
 *   npm run fixtures
 *   node test/stall-trace.mjs
 *
 * Options, all environment variables:
 *   MODES=rings,mandala,polygons   modes to measure, in order
 *   DWELL=20000                    ms per mode window
 *   WAV=broadband-124bpm.wav       fixture name, or an absolute path
 *   DPR=2                          device pixel ratio of the page
 *   FULL=1                         native density, no PHI-174 pixel budget
 *                                  (the condition of the 08/10 hardware run)
 *   THROTTLE=4                     CPU slowdown on the page's main thread
 *
 * Findings from the first runs, 2026-09-14, on the M1 Max used on 08/10 with
 * Serato closed and the built-in display: zero frames over 33 ms in every
 * combination of density, 4x throttle, and broadband audio. Still untested:
 * Serato DJ Pro open, and an external display in real fullscreen. See PHI-176.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 'output');
const PORT = 8125;

const MODES = (process.env.MODES || 'rings,mandala,particles,polygons,galaxy').split(',');
const DWELL = Number(process.env.DWELL || 20000);
const WAV = process.env.WAV || 'broadband-124bpm.wav';
const DPR = Number(process.env.DPR || 2);
const FULL = process.env.FULL === '1';
const THROTTLE = Number(process.env.THROTTLE || 1);
const SLOW_MS = 1000 / 30;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
    // Read before writing headers: a missing favicon must be a 404, not a crash.
    let body;
    try {
      body = await readFile(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

// Only the events that can explain a slow frame. A 60 s trace is several
// hundred thousand events, and nearly all of them are sub-millisecond noise.
const KEEP = new Set([
  'MinorGC',
  'MajorGC',
  'V8.GCScavenger',
  'V8.GCFinalizeMC',
  'V8.GCCompactor',
  'FireAnimationFrame',
  'Paint',
  'Layerize',
  'Commit',
  'UpdateLayoutTree',
  'Layout',
  'TimerFire',
  'FunctionCall',
  'RunTask',
  'ThreadControllerImpl::RunTask'
]);
const GC = /GC|Scavenge|MarkCompact/;

async function measureMode(page, cdp, mode) {
  await page.evaluate((m) => djApp.switchVisualizationMode(m), mode);
  // Let the switch itself fall outside the window.
  await page.waitForTimeout(1500);

  const events = [];
  const onData = ({ value }) => {
    for (const e of value) {
      if (e.cat?.includes('blink.user_timing') || KEEP.has(e.name) || (e.dur && e.dur > 8000))
        events.push(e);
    }
  };
  cdp.on('Tracing.dataCollected', onData);
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'v8',
        'disabled-by-default-v8.gc',
        'blink.user_timing',
        'toplevel'
      ]
    }
  });

  // The user-timing mark lands in the trace at a known performance.now(), which
  // is the bridge between the trace clock and the probe's frame clock.
  const sync = await page.evaluate((m) => {
    performance.mark('stall-trace-sync');
    const perfNow = performance.now();
    const mark = hw.mark(`trace-${m}`);
    return { perfNow, offset: perfNow - mark.at };
  }, mode);

  await page.waitForTimeout(DWELL);
  await page.evaluate((m) => hw.mark(`trace-${m}-end`), mode);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', onData);

  const window = await page.evaluate((m) => {
    const s = hw.raw();
    const from = s.marks.find((x) => x.name === `trace-${m}`).at;
    const to = s.marks.find((x) => x.name === `trace-${m}-end`).at;
    const bands = s.bands.filter((r) => r.at >= from && r.at < to);
    const avg = (k) => bands.reduce((t, r) => t + (r[k] || 0), 0) / (bands.length || 1);
    const bpm = s.bpm.filter((r) => r.at >= from && r.at < to).map((r) => r.bpm);

    // A quiet signal makes Polygon Collage paint nothing, which reads as clean
    // for the wrong reason. Record how much of its canvas is actually covered.
    let collageLit = null;
    const cc = document.querySelector('#collage-canvas');
    if (cc && !cc.hidden) {
      const d = cc.getContext('2d').getImageData(0, 0, cc.width, cc.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      collageLit = +(lit / (cc.width * cc.height)).toFixed(3);
    }
    return {
      frames: s.frames.filter((f) => f.at >= from && f.at < to && f.mode === m),
      levels: {
        bass: +avg('bass').toFixed(2),
        mid: +avg('mid').toFixed(2),
        high: +avg('high').toFixed(2),
        bpmMax: Math.max(0, ...bpm)
      },
      collageLit
    };
  }, mode);

  return { mode, sync, events, ...window };
}

function summarize({ mode, sync, events, frames, levels, collageLit }) {
  const kept = frames.filter((f) => f.focus && !f.hiddenGap && !f.blurGap && f.dt > 0);
  const dts = kept.map((f) => f.dt).sort((a, b) => a - b);
  const at = (p) => dts[Math.floor(p * (dts.length - 1))];
  const fps = (ms) => +(1000 / ms).toFixed(1);
  const slow = kept.filter((f) => f.dt > SLOW_MS);

  const anchor = events.find((e) => e.name === 'stall-trace-sync');
  const main = anchor && `${anchor.pid}:${anchor.tid}`;
  const onMain = anchor
    ? events
        .filter((e) => e.ts && `${e.pid}:${e.tid}` === main)
        .map((e) => ({
          name: e.name,
          start: sync.perfNow + (e.ts - anchor.ts) / 1000,
          dur: (e.dur || 0) / 1000
        }))
    : [];
  const gcs = onMain.filter((e) => GC.test(e.name));

  return {
    mode,
    levels,
    collageLit,
    samples: kept.length,
    p50: fps(at(0.5)),
    p05: fps(at(0.95)),
    min: fps(at(1)),
    slowPer1000: +((slow.length * 1000) / (kept.length || 1)).toFixed(1),
    gc: {
      events: gcs.length,
      totalMs: Math.round(gcs.reduce((t, e) => t + e.dur, 0)),
      maxMs: +gcs.reduce((m, e) => Math.max(m, e.dur), 0).toFixed(1)
    },
    // Main-thread work inside each slow frame. An empty list points away from
    // script and GC, toward the GPU or the compositor.
    slowFrames: slow.slice(0, 20).map((f) => {
      const end = f.at + sync.offset;
      const start = end - f.dt;
      return {
        dt: +f.dt.toFixed(1),
        overlapping: onMain
          .filter((e) => e.start < end && e.start + e.dur > start && e.dur > 2)
          .sort((a, b) => b.dur - a.dur)
          .slice(0, 4)
          .map((e) => `${e.name} ${e.dur.toFixed(1)}ms`)
      };
    })
  };
}

const server = await serve();
const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV.startsWith('/') ? WAV : join(HERE, 'fixtures', WAV)}`,
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1920,1400'
  ]
});

try {
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1920, height: 1280 },
    deviceScaleFactor: DPR
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer);
  await page.bringToFront();
  await page.click('#start');
  await page.waitForTimeout(3000);

  if (FULL) {
    await page.evaluate(() => {
      const v = djApp.visualizer;
      v.computeDensity = (p) => p.displayDensity();
      v.p5Instance.windowResized();
    });
    await page.waitForTimeout(1000);
  }
  await page.addScriptTag({ content: await readFile(join(HERE, 'hardware-probe.js'), 'utf8') });

  const env = await page.evaluate(() => {
    const canvas = document.querySelector('#p5-canvas canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      backing: [canvas.width, canvas.height],
      css: [canvas.clientWidth, canvas.clientHeight],
      dpr: devicePixelRatio,
      focus: document.hasFocus()
    };
  });
  console.log(
    'env',
    JSON.stringify({ ...env, wav: WAV, full: FULL, throttle: THROTTLE, dwell: DWELL })
  );
  if (/swiftshader/i.test(env.renderer))
    console.warn('WARNING: software renderer; FPS is not indicative');

  const cdp = await context.newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const summaries = [];
  for (const mode of MODES) {
    const s = summarize(await measureMode(page, cdp, mode));
    summaries.push(s);
    console.log(
      `\n${s.mode}: n=${s.samples} p50 ${s.p50} p05 ${s.p05} min ${s.min} slow/1000 ${s.slowPer1000}`
    );
    console.log(`  levels ${JSON.stringify(s.levels)} collageLit ${s.collageLit}`);
    console.log(`  GC ${s.gc.events} events, ${s.gc.totalMs} ms total, ${s.gc.maxMs} ms max`);
    for (const f of s.slowFrames) {
      console.log(
        `  slow ${f.dt} ms -> ${f.overlapping.join(' | ') || 'no main-thread task over 2 ms (GPU or compositor?)'}`
      );
    }
  }

  console.log(`\npage errors: ${errors.length}${errors[0] ? ` (${errors[0]})` : ''}`);
  await mkdir(OUT, { recursive: true });
  const name = `stall-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(
    join(OUT, name),
    JSON.stringify(
      { env, options: { MODES, DWELL, WAV, DPR, FULL, THROTTLE }, summaries, errors },
      null,
      2
    )
  );
  console.log(`wrote test/output/${name}`);
} finally {
  await browser.close();
  server.close();
}
