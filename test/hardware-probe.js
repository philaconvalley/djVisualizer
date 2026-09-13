// Hardware performance probe. Not part of the app bundle — loaded on demand
// from the browser console during a live hardware check:
//
//   const hw = await import('http://localhost:8000/test/hardware-probe.js');
//   await hw.init();
//   const results = await hw.sweep();
//   console.log(hw.toMarkdownTable(results));
//
// Run this against real audio (Start already clicked, controller playing
// music) and leave the browser tab frontmost and untouched for the whole
// sweep — see PHI-174 and CONTRIBUTING.md's "Hardware check before a show".
// After typing the sweep command, click the page itself: focus left in
// DevTools throttles the page, and the probe skips those frames.
//
// This is a classic script's global `djApp` (declared with `let` in
// app/app.js) referenced from a module. That works because a page's global
// lexical environment is shared between classic scripts and dynamically
// imported modules in the same realm — no export/import wiring needed on
// the app side.

const DEFAULT_WINDOW_MS = 5000;

let sampler = null;

// A frame is excluded from the FPS calculation if the tab was hidden, or the
// window was unfocused, at any point since the previous frame. Two traps:
//
// - Hidden: Chrome stops calling requestAnimationFrame entirely, so the first
//   frame back would otherwise record the whole hidden stretch as one interval
//   (a 2 s alt-tab becomes one 0.5 FPS sample and drags p05 down).
// - Unfocused: an unfocused Chrome window throttles to ~25 FPS while
//   document.hidden stays false. Typing hw.sweep() into undocked DevTools
//   unfocuses the page, and the throttled number looks exactly like a real
//   stall.
//
// The sampler stores intervals, not timestamps. After any skipped frame it
// forgets the previous timestamp, so no interval ever spans a gap.
function createSampler() {
  const state = {
    active: false,
    mode: null,
    intervals: [],
    prevTime: null,
    wasHidden: false,
    wasUnfocused: false,
    skippedHidden: 0,
    skippedUnfocused: 0,
  };

  const onVisibilityChange = () => {
    if (document.hidden) state.wasHidden = true;
  };
  const onBlur = () => {
    state.wasUnfocused = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onBlur);

  return {
    state,
    onFrame() {
      if (!state.active) return;
      const now = performance.now();
      const hidden = document.hidden || state.wasHidden;
      const unfocused = !document.hasFocus() || state.wasUnfocused;
      if (hidden || unfocused) {
        if (hidden) state.skippedHidden++;
        else state.skippedUnfocused++;
        state.wasHidden = document.hidden;
        state.wasUnfocused = !document.hasFocus();
        // Break the chain: the next good frame has no previous timestamp.
        state.prevTime = null;
        return;
      }
      if (state.prevTime !== null) state.intervals.push(now - state.prevTime);
      state.prevTime = now;
    },
    startWindow(mode) {
      state.mode = mode;
      state.intervals = [];
      state.prevTime = null;
      state.wasHidden = document.hidden;
      state.wasUnfocused = !document.hasFocus();
      state.skippedHidden = 0;
      state.skippedUnfocused = 0;
      state.active = true;
    },
    stopWindow() {
      state.active = false;
      return {
        intervals: state.intervals.slice(),
        skippedHidden: state.skippedHidden,
        skippedUnfocused: state.skippedUnfocused,
      };
    },
    destroy() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    },
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

// Converts frame intervals into per-frame instantaneous FPS values, then
// reduces to p50/p05. p05 (the 5th percentile — the bad end of the
// distribution, not the top) is what PHI-174's Definition of Done gates on,
// because a mode that is smooth 95% of the time and stutters hard for the
// rest still reads badly to someone watching it.
function summarize({ intervals, skippedHidden, skippedUnfocused }) {
  const fpsValues = intervals.filter((dt) => dt > 0).map((dt) => 1000 / dt);
  fpsValues.sort((a, b) => a - b);
  const skipped = skippedHidden + skippedUnfocused;
  return {
    samples: fpsValues.length,
    p50: fpsValues.length ? Math.round(percentile(fpsValues, 50) * 10) / 10 : null,
    p05: fpsValues.length ? Math.round(percentile(fpsValues, 5) * 10) / 10 : null,
    skippedHidden,
    skippedUnfocused,
    clean: skipped === 0,
  };
}

export async function init() {
  if (typeof djApp === 'undefined' || !djApp || !djApp.visualizer) {
    throw new Error('djApp is not ready. Load the app and click Start before init().');
  }
  if (sampler) sampler.destroy();
  sampler = createSampler();

  // Chain onto any onFrame already wired (updateFPS), rather than replace it.
  const previousOnFrame = djApp.visualizer.onFrame;
  djApp.visualizer.onFrame = () => {
    if (previousOnFrame) previousOnFrame();
    sampler.onFrame();
  };

  return { ready: true, modes: getModeList() };
}

function getModeList() {
  const select = document.getElementById('visualMode');
  if (!select) throw new Error('#visualMode not found — is the app loaded?');
  return Array.from(select.options).map((o) => o.value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sweeps every mode in dropdown order (the same order keys 1-9/0 map to),
// holding each for windowMs and reporting p50/p05 FPS. Skips 'custom' by
// default since it renders blank without an uploaded file and would report
// a meaningless number — pass includeCustom: true if media is loaded.
export async function sweep({ windowMs = DEFAULT_WINDOW_MS, includeCustom = false } = {}) {
  if (!sampler) throw new Error('Call hw.init() first.');
  const modes = getModeList().filter((m) => includeCustom || m !== 'custom');
  const results = {};

  for (const mode of modes) {
    djApp.switchVisualizationMode(mode);
    // Let the mode settle (particle re-init, collage reset) before sampling.
    await wait(300);
    sampler.startWindow(mode);
    await wait(windowMs);
    results[mode] = summarize(sampler.stopWindow());
    if (!results[mode].clean) {
      console.warn(
        `[hardware-probe] ${mode}: skipped ${results[mode].skippedHidden} hidden and ` +
          `${results[mode].skippedUnfocused} unfocused frames. Click the page and keep it ` +
          'focused, then re-run the sweep before recording this mode.'
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    surface: { width: window.screen.width, height: window.screen.height, devicePixelRatio: window.devicePixelRatio },
    windowMs,
    results,
  };
}

export function toMarkdownTable(sweepResult) {
  const lines = [
    `Surface: ${sweepResult.surface.width}x${sweepResult.surface.height} @ ${sweepResult.surface.devicePixelRatio}x — ${sweepResult.timestamp}`,
    '',
    '| Mode | p50 FPS | p05 FPS | Samples | Skipped (hidden/unfocused) |',
    '|------|---------|---------|---------|----------------------------|',
  ];
  for (const [mode, r] of Object.entries(sweepResult.results)) {
    const skipped = r.clean ? '0' : `${r.skippedHidden}/${r.skippedUnfocused} — re-run`;
    lines.push(`| ${mode} | ${r.p50 ?? '—'} | ${r.p05 ?? '—'} | ${r.samples} | ${skipped} |`);
  }
  return lines.join('\n');
}
