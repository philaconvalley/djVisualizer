/* DJ Visualizer — the stage.
 *
 * Every mode in app/modes/ obeys one grammar, described in DESIGN.md under
 * "The stage grammar". The short version, because it is the thing that was
 * missing and it has to be legible from the code alone:
 *
 *   1. Colour comes from the CSS band tokens. The stage and the rail read from
 *      one source, so a brand kit swap moves both. Nothing on the stage is
 *      saturated unless it is a band.
 *   2. Light, not ink. Emissive elements draw as stacked passes — wide and
 *      faint under tight and bright — which is what a shader would do if the
 *      zero-build constraint allowed one.
 *   3. One response law. Every mode reads levels through level(), so all ten
 *      react to the same music with the same sensitivity.
 *   4. Honest silence. No mode fabricates motion with sin(time) when there is
 *      no signal. Silence is one shared slow breath, identical everywhere.
 *   5. Musical time. Motion is driven by beat phase, not wall clock, so the
 *      stage moves in the music's tempo.
 *   6. The composition lives above the rail. The console never covers content.
 */

import { BANDS } from './audioProcessor.js';
import { FlashGuard, FlashMeter } from './flashGuard.js';
import { MODES } from './modes/index.js';

class DJVisualizer {
  constructor() {
    this.p5Instance = null;
    this.audioData = {
      rms: 0,
      bass: 0,
      mid: 0,
      high: 0,
      spectrum: [],
      bpm: 0,
      binHz: 0
    };
    this.w = 0;
    this.h = 0;
    // Composition box: the canvas minus the rail. Modes compose inside this.
    this.vw = 0;
    this.vh = 0;
    this.railH = 0;

    // The registry, by id. Each mode is a file in app/modes/; the visualizer
    // only knows the contract written in app/modes/index.js. PHI-163.
    this.modes = new Map(MODES.map((mode) => [mode.id, mode]));
    this.currentMode = MODES[0].id;
    // The active mode's own state, from its setup(), and the mode it belongs
    // to. Rebuilt lazily on the next frame whenever this.memoryFor is cleared,
    // which also covers callers that set currentMode directly.
    this.memory = null;
    this.memoryFor = null;
    this.time = 0;
    this.isRunning = false;

    // Beat state. `beat` is a 0..1 envelope struck by a real beat event and
    // decayed on wall time, so it behaves the same at 30fps and 144fps.
    this.beat = 0;
    this.beatDecay = 0.34; // seconds to near-zero
    this.phase = 0; // beat phase, 0..1, re-anchored on every beat
    this.beatPeriod = 0.5; // seconds per beat; 120 BPM until told otherwise

    // Multiplier on every flash and pulse consumer. Photosensitivity is a
    // product requirement, not a preference: WCAG 2.3.1.
    this.flashIntensity = 1;

    // Reduced motion: a separate render path, not a dimmer version of this
    // one. No beat strikes, a frozen beat phase, and band levels that glide
    // over seconds instead of tracking every hit. See setReducedMotion().
    this.reducedMotion = false;
    this.smoothed = null;
    this.lastAudioAt = 0;

    // The last stage of the render path. See app/flashGuard.js. PHI-265.
    this.flashGuard = new FlashGuard();
    this.flashSampler = null;
    // Measurement only, for proving the ceiling holds. Load with ?flashlog.
    this.flashMeter = new URLSearchParams(location.search).has('flashlog')
      ? new FlashMeter()
      : null;

    // Custom uploaded media state (image/gif/video)
    this.customMedia = null;
    this.customMediaType = null; // 'image' | 'video'
    this.customMediaURL = null;

    // A mode with clearsBackground: false (Polygon Collage) accumulates rather
    // than clearing, so it gets its own 2D canvas layered beneath the WEBGL
    // one. Accumulating in the WEBGL framebuffer would fight its per-frame
    // clear, and compositing a 2D buffer through p5's image() meant
    // re-uploading a full-screen texture to the GPU sixty times a second — for
    // paint that changes a few times a bar.
    this.collageCanvas = null;
    this.collageCtx = null;
    this.collageLayer = null;

    // Filled from the CSS band tokens at init. Declared here only so the shape
    // is visible; the values are never hard-coded.
    this.colors = { bass: [255, 255, 255], mid: [255, 255, 255], high: [255, 255, 255] };

    // Everything a mode may read, and nothing else. The fields are copied in
    // once a frame by refreshStage(), into this one object, so a frame
    // allocates nothing. The contract is documented in app/modes/index.js.
    this.stage = {
      colors: this.colors,
      band: (name) => this.band(name),
      level: (value) => this.level(value),
      bandAt: (hz) => this.bandAt(hz),
      idle: 0,
      audio: this.audioData,
      beat: 0,
      phase: 0,
      beatPeriod: 0.5,
      time: 0,
      w: 0,
      h: 0,
      vw: 0,
      vh: 0,
      railH: 0,
      layer: null,
      media: null
    };
  }

  /* ---------------------------------------------------------------- setup */

  init() {
    this.readPalette();

    // Frequency band displays in the rail
    this.bassFill = document.querySelector('.bass-fill');
    this.midFill = document.querySelector('.mid-fill');
    this.highFill = document.querySelector('.high-fill');

    this.visualModeSelect = document.getElementById('visualMode');
    this.visualModeSelect.addEventListener('change', (e) => {
      const previousMode = this.currentMode;
      this.currentMode = e.target.value;

      // Upload controls only exist when the mode can use them.
      const mediaSection = document.getElementById('customMediaSection');
      if (mediaSection) mediaSection.hidden = !this.activeMode().usesMedia;

      this.onModeChange(previousMode);
    });

    // Custom media upload (image/gif/video)
    this.customMediaInput = document.getElementById('customMediaUpload');
    this.customMediaStatus = document.getElementById('customMediaStatus');
    if (this.customMediaInput) {
      this.customMediaInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.loadCustomMedia(file);
      });
    }

    this.p5Instance = new p5((p) => {
      p.setup = () => {
        this.measureStage();
        p.pixelDensity(this.computeDensity(p));
        const canvas = p.createCanvas(this.w, this.h, p.WEBGL);
        canvas.parent('p5-canvas');
        p.frameRate(60);
        p.noStroke();
        this.memoryFor = null;
        this.resetCollage();
      };

      p.windowResized = () => {
        this.measureStage();
        p.pixelDensity(this.computeDensity(p));
        p.resizeCanvas(this.w, this.h);
        // Mode state is laid out for the old size, so the next frame rebuilds it.
        this.memoryFor = null;
        this.resetCollage();
      };

      p.draw = () => this.draw(p);
    });
  }

  // A laptop panel and a projector both report the same native density from
  // the OS, but a projector-sized surface at that density is far more pixels
  // than the display can resolve. Cap the backing store at a fixed pixel
  // budget and let density fall off smoothly with area, so a laptop stays at
  // full density and a fullscreen projector surface drops toward 1 instead
  // of paying for detail nothing can show. See PHI-174.
  computeDensity(p) {
    const MAX_BACKING_PIXELS = 6_000_000;
    if (!this.w || !this.h) return 1;
    const native = p.displayDensity ? p.displayDensity() : 1;
    const byBudget = Math.sqrt(MAX_BACKING_PIXELS / (this.w * this.h));
    return Math.max(1, Math.min(native, byBudget));
  }

  // The band hues are tokens, and the stage is not allowed a second opinion
  // about them. Reading the computed value keeps one source of truth across
  // the rail and the canvas — DESIGN.md's contract — and makes a future brand
  // kit a token change rather than a code change.
  readPalette() {
    const styles = getComputedStyle(document.documentElement);
    for (const name of ['bass', 'mid', 'high']) {
      const parsed = DJVisualizer.parseColor(styles.getPropertyValue(`--${name}`));
      if (parsed) this.colors[name] = parsed;
    }
  }

  static parseColor(value) {
    const text = (value || '').trim();
    const hex = text.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1].split(',').map((v) => parseFloat(v));
      if (parts.length >= 3 && parts.every((v) => !isNaN(v))) return parts.slice(0, 3);
    }
    return null;
  }

  measureStage() {
    const container = document.querySelector('.stage');
    this.w = Math.max(1, container.clientWidth);
    this.h = Math.max(1, container.clientHeight);
    this.applySafeArea();
  }

  // The console is always visible by standing constraint, so the composition
  // box is the canvas minus the rail. Modes never place anything they care
  // about below this — the canvas still runs full bleed underneath.
  applySafeArea() {
    this.vw = this.w;
    this.vh = Math.max(120, this.h - this.railH);
  }

  setRailHeight(px) {
    this.railH = Math.max(0, px || 0);
    this.applySafeArea();
  }

  // The mode that draws. An id with no mode behind it falls back to Floating
  // Particles, as the old switch statement's default did, so a bad value can
  // never leave the stage with nothing to draw.
  activeMode() {
    return this.modes.get(this.currentMode) || this.modes.get('particles') || MODES[0];
  }

  onModeChange(previousMode) {
    this.memoryFor = null;
    this.resetCollage();

    // An uploaded video plays only while a mode that shows it is up.
    if (this.customMediaType === 'video' && this.customMedia) {
      if (this.activeMode().usesMedia) this.customMedia.loop();
      else if (this.modes.get(previousMode)?.usesMedia) this.customMedia.pause();
    }
  }

  ensureCollage() {
    if (this.collageCanvas) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'collage-canvas';
    const stage = document.querySelector('.stage');
    // Behind the WEBGL canvas, which runs transparent while a layered mode is up.
    stage.insertBefore(canvas, stage.firstChild);
    this.collageCanvas = canvas;
    this.collageCtx = canvas.getContext('2d');
    // What a clearsBackground: false mode receives as stage.layer.
    this.collageLayer = { canvas, ctx: this.collageCtx };
  }

  resetCollage() {
    this.ensureCollage();
    const w = Math.max(1, this.w);
    const h = Math.max(1, this.h);
    // Assigning width/height also clears the canvas, which is what we want on
    // both a resize and a mode switch — stale paint must not survive either.
    this.collageCanvas.width = w;
    this.collageCanvas.height = h;
  }

  setCollageVisible(visible) {
    if (this.collageCanvas) this.collageCanvas.hidden = !visible;
  }

  /* ----------------------------------------------------------- audio state */

  updateAudioData(data) {
    if (data.bpm > 0) this.beatPeriod = 60 / data.bpm;
    if (!this.reducedMotion) {
      this.audioData = { ...data };
      return;
    }

    // Reduced motion: every level glides toward the music with a time
    // constant of about 1.5 seconds, so a kick or a hi-hat run moves the stage
    // as a slow swell, never as a hit. Smoothing the data rather than each
    // mode means all ten modes take the calm path with no per-mode rule to
    // forget.
    const now = performance.now();
    const dt = this.lastAudioAt ? Math.min(0.25, (now - this.lastAudioAt) / 1000) : 0;
    this.lastAudioAt = now;
    const k = 1 - Math.exp(-dt / 1.5);

    const spectrum = data.spectrum || [];
    if (!this.smoothed || this.smoothed.spectrum.length !== spectrum.length) {
      this.smoothed = {
        bass: data.bass,
        mid: data.mid,
        high: data.high,
        spectrum: Float32Array.from(spectrum)
      };
    } else {
      for (const name of ['bass', 'mid', 'high']) {
        this.smoothed[name] += (data[name] - this.smoothed[name]) * k;
      }
      const s = this.smoothed.spectrum;
      for (let i = 0; i < s.length; i++) s[i] += (spectrum[i] - s[i]) * k;
    }

    this.audioData = {
      ...data,
      bass: this.smoothed.bass,
      mid: this.smoothed.mid,
      high: this.smoothed.high,
      spectrum: this.smoothed.spectrum
    };
  }

  // Driven by AudioProcessor.onBeat — a real detected kick, not a re-derivation
  // from the BPM number. Re-deriving meant the stage pulsed on a timer that had
  // drifted away from the music it was supposed to be following.
  onBeatEvent() {
    // Reduced motion takes no strikes at all, and the phase stays put.
    if (this.reducedMotion) return;
    // Struck at the flash allowance rather than at 1, so every consumer of
    // `beat` is safety-gated by construction. Requiring each mode to remember
    // `* this.flashIntensity` is a rule that gets forgotten — Polygon Collage
    // had already forgotten it — and this is a WCAG 2.3.1 surface, not a
    // stylistic one.
    this.beat = this.flashIntensity;
    this.phase = 0;
  }

  setFlashIntensity(value) {
    this.flashIntensity = Math.max(0, Math.min(1, value));
    this.beat = Math.min(this.beat, this.flashIntensity);
  }

  // The low-motion path that `prefers-reduced-motion` and the "Reduce motion"
  // control select. Colour and slow movement stay; every fast change goes.
  // Modes keep their time-driven drift, so the stage is never still — in this
  // product a still visualizer has no function (PRODUCT.md).
  setReducedMotion(on) {
    this.reducedMotion = !!on;
    this.smoothed = null;
    this.lastAudioAt = 0;
    if (this.reducedMotion) {
      this.beat = 0;
      this.phase = 0;
    }
  }

  // One response law for all ten modes. The gamma lifts quiet detail so the
  // stage still moves at conversational volume; the clamp stops a hot mixer
  // from pinning every mode to its maximum at once.
  level(value) {
    return Math.min(1, Math.pow(Math.max(0, value || 0), 0.7));
  }

  // Honest silence. When there is genuinely no signal the whole stage breathes
  // at one slow shared rate, at an amplitude no one would mistake for music.
  // Every mode used to fake this individually with `|| Math.sin(time)`, which
  // meant a dead input still looked like a loud room — and, because sin goes
  // negative, occasionally asked p5 for a negative stroke weight.
  get idle() {
    const signal = (this.audioData.bass + this.audioData.mid + this.audioData.high) / 3;
    if (signal > 0.02) return 0;
    return (Math.sin(this.time * 0.9) * 0.5 + 0.5) * 0.1;
  }

  band(name) {
    return Math.max(this.level(this.audioData[name]), this.idle);
  }

  /* -------------------------------------------------------------- painting */

  // Light does not occlude light. Everything on this stage is emissive and
  // painted back to front, so depth rejection has nothing useful to contribute
  // and actively breaks the stacked-pass glow (equal-depth fragments fail the
  // default LESS test). p5 is vendored and pinned at 1.9.0, so reaching for the
  // context here is stable; it degrades to a no-op rather than throwing.
  setDepthTest(p, enabled) {
    const gl = p._renderer && p._renderer.GL;
    if (!gl) return;
    if (enabled) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
  }

  // The drawing helpers modes use (GLOW, emissiveStroke, emissiveDot,
  // roundedRect) live in app/paint.js, so a mode imports them directly.

  /* ------------------------------------------------------------------ loop */

  // Copies what modes may read into the one shared stage object. Fields, not
  // getters: a getter onto the visualizer would hand modes everything again.
  refreshStage(mode) {
    const stage = this.stage;
    stage.colors = this.colors;
    stage.audio = this.audioData;
    stage.idle = this.idle;
    stage.beat = this.beat;
    stage.phase = this.phase;
    stage.beatPeriod = this.beatPeriod;
    stage.time = this.time;
    stage.w = this.w;
    stage.h = this.h;
    stage.vw = this.vw;
    stage.vh = this.vh;
    stage.railH = this.railH;
    stage.layer = mode.clearsBackground === false ? this.collageLayer : null;
    stage.media = mode.usesMedia ? this.customMedia : null;
  }

  draw(p) {
    const dt = Math.min(0.1, (p.deltaTime || 16.7) / 1000);
    this.time += dt;
    if (this.onFrame) this.onFrame();

    // Frame-rate independent decay. The old code decayed by a fixed factor per
    // callback, so the beat envelope was twice as long on a machine running at
    // half the frame rate — exactly the machine most likely to be at the venue.
    this.beat *= Math.pow(0.02, dt / this.beatDecay);
    // Several modes turn by `phase` and snap back when it wraps. Reduced
    // motion freezes it rather than slowing it, so there is no snap at all.
    if (!this.reducedMotion) {
      this.phase = (this.phase + dt / Math.max(0.2, this.beatPeriod)) % 1;
    }

    this.updateFrequencyDisplay();

    const mode = this.activeMode();
    const layered = mode.clearsBackground === false;
    this.setCollageVisible(layered && this.isRunning);

    p.clear();
    // A layered mode paints into the 2D canvas underneath, so the WEBGL canvas
    // has to stay transparent for it to be visible at all.
    if (!layered) p.background(0);

    if (!this.isRunning) return;

    this.refreshStage(mode);
    if (this.memoryFor !== mode) {
      this.memory = mode.setup ? mode.setup(this.stage) : {};
      this.memoryFor = mode;
    }

    this.setDepthTest(p, false);
    p.push();
    // Centre the composition in the space above the rail.
    p.translate(0, -this.railH / 2);

    // Emissive modes want light to accumulate. A mode that shows a photograph
    // opts out with additive: false; additive blending would blow it out.
    const additive = mode.additive !== false;
    if (additive) p.blendMode(p.ADD);

    mode.draw(p, this.stage, this.memory);

    if (additive) p.blendMode(p.BLEND);
    p.pop();

    this.limitFlashes(p);
    this.setDepthTest(p, true);
  }

  /* --------------------------------------------------------- flash ceiling */

  // The last stage of the render path, after every mode has drawn. It reads
  // the frame the viewer is about to see, and if that frame would start a
  // fourth flash inside one second, it dims the whole frame under a black
  // veil. This runs inside p5's draw callback, before the browser presents
  // the frame, so a blocked flash is never shown — not even for one frame.
  // See app/flashGuard.js for the rule. PHI-265.
  limitFlashes(p) {
    const now = performance.now();
    let frame;
    try {
      frame = this.sampleFrame(p);
    } catch (error) {
      // An unreadable frame cannot be measured, so the ceiling cannot be
      // proven. Fall to the calm path, which does not flash, rather than let
      // the error stop p5's loop and freeze the stage (PHI-222).
      if (!this.reducedMotion) {
        console.warn('Flash guard cannot read the frame; switching to reduced motion.', error);
        this.setReducedMotion(true);
      }
      return;
    }
    const result = this.flashGuard.process(frame.pixels, frame.cols, frame.rows, now);

    if (result.scale < 1) {
      p.push();
      p.noStroke();
      p.fill(0, 0, 0, (1 - result.scale) * 255);
      p.rect(-this.w / 2, -this.h / 2, this.w, this.h);
      p.pop();
    }

    // Measurement reads the canvas again, after the veil, so it checks what
    // was shown rather than trusting the guard's arithmetic. The second read
    // is measurement cost only; production pays for one.
    if (this.flashMeter) {
      const guardMs = performance.now() - now;
      const shown = this.sampleFrame(p);
      this.flashMeter.observe(shown.pixels, shown.cols, shown.rows, result, now, guardMs);
      this.logFlashes(now);
    }
  }

  // One line a second while ?flashlog is on: the worst one-second window seen
  // so far in this mode, and what the guard cost. Switching mode starts a new
  // count, so a set walked through every mode reads as one line per mode.
  logFlashes(now) {
    const meter = this.flashMeter;
    if (this.flashLogMode !== this.currentMode) {
      this.flashLogMode = this.currentMode;
      this.flashMeter = new FlashMeter();
      this.flashLogAt = now;
      return;
    }
    if (now - (this.flashLogAt || 0) < 1000) return;
    const seconds = (now - this.flashLogAt) / 1000;
    this.flashLogAt = now;
    const second = meter.second;
    console.log(
      `[flash] ${this.currentMode}: ${JSON.stringify(meter.worst)}, ` +
        `${Math.round(second.frames / seconds)} FPS, ` +
        `guard ${(second.guardMs / Math.max(1, second.frames)).toFixed(2)} ms/frame, ` +
        `veiled ${second.veiledFrames}/${second.frames}`
    );
    // Rate and cost are per second; the worst window is kept for the mode.
    meter.second = { frames: 0, veiledFrames: 0, guardMs: 0 };
  }

  // A small grid of single pixels from the composited stage: black ground,
  // the collage layer if it is showing, then the WEBGL canvas on top. Point
  // sampling, not averaging — a downscale averages in sRGB and under-reads
  // the luminance of thin bright lines, which is the wrong direction to err.
  // A 64-wide grid is one readback of a few thousand pixels per frame.
  sampleFrame(p) {
    const canvas = p.canvas || (p._renderer && p._renderer.elt);
    const cols = 64;
    const rows = Math.max(1, Math.round((cols * this.h) / Math.max(1, this.w)));

    if (!this.flashSampler) {
      this.flashSampler = document.createElement('canvas');
      // Kept on the GPU on purpose. A CPU-backed sampler would make the
      // browser copy the whole projector-sized frame back every frame just to
      // shrink it; this way only the small grid crosses back.
      this.flashSamplerCtx = this.flashSampler.getContext('2d', { willReadFrequently: false });
    }
    if (this.flashSampler.width !== cols || this.flashSampler.height !== rows) {
      this.flashSampler.width = cols;
      this.flashSampler.height = rows;
    }

    const ctx = this.flashSamplerCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cols, rows);
    if (this.collageCanvas && !this.collageCanvas.hidden) {
      ctx.drawImage(this.collageCanvas, 0, 0, cols, rows);
    }
    ctx.drawImage(canvas, 0, 0, cols, rows);
    return { pixels: ctx.getImageData(0, 0, cols, rows).data, cols, rows };
  }

  updateFrequencyDisplay() {
    if (!this.isRunning) {
      if (this.bassFill) this.bassFill.style.width = '0%';
      if (this.midFill) this.midFill.style.width = '0%';
      if (this.highFill) this.highFill.style.width = '0%';
      return;
    }

    // Bands arrive normalised 0..1, so the meter is a straight percentage —
    // no scaling constant standing between the number and the reading.
    // The track reads horizontally: fill is the live level, thumb is the gain.
    const pct = (v) => `${Math.min(100, Math.max(0, v * 100)).toFixed(1)}%`;
    if (this.bassFill) this.bassFill.style.width = pct(this.audioData.bass);
    if (this.midFill) this.midFill.style.width = pct(this.audioData.mid);
    if (this.highFill) this.highFill.style.width = pct(this.audioData.high);
  }

  /* ------------------------------------------------------- shared with modes */

  // Which band owns a given frequency. Shared with the analyser's BANDS table
  // so the stage and the rail can never disagree about where mid ends — the
  // failure DESIGN.md calls out explicitly.
  bandAt(hz) {
    for (const band of BANDS) {
      if (hz >= band.from && hz < band.to) return band.name;
    }
    return hz < 20 ? 'bass' : 'high';
  }

  /* ------------------------------------------------------------ media i/o */

  async loadCustomMedia(file) {
    if (!this.p5Instance) return;

    this.clearCustomMedia();

    // Chrome types a file by its name, so a WebP or a PNG saved as "party.gif"
    // arrives as image/gif. p5 sends every image/gif to its own GIF decoder,
    // which throws inside a promise on anything else and never calls the
    // failure callback below. Only a file that really starts "GIF8" keeps the
    // GIF type; anything else goes to the browser's own image loader, which
    // opens it or reports it. PHI-222.
    let source = file;
    if (file.type === 'image/gif' && (await file.slice(0, 4).text()) !== 'GIF8') {
      source = new Blob([file]);
    }

    const url = URL.createObjectURL(source);
    this.customMediaURL = url;

    if (file.type.startsWith('video/')) {
      this.customMediaType = 'video';
      const video = this.p5Instance.createVideo([url], () => {
        video.volume(0);
        video.hide();
        if (this.activeMode().usesMedia) video.loop();
        this.customMedia = video;
        if (this.customMediaStatus) this.customMediaStatus.textContent = `Loaded: ${file.name}`;
      });
    } else if (file.type.startsWith('image/')) {
      this.customMediaType = 'image';
      this.p5Instance.loadImage(
        url,
        (img) => {
          this.customMedia = img;
          if (this.customMediaStatus) this.customMediaStatus.textContent = `Loaded: ${file.name}`;
        },
        () => {
          if (this.customMediaStatus)
            this.customMediaStatus.textContent = `Failed to load: ${file.name}`;
          URL.revokeObjectURL(url);
          this.customMediaURL = null;
        }
      );
    } else {
      if (this.customMediaStatus) this.customMediaStatus.textContent = 'Unsupported file type';
      URL.revokeObjectURL(url);
      this.customMediaURL = null;
    }
  }

  clearCustomMedia() {
    if (this.customMediaType === 'video' && this.customMedia) {
      this.customMedia.stop();
      this.customMedia.remove();
    }
    if (this.customMediaURL) {
      URL.revokeObjectURL(this.customMediaURL);
      this.customMediaURL = null;
    }
    this.customMedia = null;
    this.customMediaType = null;
  }

  /* --------------------------------------------------------------- control */

  start() {
    this.isRunning = true;
  }

  stop() {
    this.isRunning = false;
    this.beat = 0;
    // Mode state starts fresh on the next start: peak marks, collage timing.
    this.memoryFor = null;
    this.resetCollage();
  }

  destroy() {
    this.clearCustomMedia();
    if (this.collageCanvas) {
      this.collageCanvas.remove();
      this.collageCanvas = null;
      this.collageCtx = null;
      this.collageLayer = null;
    }
    if (this.p5Instance) {
      this.p5Instance.remove();
    }
  }
}

export { DJVisualizer };
