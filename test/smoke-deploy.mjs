/* Does the deployed app actually load?
 *
 * "Deployment has completed" is not the same claim, and the difference has
 * already cost this project two pull requests. Vendoring p5 added a file the
 * host's config did not know to publish; the deploy reported success and every
 * check went green while the site served `p5 is not defined` to anyone who
 * visited. Nothing in CI was asking the only question that mattered.
 *
 * This asks it. Given a base URL it loads the page, finds every script and
 * stylesheet the page actually references, and fetches each one — asserting it
 * comes back as the kind of file it is supposed to be. The specific failure it
 * was written for is a host returning `index.html` with a 200 for a missing
 * script, which the browser reports as `Unexpected token '<'`; a status check
 * alone sails straight past that.
 *
 * It reads the asset list out of the page rather than hard-coding paths, so
 * adding a file cannot silently escape the check — the same enumerate-versus-
 * describe lesson that caused the original bug. It does this for two pages: the
 * live app at `/` and the student sandbox at `/sandbox/`.
 *
 *   node test/smoke-deploy.mjs                       # the live site
 *   node test/smoke-deploy.mjs https://some-preview   # a deploy preview
 */

import { readdir } from 'node:fs/promises';

const BASE = (
  process.argv[2] ||
  process.env.SMOKE_URL ||
  'https://dj-visualizer.netlify.app'
).replace(/\/$/, '');
const TIMEOUT = 20000;

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    const body = await res.text();
    return {
      url,
      status: res.status,
      type: res.headers.get('content-type') || '',
      csp: res.headers.get('content-security-policy') || '',
      cors: res.headers.get('access-control-allow-origin') || '',
      body
    };
  } catch (error) {
    return { url, status: 0, type: '', body: '', error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Smoke-testing ${BASE}\n`);

/* Every page whose assets have to survive a deploy. The sandbox is the second
   one because each workshop station opens a CodePen that loads the sandbox's
   five files from this host, cross-origin. Nothing on the home page references
   sandbox.css or sandbox/engine.js, so before this root existed a `.js` served
   as `text/html` would break twelve laptops at once and every check here would
   still pass. */
const ROOTS = [
  { path: '/', marker: 'id="p5-canvas"', label: 'the visualizer' },
  { path: '/sandbox/', marker: '<dj-visualizer', label: 'the student sandbox' }
];

/* Every asset the pages actually reference. Read from the markup, never from a
   hard-coded list — a list would go stale exactly when a new file is added,
   which is the circumstance that broke the deploy in the first place. */
const assets = [];
const seen = new Set();

for (const root of ROOTS) {
  const page = await get(root.path);
  check(`${root.path} returns 200`, page.status === 200, page.error || `status ${page.status}`);
  check(`${root.path} is HTML`, /text\/html/i.test(page.type), page.type || 'no content-type');
  check(
    `${root.path} is ${root.label}`,
    page.body.includes(root.marker),
    page.body.includes('<title>') ? page.body.match(/<title>([^<]*)</)?.[1] : 'no title'
  );

  if (page.status !== 200) {
    console.log(`\n${root.path} did not load; skipping its asset checks.`);
    continue;
  }

  const found = [
    ...[...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => ({
      path: m[1],
      kind: 'js'
    })),
    ...[...page.body.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map(
      (m) => ({ path: m[1], kind: 'css' })
    )
  ];

  check(`${root.path} references assets`, found.length > 0, `${found.length} found`);

  // The sandbox writes its paths relative to /sandbox/, so `../app/x.js` has to
  // resolve against the page that names it. Resolving here also means the two
  // pages' shared files are fetched once, under one name.
  for (const asset of found) {
    const href = new URL(asset.path, `${BASE}${root.path}`).pathname;
    if (seen.has(href)) continue;
    seen.add(href);
    assets.push({ path: href, kind: asset.kind });
  }
}

const EXPECT = {
  js: { pattern: /javascript|ecmascript/i, label: 'JavaScript' },
  css: { pattern: /text\/css/i, label: 'CSS' }
};

for (const asset of assets) {
  const href = asset.path;
  const res = await get(href);
  const expect = EXPECT[asset.kind];

  check(`${href} returns 200`, res.status === 200, res.error || `status ${res.status}`);

  // The load-bearing assertion. A host with a catch-all rewrite answers a
  // missing asset with index.html and a 200, so status alone looks healthy
  // while the browser gets HTML where it wanted a script.
  const isHtml = /^\s*<(!doctype|html)/i.test(res.body);
  check(
    `${href} is not an HTML fallback`,
    !isHtml,
    isHtml ? 'served index.html — asset is missing from the deploy' : 'real content'
  );

  check(
    `${href} is served as ${expect.label}`,
    expect.pattern.test(res.type),
    res.type || 'no content-type'
  );
  check(`${href} is not empty`, res.body.length > 200, `${res.body.length} bytes`);
}

/* A path that should not exist must 404. If it returns 200 the host is
   rewriting everything to the page, which is what disguises a missing asset as
   a working one. */
const missing = await get('/this-path-should-not-exist-smoke-check.js');
check(
  'missing paths 404 rather than returning the page',
  missing.status === 404,
  `status ${missing.status}`
);

/* PHI-222. p5's loadImage calls fetch() on every image before it decodes it,
   and an uploaded file is a blob: URL. fetch() answers to connect-src, not
   img-src, so a CSP whose connect-src omits blob: turns every upload into
   "Failed to load" while the same code works on a local server with no CSP.
   The 08/21 header change did exactly that, a week before the 08/28 practice
   session where the GIF station failed. */
const home = await get('/');
const connectSrc = (home.csp.match(/connect-src([^;]*)/) || [])[1] || '';
check(
  'the CSP lets p5 fetch an uploaded file (connect-src allows blob:)',
  !home.csp || /(^|\s)blob:(\s|$)/.test(connectSrc),
  home.csp ? `connect-src${connectSrc}` : 'no CSP header'
);

/* The GIF library. The pen loads these from CodePen, another origin, and p5
   fetches in CORS mode, so each one needs Access-Control-Allow-Origin. The list
   comes from the gifs/ folder on disk, not from this file, so a new GIF cannot
   escape the check. */
const gifDir = new URL('../gifs/', import.meta.url);
const gifs = (await readdir(gifDir)).filter((name) => name.endsWith('.gif'));
check('the GIF library is not empty', gifs.length > 0, `${gifs.length} found`);
for (const name of gifs) {
  const res = await get(`/gifs/${name}`);
  check(`/gifs/${name} returns 200`, res.status === 200, res.error || `status ${res.status}`);
  check(`/gifs/${name} is a GIF`, /image\/gif/i.test(res.type), res.type || 'no content-type');
  check(`/gifs/${name} can be read from CodePen`, res.cors === '*', res.cors || 'no CORS header');
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
  process.exit(1);
}
