/* Checks test/soak-analysis.mjs against synthetic runs — PHI-178.
 *
 * A soak takes an hour of hardware time, so its verdicts must be right the
 * first time. Each case below builds a run whose answer is known, then asserts
 * the analysis gives that answer:
 *
 *   healthy      flat FPS, flat memory, steady BPM: every check passes
 *   thermal      FPS slides from 60 to 40 over the hour: FPS fails
 *   leak         JS heap climbs from 30 to 60 MB: heap fails, "rose every window"
 *   bpm drift    the estimator wobbles at the end: BPM fails
 *   short        20 minutes: duration fails
 *   dropout      two minutes of silence: the report names the stretch
 *   switch       a mode switch flushes a bucket with no band samples: not silence
 *   stub         a run that ends 0.1 s past a window edge: the stub is not judged
 *
 *   node test/verify-soak.mjs
 */

import { analyze, toMarkdown } from './soak-analysis.mjs';

const MODES = ['particles', 'rings', 'galaxy'];
const BUCKET = 10000;

function makeRun({
  minutes = 60,
  fps = () => 60,
  heapMB = () => 30,
  jitter = () => 0.2,
  silent = () => false
} = {}) {
  const buckets = [];
  for (let at = 0; at < minutes * 60000; at += BUCKET) {
    const t = at / (minutes * 60000); // 0 at the start, 1 at the end
    const f = Math.round(fps(t));
    const j = jitter(t);
    const bpm = {};
    for (let i = 0; i < 40; i++) {
      const k = (124 + ((i % 5) - 2) * (j / 4)).toFixed(1);
      bpm[k] = (bpm[k] || 0) + 1;
    }
    const quiet = silent(at);
    buckets.push({
      at,
      end: at + BUCKET,
      mode: MODES[Math.floor(at / 60000) % MODES.length],
      fps: { [f]: 570, [f - 2]: 30 },
      bpm: quiet ? {} : bpm,
      bpmZero: quiet ? 40 : 0,
      bass: quiet ? 0 : 0.4,
      mid: quiet ? 0 : 0.3,
      high: quiet ? 0 : 0.2,
      frames: 600,
      maxDt: 20,
      skippedHidden: 0,
      skippedUnfocused: 0,
      skippedSettle: 0,
      heapUsed: heapMB(t) * 1048576,
      heapTotal: 64 * 1048576,
      domNodes: 120
    });
  }
  const host = [];
  for (let at = 0; at < minutes * 60000; at += 60000)
    host.push({ at, rssBytes: 900 * 1048576, power: 'AC Power', battery: '100%; charged' });
  return {
    startedAt: '2026-10-13T00:00:00.000Z',
    options: { rotateMs: 60000, modes: MODES },
    marks: [{ name: 'start', at: 0 }],
    buckets,
    host,
    errors: []
  };
}

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

{
  const r = analyze(makeRun());
  const v = r.verdicts;
  check('healthy: duration passes', v.duration.pass === true, `${v.duration.minutes} min`);
  check('healthy: FPS passes for all three modes', v.fps.pass === true && v.fps.rows.length === 3);
  check('healthy: p50 reads 60', r.first.fps.p50 === 60, `p50 ${r.first.fps.p50}`);
  // 30 of 600 frames at 58 is exactly 5%, so p05 lands on the 60 bin.
  check('healthy: p05 reads 60', r.first.fps.p05 === 60, `p05 ${r.first.fps.p05}`);
  check('healthy: heap passes', v.heap.pass === true && v.heap.growth === 0);
  check('healthy: browser memory passes', v.processMemory.pass === true);
  check('healthy: BPM passes', v.bpm.pass === true, `jitter ${v.bpm.first.jitter}`);
  check('healthy: no silence noted', r.silence.length === 0);
  check('healthy: report renders', toMarkdown(r).includes('| FPS within 10% | PASS'));
}

{
  const r = analyze(makeRun({ fps: (t) => 60 - 20 * t }));
  const worst = Math.min(...r.verdicts.fps.rows.map((x) => x.p50Change));
  check('thermal: FPS fails', r.verdicts.fps.pass === false, `worst p50 change ${worst}%`);
  check('thermal: heap still passes', r.verdicts.heap.pass === true);
}

{
  // 8% over the hour is inside the 10% limit: a heap that settles must pass.
  const r = analyze(makeRun({ heapMB: (t) => 30 + 2.4 * Math.min(1, t * 3) }));
  check(
    'settling heap: passes',
    r.verdicts.heap.pass === true,
    `growth ${r.verdicts.heap.growth}%`
  );
}

{
  // 15% of a small heap, but only 3 MB: noise, not a leak.
  const r = analyze(makeRun({ heapMB: (t) => 20 + 5 * t }));
  check(
    'small heap rise: passes',
    r.verdicts.heap.pass === true,
    `growth ${r.verdicts.heap.growth}%`
  );
}

{
  const r = analyze(makeRun({ heapMB: (t) => 30 + 30 * t }));
  check('leak: heap fails', r.verdicts.heap.pass === false, `growth ${r.verdicts.heap.growth}%`);
  check('leak: rose every window', r.verdicts.heap.monotonic === true);
  check('leak: report says so', toMarkdown(r).includes('rose every window'));
}

{
  const r = analyze(makeRun({ jitter: (t) => (t > 0.8 ? 6 : 0.2) }));
  check(
    'bpm drift: BPM fails',
    r.verdicts.bpm.pass === false,
    `jitter ${r.verdicts.bpm.first.jitter} -> ${r.verdicts.bpm.last.jitter}`
  );
}

{
  const r = analyze(makeRun({ minutes: 20 }));
  check('short: duration fails', r.verdicts.duration.pass === false);
}

{
  const r = analyze(makeRun({ silent: (at) => at >= 30 * 60000 && at < 32 * 60000 }));
  check(
    'dropout: one stretch, 120 s at 30 min',
    r.silence.length === 1 && r.silence[0].seconds === 120 && r.silence[0].fromMin === 30,
    JSON.stringify(r.silence)
  );
  check(
    'dropout: report names PHI-181',
    r.notes.some((n) => n.includes('PHI-181'))
  );
}

{
  // The 10/13 smoke run reported a "silence" at every mode switch.
  const run = makeRun();
  const b = run.buckets[6];
  run.buckets.splice(7, 0, { ...b, at: b.end, end: b.end + 5, bass: null, mid: null, high: null });
  check('switch: an empty bucket is not silence', analyze(run).silence.length === 0);
}

{
  // The 10/14 leak test ended 0.1 s past the 5-minute edge, and its two-sample
  // stub window, caught mid-sawtooth, failed the heap check.
  const run = makeRun();
  const b = run.buckets.at(-1);
  run.buckets.push({ ...b, at: b.end, end: b.end + 100, heapUsed: 60 * 1048576 });
  const r = analyze(run);
  check(
    'stub: trailing stub window is dropped',
    r.series.heap.length === 6,
    `${r.series.heap.length} windows`
  );
  check('stub: heap still passes', r.verdicts.heap.pass === true);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
