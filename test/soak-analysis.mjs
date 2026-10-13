/* Soak analysis — PHI-178.
 *
 * Reads a run that test/soak-probe.js recorded, and answers the ticket's
 * questions by comparing the first ten minutes against the last ten:
 *
 *   1. FPS. Per mode, p50 and p05 in the last window must be within 10% of the
 *      first. Per mode, because the rotation puts different modes in each
 *      window, and Spectrum at 27 FPS against Galaxy at 60 is not a slide.
 *   2. Memory. Split into ten-minute windows. JS heap, DOM nodes, and (from the
 *      driver) the browser's process memory must stop growing: the last
 *      window within 10% of the second window. The first window is warm-up, so
 *      it is not the baseline. The heap is judged on its lowest value per
 *      window (the floor after garbage collection); the others on the median.
 *   3. BPM. The BPM spread inside a 10-second bucket ("jitter") must be no
 *      worse at the end than at the start. Jitter, not the whole-window range,
 *      because the music changes tempo between tracks and the estimator is
 *      right to follow it.
 *   4. Duration: 60 minutes or more.
 *
 * Band levels and the host's power and thermal readings are reported, not
 * judged. They depend on the music and the room.
 *
 *   node test/soak-analysis.mjs test/output/soak-2026-10-13T23-00-00-000Z.json
 *   node test/soak-analysis.mjs run.json --window 5    # five-minute windows
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
  minMinutes: 60,
  fpsDrop: 0.1, // last window may be at most 10% below the first
  memGrowth: 0.1, // last window at most 10% over the second window
  // ...unless the rise is this small anyway. 10% of a 20 MB heap is 2 MB,
  // which a 3-minute smoke run moved by noise alone (10/13).
  heapSlackBytes: 4 * 1048576,
  minFramesPerMode: 300, // a mode with fewer frames in a window is not compared
  bpmJitterSlack: 1, // BPM; the estimator rounds to whole BPM (audioProcessor.js)
  bpmJitterRatio: 1.25,
  bpmZeroSlack: 0.05 // fraction of samples with no BPM
};

// ---- histogram helpers -----------------------------------------------------

function merge(hists) {
  const out = new Map();
  for (const h of hists)
    for (const [k, n] of Object.entries(h)) out.set(+k, (out.get(+k) || 0) + n);
  return out;
}

/** Same index rule as hardware-probe.js's pct(): s[floor(p/100 * n)]. */
function pctOf(hist, p) {
  const bins = [...hist.entries()].sort((a, b) => a[0] - b[0]);
  const total = bins.reduce((t, [, n]) => t + n, 0);
  if (!total) return null;
  const target = Math.min(total - 1, Math.floor((p / 100) * total));
  let seen = 0;
  for (const [v, n] of bins) {
    seen += n;
    if (seen > target) return v;
  }
  return bins.at(-1)[0];
}

const countOf = (hist) => [...hist.values()].reduce((t, n) => t + n, 0);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const mean = (xs) => {
  const s = xs.filter((x) => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
};
const round = (x, d = 1) => (x == null ? null : +x.toFixed(d));
const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);

// ---- windows ---------------------------------------------------------------

function fpsSummary(buckets) {
  const hist = merge(buckets.map((b) => b.fps));
  const frames = countOf(hist);
  let slow = 0;
  for (const [v, n] of hist) if (v < 30) slow += n;
  return {
    frames,
    p50: pctOf(hist, 50),
    p05: pctOf(hist, 5),
    slowPer1000: frames ? round((slow * 1000) / frames) : null
  };
}

function bpmSummary(buckets) {
  const hist = merge(buckets.map((b) => b.bpm));
  const live = countOf(hist);
  const zero = buckets.reduce((t, b) => t + b.bpmZero, 0);
  // Per-bucket spread, then the median over buckets: the estimator's wobble
  // inside ten seconds, which a tempo change between tracks barely touches.
  const jitter = median(
    buckets
      .map((b) => merge([b.bpm]))
      .filter((h) => countOf(h) >= 10)
      .map((h) => pctOf(h, 95) - pctOf(h, 5))
  );
  return {
    samples: live,
    median: pctOf(hist, 50),
    p05: pctOf(hist, 5),
    p95: pctOf(hist, 95),
    jitter: round(jitter),
    zeroFraction: live + zero ? round(zero / (live + zero), 3) : null
  };
}

function windowSummary(buckets) {
  const byMode = {};
  for (const m of new Set(buckets.map((b) => b.mode)))
    byMode[m] = fpsSummary(buckets.filter((b) => b.mode === m));
  return {
    buckets: buckets.length,
    fps: fpsSummary(buckets),
    byMode,
    bpm: bpmSummary(buckets),
    bands: {
      bass: round(mean(buckets.map((b) => b.bass)), 3),
      mid: round(mean(buckets.map((b) => b.mid)), 3),
      high: round(mean(buckets.map((b) => b.high)), 3)
    },
    skipped: {
      hidden: buckets.reduce((t, b) => t + b.skippedHidden, 0),
      unfocused: buckets.reduce((t, b) => t + b.skippedUnfocused, 0)
    }
  };
}

/** Median of a value per window, over the whole run. */
function series(rows, windowMs, durationMs, pick, reduce = median) {
  const out = [];
  for (let from = 0; from < durationMs; from += windowMs) {
    const vals = rows.filter((r) => r.at >= from && r.at < from + windowMs).map(pick);
    out.push({ fromMin: from / 60000, median: reduce(vals) });
  }
  return out;
}

/** The lowest value in a window. For the heap, that is the floor after GC. */
const floor = (xs) => {
  const s = xs.filter((x) => x != null);
  return s.length ? Math.min(...s) : null;
};

function memVerdict(points, slack = 0) {
  const vals = points.map((p) => p.median).filter((v) => v != null);
  if (vals.length < 3) return { pass: null, reason: 'fewer than three windows with data' };
  const baseline = vals[1]; // the first window is warm-up
  const last = vals.at(-1);
  const growth = ratio(last - baseline, baseline);
  const monotonic = vals.slice(1).every((v, i) => i === 0 || v > vals[i]);
  return {
    pass: growth <= LIMITS.memGrowth || last - baseline <= slack,
    growth: round(growth * 100),
    monotonic,
    baseline,
    last
  };
}

// ---- the analysis ----------------------------------------------------------

export function analyze(state, { windowMin = 10 } = {}) {
  const windowMs = windowMin * 60000;
  const buckets = state.buckets || [];
  const durationMs = buckets.length ? buckets.at(-1).end : 0;
  const first = buckets.filter((b) => b.at < windowMs);
  const last = buckets.filter((b) => b.end > durationMs - windowMs);
  const w1 = windowSummary(first);
  const w2 = windowSummary(last);
  const notes = [];
  if (durationMs < 2 * windowMs)
    notes.push('The first and last windows overlap: the run is short.');
  const resumed = (state.marks || []).filter((m) => m.name === 'resumed').length;
  if (resumed)
    notes.push(
      `The page reloaded ${resumed} time(s). A reload empties the JS heap, so the heap series is not continuous.`
    );

  // Silence. The DDJ-REV1 has dropped off the USB bus mid-session (PHI-181);
  // on the stage that is a run of buckets with no level at all.
  // A bucket with no band samples is unknown, not silent: a mode switch
  // flushes one that is a few milliseconds long.
  const silent = buckets.filter(
    (b) => b.bass != null && b.bass + (b.mid ?? 0) + (b.high ?? 0) < 0.01
  );
  const stretches = [];
  for (const b of silent) {
    const prev = stretches.at(-1);
    if (prev && b.at - prev.end < 1000) prev.end = b.end;
    else stretches.push({ at: b.at, end: b.end });
  }
  const silence = stretches.map((s) => ({
    fromMin: round(s.at / 60000),
    seconds: Math.round((s.end - s.at) / 1000)
  }));
  if (silence.length)
    notes.push(
      `Silent stretches: ${silence.map((s) => `${s.seconds} s at ${s.fromMin} min`).join(', ')}. ` +
        'Check whether the controller dropped off the USB bus (PHI-181) or the music stopped.'
    );

  // FPS, mode for mode.
  const modes = Object.keys(w1.byMode).filter(
    (m) =>
      w2.byMode[m] &&
      w1.byMode[m].frames >= LIMITS.minFramesPerMode &&
      w2.byMode[m].frames >= LIMITS.minFramesPerMode
  );
  const fpsRows = modes.map((m) => {
    const a = w1.byMode[m];
    const b = w2.byMode[m];
    const p50Change = ratio(b.p50 - a.p50, a.p50);
    const p05Change = ratio(b.p05 - a.p05, a.p05);
    return {
      mode: m,
      first: a,
      last: b,
      p50Change: round(p50Change * 100),
      p05Change: round(p05Change * 100),
      pass: p50Change >= -LIMITS.fpsDrop && p05Change >= -LIMITS.fpsDrop
    };
  });
  if (!fpsRows.length) notes.push('No mode had enough frames in both windows to compare.');
  const lpmOn = (state.host || []).filter((h) => h.lowPowerMode);
  if (lpmOn.length)
    notes.push(
      `Low Power Mode was on for ${lpmOn.length} of ${state.host.length} host readings, ` +
        `first at ${round(lpmOn[0].at / 60000)} min. It caps the frame rate, so an FPS drop after it turned on is not thermal.`
    );

  // Memory.
  // The heap is a sawtooth: garbage piles up until the collector runs. A
  // median follows the teeth. A leak raises the floor, so judge the floor.
  const heap = series(buckets, windowMs, durationMs, (b) => b.heapUsed, floor);
  const dom = series(buckets, windowMs, durationMs, (b) => b.domNodes);
  const host = state.host || [];
  const rss = series(host, windowMs, durationMs, (h) => h.rssBytes ?? null);
  const cdpHeap = series(host, windowMs, durationMs, (h) => h.jsHeapUsed ?? null);

  // BPM.
  const bpmPass =
    w1.bpm.jitter == null || w2.bpm.jitter == null
      ? null
      : w2.bpm.jitter <= w1.bpm.jitter * LIMITS.bpmJitterRatio + LIMITS.bpmJitterSlack &&
        (w2.bpm.zeroFraction ?? 0) <= (w1.bpm.zeroFraction ?? 0) + LIMITS.bpmZeroSlack;

  const verdicts = {
    duration: { pass: durationMs >= LIMITS.minMinutes * 60000, minutes: round(durationMs / 60000) },
    fps: { pass: fpsRows.length ? fpsRows.every((r) => r.pass) : null, rows: fpsRows },
    heap: memVerdict(heap, LIMITS.heapSlackBytes),
    domNodes: memVerdict(dom),
    processMemory: memVerdict(rss),
    bpm: { pass: bpmPass, first: w1.bpm, last: w2.bpm }
  };

  return {
    startedAt: state.startedAt,
    env: state.env,
    options: state.options,
    durationMin: round(durationMs / 60000),
    windowMin,
    first: w1,
    last: w2,
    series: { heap, dom, rss, cdpHeap },
    host: {
      first: host[0] ?? null,
      last: host.at(-1) ?? null
    },
    errors: state.errors || [],
    silence,
    notes,
    verdicts
  };
}

// ---- report ----------------------------------------------------------------

const mb = (b) => (b == null ? '—' : (b / 1048576).toFixed(1));
const yes = (v) => (v == null ? 'n/a' : v ? 'PASS' : 'FAIL');
const pc = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export function toMarkdown(r) {
  const v = r.verdicts;
  const L = [];
  L.push(`Run ${r.startedAt}, ${r.durationMin} min, ${r.windowMin}-minute windows.`);
  if (r.options)
    L.push(`Rotation: every ${r.options.rotateMs / 1000} s over ${r.options.modes.join(', ')}.`);
  L.push('');
  L.push('| Check | Result | Detail |');
  L.push('|---|---|---|');
  L.push(`| Duration 60+ min | ${yes(v.duration.pass)} | ${v.duration.minutes} min |`);
  const worst = v.fps.rows.reduce((w, x) => (w && w.p05Change < x.p05Change ? w : x), null);
  L.push(
    `| FPS within 10% | ${yes(v.fps.pass)} | ${worst ? `worst p05 change: ${worst.mode} ${pc(worst.p05Change)}` : 'no comparable modes'} |`
  );
  const memRow = (name, m, fmt) =>
    `| ${name} plateaus | ${yes(m.pass)} | ${m.pass == null ? m.reason : `${fmt(m.baseline)} -> ${fmt(m.last)} (${pc(m.growth)})${m.monotonic && !m.pass ? ', rose every window' : ''}`} |`;
  L.push(memRow('JS heap floor (MB)', v.heap, mb));
  L.push(memRow('DOM nodes', v.domNodes, (x) => x));
  L.push(memRow('Browser memory (MB)', v.processMemory, mb));
  L.push(
    `| BPM no worse | ${yes(v.bpm.pass)} | jitter ${v.bpm.first.jitter ?? '—'} -> ${v.bpm.last.jitter ?? '—'} BPM, no-BPM ${v.bpm.first.zeroFraction ?? '—'} -> ${v.bpm.last.zeroFraction ?? '—'} |`
  );
  L.push('');
  L.push('FPS per mode, first window against last:');
  L.push('');
  L.push(
    '| Mode | p50 first | p50 last | p50 change | p05 first | p05 last | p05 change | Slow /1000 first | Slow /1000 last | Result |'
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const x of v.fps.rows) {
    L.push(
      `| ${x.mode} | ${x.first.p50} | ${x.last.p50} | ${pc(x.p50Change)} | ${x.first.p05} | ${x.last.p05} | ${pc(x.p05Change)} | ${x.first.slowPer1000} | ${x.last.slowPer1000} | ${yes(x.pass)} |`
    );
  }
  L.push('');
  L.push('Memory per window:');
  L.push('');
  L.push('| From (min) | JS heap floor MB | DOM nodes (median) | Browser memory MB (median) |');
  L.push('|---|---|---|---|');
  r.series.heap.forEach((h, i) => {
    L.push(
      `| ${h.fromMin} | ${mb(h.median)} | ${r.series.dom[i]?.median ?? '—'} | ${mb(r.series.rss[i]?.median)} |`
    );
  });
  L.push('');
  L.push('| | First window | Last window |');
  L.push('|---|---|---|');
  L.push(
    `| FPS p50 / p05 (all modes) | ${r.first.fps.p50} / ${r.first.fps.p05} | ${r.last.fps.p50} / ${r.last.fps.p05} |`
  );
  L.push(
    `| BPM median (p05-p95) | ${r.first.bpm.median} (${r.first.bpm.p05}-${r.first.bpm.p95}) | ${r.last.bpm.median} (${r.last.bpm.p05}-${r.last.bpm.p95}) |`
  );
  L.push(
    `| Bands bass / mid / high | ${r.first.bands.bass} / ${r.first.bands.mid} / ${r.first.bands.high} | ${r.last.bands.bass} / ${r.last.bands.mid} / ${r.last.bands.high} |`
  );
  L.push(
    `| Frames skipped (hidden / unfocused) | ${r.first.skipped.hidden} / ${r.first.skipped.unfocused} | ${r.last.skipped.hidden} / ${r.last.skipped.unfocused} |`
  );
  if (r.host.first || r.host.last) {
    const lpm = (x) =>
      x.lowPowerMode == null ? '' : `, Low Power Mode ${x.lowPowerMode ? 'ON' : 'off'}`;
    const h = (x) =>
      x
        ? `${x.power ?? '—'}, battery ${x.battery ?? '—'}${lpm(x)}, thermal: ${x.thermal ?? '—'}`
        : '—';
    L.push(`| Host | ${h(r.host.first)} | ${h(r.host.last)} |`);
  }
  L.push('');
  L.push(`Page errors: ${r.errors.length}${r.errors[0] ? ` (first: ${r.errors[0].message})` : ''}`);
  for (const n of r.notes) L.push(`\nNote: ${n}`);
  return L.join('\n');
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node test/soak-analysis.mjs <soak.json> [--window <minutes>]');
    process.exit(2);
  }
  const wi = process.argv.indexOf('--window');
  const windowMin = wi > 0 ? Number(process.argv[wi + 1]) : 10;
  const raw = JSON.parse(await readFile(file, 'utf8'));
  // The driver's file wraps the probe's state; a downloaded one is the state.
  console.log(toMarkdown(analyze(raw.state ?? raw, { windowMin })));
}
