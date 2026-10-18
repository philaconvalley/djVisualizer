/* Proves the ?modes= show list. PHI-271.
 *
 * The 10/16 soak found three modes that lose the most frame rate over an hour
 * (PHI-267). A show list keeps them off the number keys for a set. That is only
 * worth anything if nothing can reach a mode the list left out, so this checks
 * the keys, the dropdown, the help panel, and code that asks for a mode by name.
 *
 *   node test/verify-show-list.mjs
 *
 * No audio is needed. Nothing here reads the stage, only which mode it is in.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = 8126;
const BASE = `http://127.0.0.1:${PORT}`;
const ALL = [
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

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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

const server = await serve();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });

// One page per URL. Returns a reader for the state that matters, plus the
// warnings and errors the page logged.
async function open(query) {
  const page = await browser.newPage();
  const warnings = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning' && !m.text().includes('GL Driver')) warnings.push(m.text());
  });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof djApp !== 'undefined' && !!djApp.visualizer?.p5Instance);
  if (await page.locator('#flashWarning[open]').count()) await page.click('#flashWarningContinue');

  const state = () =>
    page.evaluate(() => ({
      options: [...document.getElementById('visualMode').options].map((o) => o.value),
      select: document.getElementById('visualMode').value,
      mode: djApp.visualizer.currentMode,
      mediaHidden: document.getElementById('customMediaSection').hidden,
      helpKeys: document.getElementById('helpModeKeys').textContent.trim(),
      helpAction: document.getElementById('helpModeAction').textContent.trim()
    }));

  // The mode each key leaves the app in, pressed with the stage focused.
  const press = async (keys) => {
    const seen = [];
    for (const key of keys) {
      await page.keyboard.press(key);
      seen.push((await state()).mode);
    }
    return seen;
  };

  return { page, state, press, warnings, errors };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  {
    const app = await open('');
    const s = await app.state();
    check('no parameter: all ten modes, in dropdown order', same(s.options, ALL));
    check('no parameter: help panel unchanged', s.helpKeys === '1–9, 0', s.helpKeys);
    const seen = await app.press(['Digit2', 'Digit0', 'Digit1']);
    check(
      'no parameter: keys unchanged',
      same(seen, ['particles', 'flow', 'spectrum']),
      seen.join()
    );
    check('no parameter: no warnings or errors', !app.warnings.length && !app.errors.length);
    await app.page.close();
  }

  {
    const app = await open('?modes=spectrum,waves,mandala,flow');
    const s = await app.state();
    check(
      'show list: dropdown lists only those modes',
      same(s.options, ['spectrum', 'waves', 'mandala', 'flow'])
    );
    check('show list: help panel names the keys left', s.helpKeys === '1–4', s.helpKeys);
    check('show list: help panel names the count', s.helpAction.includes('4 modes'), s.helpAction);
    const seen = await app.press(['Digit2', 'Digit4', 'Digit5', 'Digit7', 'Digit0', 'Digit1']);
    check(
      'show list: keys renumber from 1, and keys past the list do nothing',
      same(seen, ['waves', 'flow', 'flow', 'flow', 'flow', 'spectrum']),
      seen.join()
    );

    await app.page.evaluate(() => djApp.switchVisualizationMode('galaxy'));
    const after = await app.state();
    check(
      'show list: code asking for a left-out mode does not empty the stage',
      after.mode === 'spectrum' && after.select === 'spectrum',
      `mode "${after.mode}", select "${after.select}"`
    );
    check(
      'show list: that request logs a warning',
      app.warnings.some((w) => w.includes('galaxy'))
    );
    check('show list: no errors', !app.errors.length, app.errors.join(' | '));
    await app.page.close();
  }

  {
    const app = await open('?modes=Flow, custom,bogus,flow');
    const s = await app.state();
    check(
      'messy list: order kept, case and spaces ignored, repeat dropped',
      same(s.options, ['flow', 'custom'])
    );
    check(
      'messy list: stage starts on the first listed mode',
      s.mode === 'flow' && s.select === 'flow'
    );
    check(
      'messy list: unknown name logs a warning',
      app.warnings.some((w) => w.includes('bogus'))
    );
    await app.page.close();
  }

  {
    const app = await open('?modes=custom,flow');
    const s = await app.state();
    check('custom first: upload control shows at start', s.mode === 'custom' && !s.mediaHidden);
    await app.page.close();
  }

  {
    const app = await open('?modes=galaxy');
    const s = await app.state();
    check('one mode: help panel reads one key', s.helpKeys === '1', s.helpKeys);
    check('one mode: stage starts on it', s.mode === 'galaxy');
    await app.page.close();
  }

  for (const query of ['?modes=bogus', '?modes=', '?modes=,,']) {
    const app = await open(query);
    const s = await app.state();
    check(`${query}: falls back to all ten modes`, same(s.options, ALL) && s.mode === 'spectrum');
    await app.page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
