/**
 * Hardware-check probe — PHI-171.
 *
 * A recorder for the "Hardware check before a show" run in CONTRIBUTING.md.
 * It is never loaded by index.html and never runs at showtime: it is pasted
 * into the console (or injected by a driver) once, against the running app.
 *
 * It exists because the two readings the checklist most depends on — BPM
 * stability and per-mode FPS — are the two a human cannot honestly take while
 * also working a mixer, and because "it looked fine" is not a check.
 *
 *   await import('http://localhost:8000/test/hardware-probe.js')
 *   await hw.init()      // device list, worklet status, mode list
 *   await hw.sweep()     // all ten modes, FPS per mode
 *   await hw.soloCheck() // step 4, self-paced, on-screen prompts
 *   hw.report()          // verdicts
 *   hw.save()            // download the raw JSON
 *
 * Four things here are scar tissue from the first run against a DDJ-REV1, and
 * each of them silently produced a wrong answer before it was fixed:
 *
 *  1. PERSISTENCE. The session lived in a page variable and a stray reload
 *     erased twenty minutes of hardware time. Every mark now snapshots to
 *     localStorage, and hw.restore() brings a run back after a reload.
 *  2. FOCUS. Chrome throttles rAF and timers in a window that is not frontmost.
 *     Measured that way, Spectrum Bars reads 25 FPS on a machine that does 60.
 *     Every frame records document.hasFocus(), and unfocused frames are
 *     excluded from FPS rather than averaged into it.
 *  3. KEY DISPATCH. app.js:50 switches on e.code ("Digit5"), not e.key, and its
 *     guard at line 44 calls e.target.matches(), which throws if the event is
 *     dispatched at `document`. Synthetic keys go to document.body with a code.
 *  4. SELF-PACING. A countdown the operator has to catch is a countdown the
 *     operator misses while walking to the mixer. Steps that need hands wait
 *     for a keypress instead.
 *
 * The band assertion reuses the threshold from test/verify-audio.mjs rather
 * than inventing a new one: a band dominates when it exceeds the next loudest
 * by 2.5x and clears a 0.05 floor. That is the point of step 4 — the same
 * assertion the tone tests make, run against the real signal chain.
 */
(() => {
  if (window.hw) { console.warn('[hw] probe already installed'); return; }
  if (typeof djApp === 'undefined') {
    console.error('[hw] djApp not found — load the app and press Start, then re-inject.');
    return;
  }

  const BAND_RATIO = 2.5;   // test/verify-audio.mjs:124
  const BAND_FLOOR = 0.05;  // test/verify-audio.mjs:123
  const FPS_FLOOR  = 30;    // p05, not mean: a stall is a tail event
  const STORE_KEY  = 'hw.hardware-check';

  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);

  const state = {
    startedAt: new Date().toISOString(),
    env: null, marks: [], bands: [], bpm: [], frames: [], errors: []
  };
  let currentMark = 'unmarked';

  const ap  = () => djApp.audioProcessor;
  const vis = () => djApp.visualizer;
  const mode = () => vis()?.currentMode ?? null;

  // ---- persistence: a hardware session must survive a reload -------------

  let saveTimer = null;
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      // Frames dominate the payload. Drop them before losing the run entirely.
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, frames: [] }));
        console.warn('[hw] storage full; persisted without raw frames');
      } catch (_) { console.error('[hw] could not persist:', e.message); }
    }
  }
  const schedulePersist = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 2000);
  };
  window.addEventListener('beforeunload', persist);

  // ---- environment ------------------------------------------------------

  async function captureEnv() {
    let raw = [];
    try {
      // Raw labels, BEFORE the app's cleanup regexes strip "Default - " and
      // rewrite built-in suffixes. Widening isDJDevice() needs the real string.
      raw = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
    } catch (e) {
      state.errors.push({ at: now(), mark: currentMark, message: `enumerateDevices: ${e.message}` });
    }

    let processed = [];
    try { processed = await ap().listInputs(); } catch (e) {
      state.errors.push({ at: now(), mark: currentMark, message: `listInputs: ${e.message}` });
    }

    const modeSelect = document.getElementById('visualMode');
    state.env = {
      userAgent: navigator.userAgent,
      sampleRate: ap()?.audioContext?.sampleRate ?? null,
      fftSize: ap()?.analyserNode?.fftSize ?? null,
      // The claim the ticket rests on. audioProcessor.js:499-527 falls back to
      // the render thread with only a console.warn, so a steady BPM readout is
      // NOT by itself evidence the worklet ran. This is. Note it reads null
      // until Start has been pressed — there is no AudioContext before that.
      kickWorkletActive: !!ap()?.kickNode,
      audioWorkletSupported: !!ap()?.audioContext?.audioWorklet,
      audioRunning: !!ap()?.isRunning,
      rawInputs: raw,
      processedInputs: processed.map((d, i) => ({
        position: i, label: d.label, isDJ: d.isDJ, isBuiltIn: d.isBuiltIn
      })),
      selectedOptionText: document.getElementById('audioInputSelect')
        ?.selectedOptions?.[0]?.textContent ?? null,
      modeOptions: modeSelect ? [...modeSelect.options].map(o => o.value) : [],
      display: {
        screen: [screen.width, screen.height],
        viewport: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio,
        fullscreen: !!document.fullscreenElement
      }
    };
    persist();
    return state.env;
  }

  // ---- samplers ---------------------------------------------------------

  const bandTimer = setInterval(() => {
    const a = ap(); if (!a) return;
    state.bands.push({ at: now(), mark: currentMark, bass: a.bass, mid: a.mid, high: a.high, rms: a.rms });
  }, 100);

  const bpmTimer = setInterval(() => {
    const a = ap(); if (!a) return;
    state.bpm.push({ at: now(), mark: currentMark, bpm: a.bpm, mode: mode() });
  }, 250);

  // Frame timing rides the visualizer's existing onFrame hook. app.js:107 owns
  // it for the FPS counter, so we wrap rather than replace — clobbering it
  // would silently kill the readout we are here to check.
  const priorOnFrame = vis().onFrame;
  let lastFrame = performance.now();
  vis().onFrame = function (...args) {
    const t = performance.now();
    state.frames.push({
      at: now(), mode: mode(), dt: t - lastFrame,
      focus: document.hasFocus(), vis: document.visibilityState
    });
    lastFrame = t;
    if (typeof priorOnFrame === 'function') return priorOnFrame.apply(this, args);
  };

  const onError = (e) => {
    state.errors.push({ at: now(), mark: currentMark, message: e.message || String(e.reason || e) });
    schedulePersist();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  // ---- statistics -------------------------------------------------------

  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const pct = (xs, p) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
  };

  /**
   * FPS from sustained focused runs only. The first 30 frames after focus is
   * regained are the compositor catching up, not the renderer's cost, and they
   * drag p05 from ~57 down to ~24 — a fake stall that reads like a real one.
   */
  function cleanFps(frames) {
    const kept = []; let run = [];
    for (const f of frames) {
      if (f.focus && f.dt > 0) run.push(f);
      else { if (run.length > 130) kept.push(...run.slice(30)); run = []; }
    }
    if (run.length > 130) kept.push(...run.slice(30));
    return kept.map(f => 1000 / f.dt);
  }

  function windowFrames(markName) {
    const i = state.marks.findIndex(m => m.name === markName);
    if (i < 0) return [];
    const from = state.marks[i].at;
    const to = state.marks[i + 1]?.at ?? Infinity;
    return state.frames.filter(f => f.at >= from && f.at < to);
  }

  /** Band dominance within a mark window, on verify-audio.mjs's threshold. */
  function bandVerdict(markName, expected) {
    const rows = state.bands.filter(r => r.mark === markName);
    if (!rows.length) return { mark: markName, error: 'no samples for this mark' };
    const m = {
      bass: mean(rows.map(r => r.bass)),
      mid: mean(rows.map(r => r.mid)),
      high: mean(rows.map(r => r.high))
    };
    const others = ['bass', 'mid', 'high'].filter(b => b !== expected);
    const top = m[expected];
    const next = Math.max(...others.map(b => m[b]));
    return {
      mark: markName, expected, samples: rows.length,
      means: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(3)])),
      ratio: +(next > 0 ? top / next : Infinity).toFixed(2),
      registers: top > BAND_FLOOR,
      dominates: top > next * BAND_RATIO,
      pass: top > BAND_FLOOR && top > next * BAND_RATIO
    };
  }

  function fpsByMode() {
    const out = {};
    for (const m of state.marks) {
      const fps = cleanFps(windowFrames(m.name));
      if (fps.length < 150) continue;                    // too little to trust
      const row = { mode: m.mode, samples: fps.length, p50: pct(fps, 50), p05: pct(fps, 5),
                    min: +Math.min(...fps).toFixed(1) };
      row.pass = row.p05 >= FPS_FLOOR;
      if (!out[m.mode] || row.samples > out[m.mode].samples) out[m.mode] = row;
    }
    return out;
  }

  function bpmSummary() {
    const live = state.bpm.filter(r => r.bpm > 0);
    const byMode = {};
    for (const r of live) (byMode[r.mode] ||= []).push(r.bpm);
    return {
      samples: live.length,
      firstNonZeroAt: live[0]?.at ?? null,
      median: pct(live.map(r => r.bpm), 50),
      p05: pct(live.map(r => r.bpm), 5),
      p95: pct(live.map(r => r.bpm), 95),
      byMode: Object.fromEntries(Object.entries(byMode).map(([k, v]) => [k, {
        samples: v.length, median: pct(v, 50), spread: +(Math.max(...v) - Math.min(...v)).toFixed(1)
      }]))
    };
  }

  // ---- on-screen operator cue ------------------------------------------

  function makeCue() {
    document.getElementById('hwCue')?.remove();
    const cue = document.createElement('div');
    cue.id = 'hwCue';
    cue.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;z-index:99999;background:rgba(0,0,0,.35);' +
      'font:700 clamp(30px,7vw,96px)/1.15 system-ui,sans-serif;color:#fff;' +
      'text-shadow:0 2px 24px #000,0 0 8px #000;text-align:center;gap:.35em';
    const line = document.createElement('div');
    const sub = document.createElement('div');
    const live = document.createElement('div');
    sub.style.cssText = 'font-size:.38em;opacity:.9;font-weight:500';
    live.style.cssText = 'font-size:.3em;opacity:.8;font-weight:500;font-variant-numeric:tabular-nums';
    cue.append(line, sub, live);
    document.body.appendChild(cue);

    const meter = setInterval(() => {
      const a = ap();
      live.textContent = `bass ${a.bass.toFixed(2)}   mid ${a.mid.toFixed(2)}   high ${a.high.toFixed(2)}`;
    }, 100);

    return {
      show: (a, b) => { line.textContent = a; sub.textContent = b ?? ''; },
      // SPACE is the app's transport (CONTRIBUTING.md:43). preventDefault is not
      // enough: the app listens in the bubble phase, so the press would still
      // stop the audio mid-measurement. Capture and stop it dead.
      wait: (label, subtext) => new Promise(res => {
        line.textContent = label; sub.textContent = subtext;
        const go = (e) => {
          if (e.type === 'keydown') {
            if (e.code !== 'Space') return;
            e.preventDefault(); e.stopImmediatePropagation();
          }
          document.removeEventListener('keydown', go, true);
          cue.removeEventListener('click', go, true);
          res();
        };
        document.addEventListener('keydown', go, true);
        cue.addEventListener('click', go, true);
      }),
      hold: async (label, markName, secs) => {
        hwApi.mark(markName);
        for (let i = secs; i > 0; i--) {
          line.textContent = label; sub.textContent = i;
          await new Promise(r => setTimeout(r, 1000));
        }
      },
      done: async (msg, subtext, ms = 5000) => {
        line.textContent = msg; sub.textContent = subtext ?? '';
        clearInterval(meter);
        await new Promise(r => setTimeout(r, ms));
        cue.remove();
      }
    };
  }

  const hwApi = {
    async init() { const e = await captureEnv(); console.table(e.processedInputs); return e; },

    mark(name) {
      currentMark = name;
      const m = {
        name, at: now(), mode: mode(),
        reduceFlash: !!document.getElementById('reduceFlash')?.checked,
        fullscreen: !!document.fullscreenElement,
        focus: document.hasFocus()
      };
      state.marks.push(m);
      persist();
      console.log(`[hw] mark: ${name}`, m);
      return m;
    },

    /** Step 6: every mode, via the real key handler, dwelling on each. */
    async sweep(dwellMs = 9000) {
      const codes = ['Digit1','Digit2','Digit3','Digit4','Digit5',
                     'Digit6','Digit7','Digit8','Digit9','Digit0'];
      for (const code of codes) {
        // document.body, not document: app.js:44 calls e.target.matches().
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        this.mark(`mode-${code}-${mode()}`);
        await new Promise(r => setTimeout(r, dwellMs));
      }
      this.mark('sweep-complete');
      console.log('[hw] sweep complete');
      return fpsByMode();
    },

    /** Step 4: self-paced, because a countdown is a thing to miss. */
    async soloCheck(holdSecs = 18) {
      const cue = makeCue();
      await cue.wait('READY?', 'press SPACE when you are at the mixer');
      await cue.wait('ISOLATE THE BASS', 'kill the other channels on the master, then press SPACE');
      await cue.hold('HOLD BASS ONLY', 'solo-bass', holdSecs);
      await cue.wait('NOW ISOLATE THE HATS', 'kill the bass, then press SPACE');
      await cue.hold('HOLD HATS ONLY', 'solo-hats', holdSecs);
      this.mark('solo-done');
      await cue.done('DONE', 'restore the full mix');
      return { bass: bandVerdict('solo-bass', 'bass'), hats: bandVerdict('solo-hats', 'high') };
    },

    /** Step 8: beat-accent energy with Reduce flash off, then on. */
    async flashCheck(secs = 12) {
      const box = document.getElementById('reduceFlash');
      const cue = makeCue();
      const peak = () => vis().flashIntensity;
      box.checked = false; box.dispatchEvent(new Event('change'));
      await cue.hold('REDUCE FLASH: OFF', 'flash-off', secs);
      const off = peak();
      box.checked = true; box.dispatchEvent(new Event('change'));
      await cue.hold('REDUCE FLASH: ON', 'flash-on', secs);
      const on = peak();
      this.mark('flash-done');
      await cue.done('DONE', '', 2000);
      return { flashIntensityOff: off, flashIntensityOn: on, damped: on < off };
    },

    bandVerdict, fpsByMode, bpmSummary,

    report() {
      const r = {
        env: state.env, marks: state.marks.map(m => m.name),
        fpsByMode: fpsByMode(), bpm: bpmSummary(),
        solo: { bass: bandVerdict('solo-bass', 'bass'), hats: bandVerdict('solo-hats', 'high') },
        errors: state.errors,
        counts: { bands: state.bands.length, bpm: state.bpm.length, frames: state.frames.length }
      };
      console.log(JSON.stringify(r, null, 2));
      return r;
    },

    raw: () => state,
    persist,

    /** Bring back a run that a reload would otherwise have erased. */
    restore() {
      const prior = localStorage.getItem(STORE_KEY);
      if (!prior) { console.warn('[hw] nothing stored'); return null; }
      const p = JSON.parse(prior);
      console.log(`[hw] stored run ${p.startedAt}: ${p.marks.length} marks, ` +
                  `${p.bands.length} band samples, ${p.frames.length} frames`);
      return p;
    },

    stop() {
      clearInterval(bandTimer); clearInterval(bpmTimer);
      vis().onFrame = priorOnFrame;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
      persist();
      console.log('[hw] stopped; app restored');
    },

    save() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hardware-check-${state.startedAt.slice(0, 10)}.json`;
      a.click();
    }
  };

  window.hw = hwApi;
  console.log('[hw] probe installed. Run: await hw.init()');
})();
