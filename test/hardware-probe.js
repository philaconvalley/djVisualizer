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
//
// This is a classic script's global `djApp` (declared with `let` in
// app/app.js) referenced from a module. That works because a page's global
// lexical environment is shared between classic scripts and dynamically
// imported modules in the same realm — no export/import wiring needed on
// the app side.

const DEFAULT_WINDOW_MS = 5000;

let sampler = null;

// A frame is excluded from the FPS calculation if the tab was hidden at any
// point since the previous sample. A naive requestAnimationFrame-driven
// sampler keeps ticking while backgrounded (at a throttled rate on most
// browsers), which would silently understate the real drop this probe
// exists to catch.
function createSampler() {
  const state = {
    active: false,
    mode: null,
    frameTimes: [],
    lastWasHidden: false,
  };

  const onVisibilityChange = () => {
    if (document.hidden) state.lastWasHidden = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    state,
    onFrame() {
      if (!state.active) return;
      const now = performance.now();
      if (document.hidden || state.lastWasHidden) {
        // Skip this sample; the next one starts a clean window.
        state.lastWasHidden = document.hidden;
        return;
      }
      state.frameTimes.push(now);
    },
    startWindow(mode) {
      state.mode = mode;
      state.frameTimes = [];
      state.lastWasHidden = document.hidden;
      state.active = true;
    },
    stopWindow() {
      state.active = false;
      return state.frameTimes.slice();
    },
    destroy() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

// Converts a series of frame timestamps into per-frame instantaneous FPS
// values, then reduces to p50/p05. p05 (the 5th percentile — the bad end of
// the distribution, not the top) is what PHI-174's Definition of Done gates
// on, because a mode that is smooth 95% of the time and stutters hard for
// the rest still reads badly to someone watching it.
function summarize(frameTimes) {
  if (frameTimes.length < 2) {
    return { samples: frameTimes.length, p50: null, p05: null };
  }
  const fpsValues = [];
  for (let i = 1; i < frameTimes.length; i++) {
    const dt = frameTimes[i] - frameTimes[i - 1];
    if (dt > 0) fpsValues.push(1000 / dt);
  }
  fpsValues.sort((a, b) => a - b);
  return {
    samples: fpsValues.length,
    p50: Math.round(percentile(fpsValues, 50) * 10) / 10,
    p05: Math.round(percentile(fpsValues, 5) * 10) / 10,
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
    const frameTimes = sampler.stopWindow();
    results[mode] = summarize(frameTimes);
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
    '| Mode | p50 FPS | p05 FPS | Samples |',
    '|------|---------|---------|---------|',
  ];
  for (const [mode, r] of Object.entries(sweepResult.results)) {
    lines.push(`| ${mode} | ${r.p50 ?? '—'} | ${r.p05 ?? '—'} | ${r.samples} |`);
  }
  return lines.join('\n');
}
