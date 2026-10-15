/* Soak driver — PHI-178.
 *
 * Runs the real app for an hour or more and records what a short window cannot
 * show: a thermal slide in FPS, memory that keeps growing, and a beat detector
 * that drifts. Start it and walk away.
 *
 *   LIVE=1 REAL_FS=1 node test/soak.mjs      # the ticket's run: DDJ-REV1, fullscreen, 60 min
 *   npm run fixtures && MINUTES=3 WINDOW=1 ROTATE=20000 MODES=particles,rings node test/soak.mjs
 *
 * It opens headed Chromium on the real GPU (headless renders on SwiftShader and
 * measures the CPU), injects test/soak-probe.js, and presses Start. The probe
 * rotates the modes once a minute, so each ten-minute window holds every mode.
 * Once a minute the driver also records what the page cannot see:
 *
 *   - power source and battery level (`pmset -g batt`), and whether Low Power
 *     Mode is on (`pmset -g`). Low Power Mode caps the frame rate.
 *   - the thermal state macOS reports (`pmset -g therm`)
 *   - the memory footprint of every Chromium process, GPU process included,
 *     as Activity Monitor shows it. The JS heap misses textures and canvases;
 *     this does not.
 *   - the precise JS heap from the DevTools protocol (Performance.getMetrics)
 *
 * The record goes to test/output/soak-<start>.json every minute, so a crash
 * keeps all but the last minute. At the end, or on Ctrl-C, the driver prints
 * the report from test/soak-analysis.mjs and writes it next to the JSON.
 *
 * It runs `caffeinate` for the length of the run. A display that sleeps stops
 * requestAnimationFrame, and the run then measures nothing.
 *
 * Do not use the machine during the run. The window must stay in front: an
 * unfocused window throttles frames, and the probe skips those frames rather
 * than count them (memory: FPS needs window focus). Turn off notifications.
 *
 * Options, all environment variables:
 *   MINUTES=60        length of the run
 *   ROTATE=60000      ms per mode; 0 holds the mode that is showing
 *   WINDOW=10         minutes per comparison window
 *   LIVE=1            real audio devices instead of WAV. The run stops unless
 *                     the app picks a DJ controller.
 *   WAV=broadband-124bpm.wav   fixture name or absolute path, when not LIVE
 *   REAL_FS=1         real fullscreen through the app's button
 *   WINDOW_AT=1512,0  open the window at this screen point (external display)
 *   MODES=rings,flow  rotate over these modes only. Default: all but custom.
 *                     A smoke run needs few modes, so its short windows share some.
 *
 * Physical state is not measurable from here. Record it by hand in the
 * results file: fan noise, case temperature, surface, room temperature. See
 * docs/hardware-checks/SOAK-TEMPLATE.md.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { analyze, toMarkdown } from './soak-analysis.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(HERE, 'output');
const PORT = 8126;

const MINUTES = Number(process.env.MINUTES || 60);
const ROTATE = Number(process.env.ROTATE ?? 60000);
const WINDOW = Number(process.env.WINDOW || 10);
const LIVE = process.env.LIVE === '1';
const WAV = process.env.WAV || 'broadband-124bpm.wav';
const REAL_FS = process.env.REAL_FS === '1';
const WINDOW_AT = process.env.WINDOW_AT;
const MODES = process.env.MODES ? process.env.MODES.split(',') : undefined;
const HOST_EVERY_MS = 60000;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
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

// ---- host readings ---------------------------------------------------------

async function sh(cmd, args) {
  try {
    return (await run(cmd, args)).stdout;
  } catch (_) {
    return '';
  }
}

async function power() {
  const out = await sh('pmset', ['-g', 'batt']);
  // Low Power Mode caps the frame rate. On 10/13 it halved Particles and
  // Rings from 59 to 29 FPS, with the battery at 20%. It can turn on by itself
  // on battery, so read it every minute rather than once.
  const lpm = (await sh('pmset', ['-g'])).match(/lowpowermode\s+(\d)/)?.[1];
  return {
    power: out.match(/drawing from '([^']+)'/)?.[1] ?? null,
    battery: out.match(/(\d+%;\s*[^;]+)/)?.[1]?.trim() ?? null,
    lowPowerMode: lpm == null ? null : lpm === '1'
  };
}

async function thermal() {
  const out = await sh('pmset', ['-g', 'therm']);
  // A Mac with no throttling event prints only "Note: No ... has been
  // recorded" lines. That is an answer, not a missing reading. Once macOS
  // records a warning, it prints the level instead (Intel also prints
  // CPU_Speed_Limit), and those lines are kept as they are.
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const values = lines.filter((l) => !/^Note: No .* recorded$/.test(l));
  return values.length ? values.join('; ') : 'none recorded';
}

const UNIT = { B: 1, K: 1024, M: 1048576, G: 1073741824 };

/**
 * Memory of every process the browser reports, GPU included, two ways.
 *
 * Footprint is what Activity Monitor calls Memory: it counts pages macOS has
 * compressed. Resident memory (RSS) does not. On the 10/13 hour run, macOS
 * compressed memory system-wide at minute 52, and every browser process's RSS
 * fell at once, the audio and network processes too. RSS read that as the app
 * freeing 320 MB, and hid a renderer that had climbed for 30 minutes before
 * it. The analysis judges footprint; RSS stays in the record for comparison.
 */
async function processMemory(browserCdp) {
  let pids;
  try {
    const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
    pids = processInfo.map((p) => ({ pid: p.id, type: p.type }));
  } catch (_) {
    return { rssBytes: null, footprintBytes: null };
  }
  const table = (out, parse) =>
    new Map(
      out
        .trim()
        .split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((c) => c.length >= 2)
        .map(([pid, v]) => [Number(pid), parse(v)])
    );
  const rss = table(
    await sh('ps', ['-o', 'pid=,rss=', '-p', pids.map((p) => p.pid).join(',')]),
    (v) => Number(v) * 1024
  );
  // top lists every process; one sample a minute is cheap. Values read like
  // "531M+" or "1.2G".
  const footprint = table(await sh('top', ['-l', '1', '-stats', 'pid,mem']), (v) => {
    const m = v.match(/^([\d.]+)([BKMG])/);
    return m ? Number(m[1]) * UNIT[m[2]] : null;
  });
  const sum = (map) => {
    const byType = {};
    let total = 0;
    for (const { pid, type } of pids) {
      const bytes = map.get(pid) || 0;
      byType[type] = (byType[type] || 0) + bytes;
      total += bytes;
    }
    return { total, byType };
  };
  const r = sum(rss);
  const f = sum(footprint);
  return {
    rssBytes: r.total,
    rssByType: r.byType,
    footprintBytes: f.total || null,
    footprintByType: f.byType
  };
}

async function pageHeap(cdp) {
  try {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (n) => metrics.find((m) => m.name === n)?.value ?? null;
    return { jsHeapUsed: get('JSHeapUsedSize'), nodes: get('Nodes') };
  } catch (_) {
    return { jsHeapUsed: null, nodes: null };
  }
}

// ---- run -------------------------------------------------------------------

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = join(OUT, `soak-${stamp}.json`);
const mdPath = join(OUT, `soak-${stamp}.md`);
await mkdir(OUT, { recursive: true });

const awake = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });
const server = await serve();
const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    ...(LIVE
      ? []
      : [
          '--use-fake-device-for-media-stream',
          `--use-file-for-fake-audio-capture=${WAV.startsWith('/') ? WAV : join(HERE, 'fixtures', WAV)}`
        ]),
    '--autoplay-policy=no-user-gesture-required',
    // Unrounded performance.memory, so the probe's heap series means something.
    '--enable-precise-memory-info',
    '--window-size=1920,1400',
    ...(WINDOW_AT ? [`--window-position=${WINDOW_AT}`] : [])
  ]
});

let page;
let finished = false;
async function finish(reason) {
  if (finished) return;
  finished = true;
  console.log(`\n[soak] finishing: ${reason}`);
  try {
    const state = await page.evaluate(() => soak.stop());
    await writeFile(
      jsonPath,
      JSON.stringify({ options: { MINUTES, ROTATE, WINDOW, LIVE, WAV, REAL_FS, MODES }, state })
    );
    const md = toMarkdown(analyze(state, { windowMin: WINDOW }));
    await writeFile(mdPath, md + '\n');
    console.log(`\n${md}\n`);
    console.log(`wrote test/output/soak-${stamp}.json and .md`);
  } catch (e) {
    console.error('[soak] could not read the final state:', e.message);
    console.error(`the last minute's snapshot is in test/output/soak-${stamp}.json`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
    awake.kill();
  }
}
process.on('SIGINT', () => finish('Ctrl-C').then(() => process.exit(0)));

try {
  const context = await browser.newContext({
    permissions: ['microphone'],
    ...(REAL_FS ? { viewport: null } : { viewport: { width: 1920, height: 1280 } })
  });
  page = await context.newPage();
  page.on('pageerror', (e) => console.warn('[page error]', String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer);
  await page.click('#flashWarningContinue');
  if (LIVE) {
    // A live run on the wrong input measures nothing useful (PHI-172).
    await page
      .waitForFunction(
        () => /^(Ready|No DJ)/.test(document.getElementById('deviceStatus')?.textContent || ''),
        null,
        { timeout: 15000 }
      )
      .catch(() => null);
    const device = await page.evaluate(
      () => document.getElementById('audioInputSelect').selectedOptions[0]?.textContent || ''
    );
    console.log(`live input: ${device}`);
    if (!device.startsWith('DJ ·')) throw new Error('no DJ controller selected');
  }
  await page.bringToFront();
  await page.click('#start');
  if (REAL_FS) {
    await page.click('#fullscreen');
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(3000);

  // A stale run in localStorage would make the probe resume it.
  await page.evaluate(() => localStorage.removeItem('hw.soak'));
  await page.addScriptTag({ content: await readFile(join(HERE, 'soak-probe.js'), 'utf8') });
  const options = await page.evaluate((o) => soak.start(o), { rotateMs: ROTATE, modes: MODES });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const browserCdp = await browser.newBrowserCDPSession();
  const renderer = await page.evaluate(() => {
    const c = document.querySelector('#p5-canvas canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  if (/swiftshader/i.test(renderer))
    console.warn('WARNING: software renderer; FPS is not indicative');
  console.log(
    `[soak] ${MINUTES} min, ${LIVE ? 'live input' : WAV}, ${REAL_FS ? 'fullscreen' : 'windowed'}, ` +
      `rotating every ${options.rotateMs / 1000} s over ${options.modes.length} modes, renderer ${renderer}`
  );
  console.log(`[soak] writing test/output/soak-${stamp}.json every minute. Ctrl-C ends early.`);

  const endAt = Date.now() + MINUTES * 60000;
  while (Date.now() < endAt && !finished) {
    const row = {
      ...(await power()),
      thermal: await thermal(),
      ...(await processMemory(browserCdp)),
      ...(await pageHeap(cdp))
    };
    await page.evaluate((r) => soak.recordHost(r), row);
    const state = await page.evaluate(() => soak.raw());
    await writeFile(
      jsonPath,
      JSON.stringify({
        options: { MINUTES, ROTATE, WINDOW, LIVE, WAV, REAL_FS, MODES },
        renderer,
        state
      })
    );
    const status = await page.evaluate(() => soak.status());
    console.log(
      `${status}, browser ${row.footprintBytes ? (row.footprintBytes / 1048576).toFixed(0) : '—'} MB, ${row.power ?? ''} ${row.battery ?? ''}${row.lowPowerMode ? ', LOW POWER MODE' : ''}`
    );
    await page.waitForTimeout(Math.min(HOST_EVERY_MS, Math.max(0, endAt - Date.now())));
  }
  await finish('time');
} catch (e) {
  console.error('[soak]', e.message);
  if (page) await finish(`error: ${e.message}`);
  else {
    await browser.close();
    server.close();
    awake.kill();
  }
  process.exitCode = 1;
}
