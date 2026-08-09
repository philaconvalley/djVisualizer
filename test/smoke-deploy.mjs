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
 * describe lesson that caused the original bug.
 *
 *   node test/smoke-deploy.mjs                       # the live site
 *   node test/smoke-deploy.mjs https://some-preview   # a deploy preview
 */

const BASE = (process.argv[2] || process.env.SMOKE_URL || 'https://dj-visualizer.netlify.app')
  .replace(/\/$/, '');
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
    return { url, status: res.status, type: res.headers.get('content-type') || '', body };
  } catch (error) {
    return { url, status: 0, type: '', body: '', error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Smoke-testing ${BASE}\n`);

/* The page itself. */
const page = await get('/');
check('page returns 200', page.status === 200, page.error || `status ${page.status}`);
check('page is HTML', /text\/html/i.test(page.type), page.type || 'no content-type');
check('page is the visualizer', page.body.includes('id="p5-canvas"'),
  page.body.includes('<title>') ? page.body.match(/<title>([^<]*)</)?.[1] : 'no title');

if (page.status !== 200) {
  console.log('\nPage did not load; skipping asset checks.');
  process.exit(1);
}

/* Every asset the page actually references. Read from the markup, never from a
   hard-coded list — a list would go stale exactly when a new file is added,
   which is the circumstance that broke the deploy in the first place. */
const assets = [
  ...[...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => ({ path: m[1], kind: 'js' })),
  ...[...page.body.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
    .map(m => ({ path: m[1], kind: 'css' }))
];

check('page references assets', assets.length > 0, `${assets.length} found`);

const EXPECT = {
  js: { pattern: /javascript|ecmascript/i, label: 'JavaScript' },
  css: { pattern: /text\/css/i, label: 'CSS' }
};

for (const asset of assets) {
  const href = asset.path.startsWith('/') ? asset.path : `/${asset.path}`;
  const res = await get(href);
  const expect = EXPECT[asset.kind];

  check(`${href} returns 200`, res.status === 200, res.error || `status ${res.status}`);

  // The load-bearing assertion. A host with a catch-all rewrite answers a
  // missing asset with index.html and a 200, so status alone looks healthy
  // while the browser gets HTML where it wanted a script.
  const isHtml = /^\s*<(!doctype|html)/i.test(res.body);
  check(`${href} is not an HTML fallback`, !isHtml,
    isHtml ? 'served index.html — asset is missing from the deploy' : 'real content');

  check(`${href} is served as ${expect.label}`, expect.pattern.test(res.type),
    res.type || 'no content-type');
  check(`${href} is not empty`, res.body.length > 200, `${res.body.length} bytes`);
}

/* A path that should not exist must 404. If it returns 200 the host is
   rewriting everything to the page, which is what disguises a missing asset as
   a working one. */
const missing = await get('/this-path-should-not-exist-smoke-check.js');
check('missing paths 404 rather than returning the page', missing.status === 404,
  `status ${missing.status}`);

const failed = results.filter(r => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
  process.exit(1);
}
