/**
 * Soak probe — PHI-178.
 *
 * A recorder for a long run: an hour or more, against real audio, with the
 * modes rotating the way an operator would rotate them. test/soak.mjs injects
 * it and drives the run. It can also be pasted into the console of the running
 * app. Either way, test/soak-analysis.mjs reads what it saves.
 *
 *   await import('http://localhost:8000/test/soak-probe.js')
 *   soak.start({ rotateMs: 60000 })   // rotate modes once a minute
 *   soak.status()                     // one line: elapsed, FPS, heap
 *   soak.stop()                       // ends the run; the app is restored
 *   soak.save()                       // download the JSON
 *   node test/soak-analysis.mjs soak-2026-10-13.json
 *
 * Why not test/hardware-probe.js? That probe keeps every frame, every band
 * sample, and every BPM reading. Over an hour that is about 216,000 frames:
 * past what localStorage holds, so a reload loses the FPS series. It also
 * grows the JS heap by tens of megabytes, and heap growth is one of the three
 * things a soak exists to measure. A recorder that leaks hides the leak it
 * looks for.
 *
 * So this probe keeps a fixed-size summary per 10-second bucket and nothing
 * else. An hour is 360 buckets, about 150 KB. Each bucket holds:
 *
 *   - an FPS histogram in whole-FPS bins. Histograms merge exactly, so a
 *     ten-minute p50 or p05 comes out right. Percentiles of percentiles do not.
 *   - a BPM histogram in 0.1-BPM bins, for the same reason.
 *   - mean bass, mid, and high.
 *   - the JS heap at the end of the bucket, and the DOM node count.
 *
 * It keeps the hardware probe's frame rules (PHI-171, PHI-176). A frame whose
 * interval spans a hidden tab or a lost focus is skipped, not measured. So is
 * any frame in the first SETTLE_MS after a mode switch: a switch rebuilds
 * arrays (initializeParticles, resetCollage), and that one-off cost is not
 * what a soak measures.
 *
 * Time is Date.now() from the start, not performance.now(). performance.now()
 * restarts on a reload, and this run must survive one. After a reload, inject
 * the probe again: it finds the stored run, resumes it, and records a
 * `resumed` mark. The analysis flags a resumed run, since a reload empties the
 * heap and breaks the memory series.
 */
(() => {
  if (window.soak) {
    console.warn('[soak] probe already installed');
    return;
  }
  if (typeof djApp === 'undefined') {
    console.error('[soak] djApp not found — load the app and press Start, then re-inject.');
    return;
  }

  const STORE_KEY = 'hw.soak';
  const BUCKET_MS = 10000;
  const SETTLE_MS = 1500;
  const MARK_EVERY_MS = 10 * 60 * 1000;
  const FPS_MAX_BIN = 240; // a 240 Hz panel; anything faster folds into the top bin

  const ap = () => djApp.audioProcessor;
  const vis = () => djApp.visualizer;
  const mode = () => vis()?.currentMode ?? null;

  // ---- state: a new run, or the stored one after a reload ----------------

  let state;
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (_) {
      return null;
    }
  })();
  const resuming = stored && !stored.stoppedAt;
  if (resuming) {
    state = stored;
  } else {
    state = {
      version: 1,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      stoppedAt: null,
      bucketMs: BUCKET_MS,
      options: null,
      env: null,
      marks: [],
      buckets: [],
      host: [],
      errors: []
    };
  }
  const now = () => Date.now() - state.startedAtMs;

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('[soak] could not persist:', e.message);
    }
  }
  window.addEventListener('beforeunload', persist);

  function mark(name) {
    const m = {
      name,
      at: now(),
      mode: mode(),
      fullscreen: !!document.fullscreenElement,
      focus: document.hasFocus()
    };
    state.marks.push(m);
    persist();
    console.log(`[soak] mark: ${name}`);
    return m;
  }

  // ---- the current bucket ----------------------------------------------

  const newBucket = () => ({
    at: now(),
    mode: mode(),
    fps: {}, // whole-FPS bin -> frame count
    bpm: {}, // BPM to 0.1 -> sample count
    bpmZero: 0,
    band: { bass: 0, mid: 0, high: 0, n: 0 },
    frames: 0,
    maxDt: 0,
    skippedHidden: 0,
    skippedUnfocused: 0,
    skippedSettle: 0
  });
  let bucket = newBucket();
  let lastSwitchAt = -Infinity;

  function flush() {
    const b = bucket;
    const mem = performance.memory;
    state.buckets.push({
      at: b.at,
      end: now(),
      mode: b.mode,
      fps: b.fps,
      bpm: b.bpm,
      bpmZero: b.bpmZero,
      bass: b.band.n ? +(b.band.bass / b.band.n).toFixed(3) : null,
      mid: b.band.n ? +(b.band.mid / b.band.n).toFixed(3) : null,
      high: b.band.n ? +(b.band.high / b.band.n).toFixed(3) : null,
      frames: b.frames,
      maxDt: +b.maxDt.toFixed(1),
      skippedHidden: b.skippedHidden,
      skippedUnfocused: b.skippedUnfocused,
      skippedSettle: b.skippedSettle,
      // Chrome rounds these unless it runs with --enable-precise-memory-info,
      // which test/soak.mjs passes. They are null outside Chrome.
      heapUsed: mem ? mem.usedJSHeapSize : null,
      heapTotal: mem ? mem.totalJSHeapSize : null,
      domNodes: document.getElementsByTagName('*').length,
      focus: document.hasFocus(),
      fullscreen: !!document.fullscreenElement,
      audioRunning: !!ap()?.isRunning
    });
    bucket = newBucket();
    persist();
  }

  // ---- samplers ---------------------------------------------------------

  // Frame timing wraps the visualizer's onFrame hook, as the hardware probe
  // does. app.js owns it for the FPS readout, so replacing it would kill the
  // readout.
  const priorOnFrame = vis().onFrame;
  let lastFrame = performance.now();
  let hiddenSince = document.hidden;
  let blurredSince = !document.hasFocus();
  const onVisibility = () => {
    if (document.hidden) hiddenSince = true;
  };
  const onBlur = () => {
    blurredSince = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);

  let running = false;
  vis().onFrame = function (...args) {
    const t = performance.now();
    const dt = t - lastFrame;
    lastFrame = t;
    if (running) {
      if (mode() !== bucket.mode) {
        // A switch the rotation did not make: the operator pressed a key.
        lastSwitchAt = now();
        flush();
      }
      if (document.hidden || hiddenSince) bucket.skippedHidden++;
      else if (!document.hasFocus() || blurredSince) bucket.skippedUnfocused++;
      else if (now() - lastSwitchAt < SETTLE_MS) bucket.skippedSettle++;
      else if (dt > 0) {
        const bin = Math.min(FPS_MAX_BIN, Math.floor(1000 / dt));
        bucket.fps[bin] = (bucket.fps[bin] || 0) + 1;
        bucket.frames++;
        if (dt > bucket.maxDt) bucket.maxDt = dt;
      }
    }
    hiddenSince = document.hidden;
    blurredSince = !document.hasFocus();
    if (typeof priorOnFrame === 'function') return priorOnFrame.apply(this, args);
  };

  const timers = [];
  const onError = (e) => {
    state.errors.push({ at: now(), message: e.message || String(e.reason || e) });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  function startSamplers() {
    timers.push(
      setInterval(() => {
        const a = ap();
        if (!a) return;
        bucket.band.bass += a.bass;
        bucket.band.mid += a.mid;
        bucket.band.high += a.high;
        bucket.band.n++;
      }, 100),
      setInterval(() => {
        const bpm = ap()?.bpm ?? 0;
        if (bpm > 0) {
          const k = bpm.toFixed(1);
          bucket.bpm[k] = (bucket.bpm[k] || 0) + 1;
        } else bucket.bpmZero++;
      }, 250),
      setInterval(flush, BUCKET_MS)
    );
    // Marks every ten minutes, counted from the start, so a resumed run keeps
    // the same grid.
    let nextMark = Math.ceil(now() / MARK_EVERY_MS) * MARK_EVERY_MS || MARK_EVERY_MS;
    timers.push(
      setInterval(() => {
        if (now() >= nextMark) {
          mark(`t+${Math.round(nextMark / 60000)}m`);
          nextMark += MARK_EVERY_MS;
        }
      }, 1000)
    );
  }

  // ---- mode rotation ----------------------------------------------------

  function rotationModes(include) {
    const all = [...document.getElementById('visualMode').options].map((o) => o.value);
    // Custom renders blank without an uploaded file, as in hw.sweep().
    return include?.length ? include : all.filter((m) => m !== 'custom');
  }

  function startRotation(rotateMs, modes) {
    if (!rotateMs) return;
    let i = Math.max(0, modes.indexOf(mode()));
    timers.push(
      setInterval(() => {
        i = (i + 1) % modes.length;
        lastSwitchAt = now();
        flush();
        djApp.switchVisualizationMode(modes[i]);
        bucket.mode = modes[i];
      }, rotateMs)
    );
  }

  // ---- api --------------------------------------------------------------

  const api = {
    /**
     * Starts sampling. rotateMs = 0 holds one mode; the default rotates once a
     * minute, so every ten-minute window sees every mode at least once and the
     * first and last windows compare mode for mode.
     */
    start(opts = {}) {
      if (running) return console.warn('[soak] already running');
      const { rotateMs = 60000, modes } = opts;
      const list = rotationModes(modes);
      if (!state.options) state.options = { rotateMs, modes: list };
      if (!state.env) {
        state.env = {
          userAgent: navigator.userAgent,
          screen: [screen.width, screen.height],
          viewport: [innerWidth, innerHeight],
          dpr: devicePixelRatio,
          sampleRate: ap()?.audioContext?.sampleRate ?? null,
          kickWorkletActive: !!ap()?.kickNode,
          input:
            document.getElementById('audioInputSelect')?.selectedOptions?.[0]?.textContent ?? null
        };
      }
      running = true;
      bucket = newBucket();
      mark(resuming && state.marks.length ? 'resumed' : 'start');
      startSamplers();
      startRotation(state.options.rotateMs, state.options.modes);
      return state.options;
    },

    /** Host readings from the driver (power, thermal, process memory). */
    recordHost(row) {
      state.host.push({ at: now(), ...row });
    },

    mark,

    status() {
      const b = state.buckets.at(-1);
      const mins = (now() / 60000).toFixed(1);
      const heap = b?.heapUsed ? `${(b.heapUsed / 1048576).toFixed(1)} MB` : '—';
      const line = `[soak] ${mins} min, ${state.buckets.length} buckets, last mode ${b?.mode ?? '—'}, heap ${heap}`;
      console.log(line);
      return line;
    },

    stop() {
      if (running) flush();
      running = false;
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      vis().onFrame = priorOnFrame;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      state.stoppedAt = new Date().toISOString();
      persist();
      console.log('[soak] stopped; app restored');
      return state;
    },

    raw: () => state,

    save() {
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `soak-${state.startedAt.slice(0, 10)}.json`;
      a.click();
    },

    /** Forget the stored run, so the next injection starts a new one. */
    clear() {
      localStorage.removeItem(STORE_KEY);
    }
  };

  window.soak = api;
  if (resuming) {
    console.warn(
      `[soak] resumed the run from ${state.startedAt} (${state.buckets.length} buckets). ` +
        'Run soak.start() to continue, or soak.clear() and reload for a new run.'
    );
  } else console.log('[soak] probe installed. Run: soak.start()');
})();
