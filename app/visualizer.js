/* DJ Visualizer — the stage.
 *
 * Every mode in this file obeys one grammar, described in DESIGN.md under
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

    this.currentMode = 'spectrum';
    this.particles = [];
    this.time = 0;
    this.isRunning = false;

    // Beat state. `beat` is a 0..1 envelope struck by a real beat event and
    // decayed on wall time, so it behaves the same at 30fps and 144fps.
    this.beat = 0;
    this.beatDecay = 0.34; // seconds to near-zero
    this.phase = 0;        // beat phase, 0..1, re-anchored on every beat
    this.beatPeriod = 0.5; // seconds per beat; 120 BPM until told otherwise

    // Multiplier on every flash and pulse consumer. Photosensitivity is a
    // product requirement, not a preference: WCAG 2.3.1.
    this.flashIntensity = 1;

    // Custom uploaded media state (image/gif/video)
    this.customMedia = null;
    this.customMediaType = null; // 'image' | 'video'
    this.customMediaURL = null;

    // Spectrum mode state. Bars are log-spaced across the audible range and
    // peak-hold marks ride above them, the way a mixer's meter does.
    this.spectrumPeaks = [];

    // Polygon Collage accumulates rather than clearing, so it gets its own 2D
    // canvas layered beneath the WEBGL one. Accumulating in the WEBGL
    // framebuffer would fight its per-frame clear, and compositing a 2D buffer
    // through p5's image() meant re-uploading a full-screen texture to the GPU
    // sixty times a second — for paint that changes a few times a bar.
    this.collageCanvas = null;
    this.collageCtx = null;
    this.collageFrames = 0;

    // Filled from the CSS band tokens at init. Declared here only so the shape
    // is visible; the values are never hard-coded.
    this.colors = { bass: [255, 255, 255], mid: [255, 255, 255], high: [255, 255, 255] };
  }

  /* ---------------------------------------------------------------- setup */

  init() {
    this.readPalette();

    // Frequency band displays in the rail
    this.bassFill = document.querySelector(".bass-fill");
    this.midFill = document.querySelector(".mid-fill");
    this.highFill = document.querySelector(".high-fill");

    this.visualModeSelect = document.getElementById('visualMode');
    this.visualModeSelect.addEventListener('change', (e) => {
      const previousMode = this.currentMode;
      this.currentMode = e.target.value;

      // Custom media controls only exist when they can be used.
      const mediaSection = document.getElementById('customMediaSection');
      if (mediaSection) mediaSection.hidden = this.currentMode !== 'custom';

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
        const canvas = p.createCanvas(this.w, this.h, p.WEBGL);
        canvas.parent('p5-canvas');
        p.frameRate(60);
        p.noStroke();
        this.initializeParticles();
        this.resetCollage();
      };

      p.windowResized = () => {
        this.measureStage();
        p.resizeCanvas(this.w, this.h);
        this.initializeParticles();
        this.resetCollage();
      };

      p.draw = () => this.draw(p);
    });
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
      const parts = rgb[1].split(',').map(v => parseFloat(v));
      if (parts.length >= 3 && parts.every(v => !isNaN(v))) return parts.slice(0, 3);
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

  onModeChange(previousMode) {
    this.initializeParticles();
    this.spectrumPeaks = [];
    this.resetCollage();

    // Pause/resume uploaded video when leaving/entering custom mode
    if (this.customMediaType === 'video' && this.customMedia) {
      if (this.currentMode === 'custom') this.customMedia.loop();
      else if (previousMode === 'custom') this.customMedia.pause();
    }
  }

  initializeParticles() {
    // Fewer than before, and deliberately. Reduction is the direction: a field
    // that breathes reads as composed, a field that fills reads as noise.
    this.particles = [];
    for (let i = 0; i < 36; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * this.vw,
        y: (Math.random() - 0.5) * this.vh,
        z: (Math.random() - 0.5) * 600,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        vz: (Math.random() - 0.5) * 0.5,
        seed: Math.random() * Math.PI * 2,
        size: Math.random() * 3 + 2
      });
    }
  }

  ensureCollage() {
    if (this.collageCanvas) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'collage-canvas';
    const stage = document.querySelector('.stage');
    // Behind the WEBGL canvas, which runs transparent while this mode is up.
    stage.insertBefore(canvas, stage.firstChild);
    this.collageCanvas = canvas;
    this.collageCtx = canvas.getContext('2d');
  }

  resetCollage() {
    this.ensureCollage();
    const w = Math.max(1, this.w);
    const h = Math.max(1, this.h);
    // Assigning width/height also clears the canvas, which is what we want on
    // both a resize and a mode switch — stale paint must not survive either.
    this.collageCanvas.width = w;
    this.collageCanvas.height = h;
    this.collageFrames = 0;
  }

  setCollageVisible(visible) {
    if (this.collageCanvas) this.collageCanvas.hidden = !visible;
  }

  /* ----------------------------------------------------------- audio state */

  updateAudioData(data) {
    this.audioData = { ...data };
    if (data.bpm > 0) this.beatPeriod = 60 / data.bpm;
  }

  // Driven by AudioProcessor.onBeat — a real detected kick, not a re-derivation
  // from the BPM number. Re-deriving meant the stage pulsed on a timer that had
  // drifted away from the music it was supposed to be following.
  onBeatEvent() {
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

  // The whole art direction in one function. Three passes — wide and faint,
  // then middle, then tight and bright — turn a 2px stroke into something with
  // a core and a halo. It is the cheapest thing that reads as light instead of
  // ink, and it needs no shader, which the zero-build constraint forbids.
  static GLOW = [[4.0, 0.10], [2.1, 0.22], [1.0, 1.0]];

  emissiveStroke(p, rgb, alpha, weight, shape) {
    p.noFill();
    for (const [ws, as] of DJVisualizer.GLOW) {
      p.stroke(rgb[0], rgb[1], rgb[2], alpha * as);
      p.strokeWeight(Math.max(0.4, weight * ws));
      shape();
    }
  }

  emissiveDot(p, rgb, alpha, diameter, x = 0, y = 0) {
    p.noStroke();
    for (const [ws, as] of DJVisualizer.GLOW) {
      p.fill(rgb[0], rgb[1], rgb[2], alpha * as);
      p.circle(x, y, Math.max(0.5, diameter * ws));
    }
  }

  /* ------------------------------------------------------------------ loop */

  draw(p) {
    const dt = Math.min(0.1, (p.deltaTime || 16.7) / 1000);
    this.time += dt;
    if (this.onFrame) this.onFrame();

    // Frame-rate independent decay. The old code decayed by a fixed factor per
    // callback, so the beat envelope was twice as long on a machine running at
    // half the frame rate — exactly the machine most likely to be at the venue.
    this.beat *= Math.pow(0.02, dt / this.beatDecay);
    this.phase = (this.phase + dt / Math.max(0.2, this.beatPeriod)) % 1;

    this.updateFrequencyDisplay();

    const collaging = this.currentMode === 'polygons';
    this.setCollageVisible(collaging && this.isRunning);

    p.clear();
    // Polygon Collage paints into the layer underneath, so the WEBGL canvas has
    // to stay transparent for it to be visible at all.
    if (!collaging) p.background(0);

    if (!this.isRunning) return;

    this.setDepthTest(p, false);
    p.push();
    // Centre the composition in the space above the rail.
    p.translate(0, -this.railH / 2);

    // Custom media is a photograph, not a light source; additive blending would
    // blow it out. Every other mode is emissive and wants light to accumulate.
    const additive = this.currentMode !== 'custom';
    if (additive) p.blendMode(p.ADD);

    switch (this.currentMode) {
      case 'spectrum': this.drawSpectrum(p); break;
      case 'particles': this.drawParticleField(p); break;
      case 'rings': this.drawFrequencyRings(p); break;
      case 'waves': this.drawWaveforms(p); break;
      case 'mandala': this.drawMandala(p); break;
      case 'tunnel': this.drawTunnel(p); break;
      case 'galaxy': this.drawGalaxy(p); break;
      case 'flow': this.drawFlow(p); break;
      case 'polygons': this.drawPolygonCollage(); break;
      case 'custom': this.drawCustomMedia(p); break;
      default: this.drawParticleField(p);
    }

    if (additive) p.blendMode(p.BLEND);
    p.pop();
    this.setDepthTest(p, true);
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

  /* ------------------------------------------------------------- the modes */

  // Which band owns a given frequency. Shared with the analyser's BANDS table
  // so the stage and the rail can never disagree about where mid ends — the
  // failure DESIGN.md calls out explicitly.
  bandAt(hz) {
    if (typeof BANDS === 'undefined') return 'mid';
    for (const band of BANDS) {
      if (hz >= band.from && hz < band.to) return band.name;
    }
    return hz < 20 ? 'bass' : 'high';
  }

  /* Spectrum Bars — the instrument.
   *
   * Log-spaced across the audible range, because linear bins spend four fifths
   * of the screen width above 4 kHz where almost nothing happens, and squash
   * every kick and vocal into the leftmost inch. Peak-hold marks ride above the
   * bars: it is what a real mixer meter has, and it is the detail that makes
   * the mode read as an instrument rather than a decoration. Closes PHI-154 —
   * this used to be 256 DOM nodes restyled sixty times a second. */
  drawSpectrum(p) {
    const spec = this.audioData.spectrum;
    const binHz = this.audioData.binHz;
    if (!spec || spec.length === 0 || !binHz) return;

    const COUNT = 88;
    const F_MIN = 20, F_MAX = 20000;
    const ratio = Math.pow(F_MAX / F_MIN, 1 / COUNT);

    const width = this.vw * 0.9;
    const left = -width / 2;
    const slot = width / COUNT;
    const barW = slot * 0.62;
    const floorY = this.vh / 2 - this.vh * 0.06;
    const maxH = this.vh * 0.74;

    if (this.spectrumPeaks.length !== COUNT) this.spectrumPeaks = new Array(COUNT).fill(0);

    for (let i = 0; i < COUNT; i++) {
      const fLow = F_MIN * Math.pow(ratio, i);
      const fHigh = F_MIN * Math.pow(ratio, i + 1);

      const first = Math.max(1, Math.round(fLow / binHz));
      const last = Math.min(spec.length - 1, Math.max(first, Math.round(fHigh / binHz)));

      // Peak, not mean, across the bar's bins. At the low end a bar covers one
      // bin and at the top it covers dozens; averaging would flatten the highs
      // into nothing purely as an artefact of the spacing.
      let value = 0;
      for (let b = first; b <= last; b++) value = Math.max(value, spec[b] || 0);

      const lit = Math.max(this.level(value), this.idle * 0.6);
      const rgb = this.colors[this.bandAt((fLow + fHigh) / 2)];
      const x = left + i * slot + slot / 2;
      const barH = Math.max(2, lit * maxH);

      // Peak hold falls under gravity rather than tracking the signal down.
      this.spectrumPeaks[i] = Math.max(this.spectrumPeaks[i] - 0.5 * (1 / 60), lit);

      p.push();
      p.translate(x, floorY - barH / 2);
      p.noStroke();
      for (const [ws, as] of DJVisualizer.GLOW) {
        p.fill(rgb[0], rgb[1], rgb[2], (70 + lit * 170) * as);
        p.rect(-barW * ws / 2, -barH / 2, barW * ws, barH, barW / 2);
      }
      p.pop();

      const peakY = floorY - Math.max(2, this.spectrumPeaks[i] * maxH);
      p.noStroke();
      p.fill(255, 255, 255, 120 + this.spectrumPeaks[i] * 100);
      p.rect(x - barW / 2, peakY - 1, barW, 2);
    }
  }

  /* Floating Particles — the room's dust.
   *
   * Depth carries the band: bass sits far and heavy, highs sit near and quick.
   * Sorted back to front so the additive halos layer correctly, and billboarded
   * circles rather than lit spheres — 36 spheres was two thousand quads a frame
   * for a shape the camera can only ever see as a disc. */
  drawParticleField(p) {
    const bass = this.band('bass'), mid = this.band('mid'), high = this.band('high');
    const drift = 0.4 + this.beat * 0.8;

    for (const particle of this.particles) {
      particle.x += particle.vx * (1 + bass * 6) * drift;
      particle.y += particle.vy * (1 + mid * 5) * drift;
      particle.z += particle.vz * (1 + high * 7) * drift;

      const halfW = this.vw / 2, halfH = this.vh / 2;
      if (particle.x > halfW) particle.x = -halfW;
      if (particle.x < -halfW) particle.x = halfW;
      if (particle.y > halfH) particle.y = -halfH;
      if (particle.y < -halfH) particle.y = halfH;
      if (particle.z > 300) particle.z = -300;
      if (particle.z < -300) particle.z = 300;
    }

    const ordered = [...this.particles].sort((a, b) => a.z - b.z);
    const total = ordered.length;

    ordered.forEach((particle, index) => {
      const third = index / total;
      const name = third < 0.34 ? 'bass' : third < 0.67 ? 'mid' : 'high';
      const lit = name === 'bass' ? bass : name === 'mid' ? mid : high;

      // Near particles are brighter and larger. Cheap depth cueing, and it is
      // what stops the field reading as a flat scatter of dots.
      const depth = (particle.z + 300) / 600;
      const alpha = (40 + lit * 190) * (0.35 + depth * 0.65);
      const size = (particle.size + lit * 26) * (0.5 + depth * 0.9);

      p.push();
      p.translate(particle.x, particle.y, particle.z);
      this.emissiveDot(p, this.colors[name], alpha, size);
      p.pop();
    });
  }

  /* Frequency Rings — the concentric readout.
   *
   * Three nested groups, one per band, inner to outer in frequency order so the
   * figure reads bass at the core and air at the edge. Three rings per band
   * instead of twelve undifferentiated ones: the point is legibility of state,
   * which is the craft bar's whole demand. */
  drawFrequencyRings(p) {
    const bands = ['bass', 'mid', 'high'];
    const base = Math.min(this.vw, this.vh) * 0.11;

    bands.forEach((name, group) => {
      const lit = this.band(name);
      const rgb = this.colors[name];

      for (let i = 0; i < 3; i++) {
        const index = group * 3 + i;
        // Rings breathe out of phase with each other so the figure never reads
        // as one solid disc pumping.
        const offset = Math.sin(this.phase * Math.PI * 2 - index * 0.4) * lit * base * 0.55;
        const radius = base * (1.1 + index * 0.72) + lit * base * 1.5 + offset;
        const alpha = (55 + lit * 175) * (1 - index * 0.06);

        p.push();
        // A slow tilt gives the rings a body. Tied to beat phase, so it turns
        // with the track rather than at an arbitrary rate.
        p.rotateX(Math.sin(this.time * 0.25 + group) * 0.35);
        p.rotateZ(this.phase * Math.PI * 0.5 + group * 0.6);
        this.emissiveStroke(p, rgb, alpha, 1.4 + lit * 3.2, () => p.circle(0, 0, radius * 2));
        p.pop();
      }
    });
  }

  /* Wave Forms — three bands as three waveforms.
   *
   * The shape is read out of the band's own spectrum slice rather than from a
   * sine wave, so what is on screen is the sound and not an animation timed to
   * arrive alongside it. Bass sits low and slow, highs sit high and fine. */
  drawWaveforms(p) {
    const spec = this.audioData.spectrum;
    const binHz = this.audioData.binHz;
    const layout = [
      { name: 'bass', y: this.vh * 0.24, step: 14, wobble: 0.9 },
      { name: 'mid', y: 0, step: 9, wobble: 1.6 },
      { name: 'high', y: -this.vh * 0.24, step: 6, wobble: 2.6 }
    ];

    for (const row of layout) {
      const lit = this.band(row.name);
      const rgb = this.colors[row.name];
      const amp = lit * this.vh * 0.2;
      const bounds = (typeof BANDS !== 'undefined' && BANDS.find(b => b.name === row.name)) || null;

      let first = 1, last = 1;
      if (bounds && binHz && spec && spec.length) {
        first = Math.max(1, Math.round(bounds.from / binHz));
        last = Math.min(spec.length - 1, Math.round(bounds.to / binHz));
      }
      const span = Math.max(1, last - first);

      this.emissiveStroke(p, rgb, 70 + lit * 165, 1.6 + lit * 2.6, () => {
        p.beginShape();
        for (let x = -this.vw / 2; x <= this.vw / 2; x += row.step) {
          const t = (x + this.vw / 2) / this.vw;

          // The band's own bins drive the shape; the travelling term only moves
          // it, and its amplitude is a fraction of the signal's, never a
          // substitute for it.
          let detail = 0;
          if (spec && spec.length) {
            const bin = first + Math.floor(t * span);
            detail = ((spec[bin] || 0) - 0.5) * 2;
          }
          const travel = Math.sin(t * Math.PI * 2 * row.wobble + this.phase * Math.PI * 2);
          p.vertex(x, row.y + detail * amp + travel * amp * 0.35);
        }
        p.endShape();
      });
    }
  }

  /* Mandala — radial symmetry, struck on the beat.
   *
   * Spoke count comes from the band's energy, so the figure gains and loses
   * structure with the music rather than spinning at a constant density. The
   * rotation is beat-phase driven: it completes a turn per bar, not per
   * arbitrary interval. */
  drawMandala(p) {
    const bands = ['bass', 'mid', 'high'];
    const radius = Math.min(this.vw, this.vh) * 0.42;

    p.push();
    p.rotateZ(this.phase * Math.PI * 0.5);

    bands.forEach((name, ring) => {
      const lit = this.band(name);
      const rgb = this.colors[name];
      const spokes = 6 + Math.round(lit * 18);
      const inner = radius * (0.16 + ring * 0.24);
      const outer = inner + radius * (0.2 + lit * 0.42);
      const alpha = 60 + lit * 170;

      p.push();
      // Alternating direction keeps the three rings from fusing into one wheel.
      p.rotateZ((ring % 2 ? -1 : 1) * (this.time * 0.12 + ring));

      for (let i = 0; i < spokes; i++) {
        p.push();
        p.rotateZ((i / spokes) * Math.PI * 2);
        // Struck spokes: every fourth one extends on the beat, which gives the
        // figure an accent instead of a uniform pulse.
        const struck = i % 4 === 0 ? this.beat * radius * 0.18 : 0;
        this.emissiveStroke(p, rgb, alpha, 1.2 + lit * 2.4,
          () => p.line(inner, 0, outer + struck, 0));
        p.pop();
      }
      p.pop();
    });

    p.pop();
  }

  /* Tunnel Vision — travel at tempo.
   *
   * The rings advance by beat phase, so the tunnel moves a fixed distance per
   * beat and the travel locks to the track. Colour is by depth in frequency
   * order, near to far, so the tunnel is a spectrum you fly through. */
  drawTunnel(p) {
    const RINGS = 18;
    const SPACING = 90;
    const bands = ['bass', 'mid', 'high'];
    const advance = ((this.phase + this.time * 0.05) % 1) * SPACING;

    for (let i = RINGS - 1; i >= 0; i--) {
      const depth = i / RINGS;
      const name = bands[Math.min(2, Math.floor(depth * 3))];
      const lit = this.band(name);
      const rgb = this.colors[name];

      const z = -i * SPACING + advance;
      // Fade the far end out rather than letting rings pop in at the horizon.
      const fade = 1 - depth * 0.75;
      const alpha = (35 + lit * 175) * fade;
      const radius = Math.min(this.vw, this.vh) * (0.16 + lit * 0.14);

      p.push();
      p.translate(0, 0, z);
      p.rotateZ(depth * 0.5 + this.time * 0.08);
      this.emissiveStroke(p, rgb, alpha, 1.4 + lit * 3.4, () => p.circle(0, 0, radius * 2));
      p.pop();
    }
  }

  /* Galaxy — spiral arms brightening by band.
   *
   * Radius carries frequency: bass at the core, air at the rim. The arms turn
   * on beat phase, and each point's brightness is its band's level, so a bass
   * drop lights the centre and a hi-hat pattern lights the edge. */
  drawGalaxy(p) {
    const ARMS = 3;
    const POINTS = 42;
    const bands = ['bass', 'mid', 'high'];
    const reach = Math.min(this.vw, this.vh) * 0.44;

    for (let arm = 0; arm < ARMS; arm++) {
      p.push();
      p.rotateZ(this.phase * Math.PI * 0.35 + (arm / ARMS) * Math.PI * 2);

      for (let i = 0; i < POINTS; i++) {
        const t = i / POINTS;
        const name = bands[Math.min(2, Math.floor(t * 3))];
        const lit = this.band(name);
        const rgb = this.colors[name];

        const angle = t * Math.PI * 2.4;
        const radius = t * reach * (1 + lit * 0.22);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        // The arm thins as it reaches out, the way a real one does.
        const alpha = (45 + lit * 190) * (1 - t * 0.45);
        const size = (2.5 + lit * 14) * (1 - t * 0.4);

        p.push();
        p.translate(x, y, 0);
        this.emissiveDot(p, rgb, alpha, size);
        p.pop();
      }
      p.pop();
    }

    // A core that answers the kick. One element carrying the whole low end is
    // the composition's anchor; without it the spiral has no centre of gravity.
    const core = this.band('bass');
    this.emissiveDot(p, this.colors.bass,
      70 + core * 150 + this.beat * 40,
      reach * (0.06 + core * 0.09));
  }

  /* Flow — the three bands as one weather system.
   *
   * Salvaged rather than written. This was a finished mode stranded behind
   * `drawSnakeGame`, an entry point nothing called, and it was very nearly
   * deleted with the snake remnants around it. Three layers that read as one
   * field: streams travelling across the frame, a ring of connected nodes, and
   * stacked waves underneath.
   *
   * Restored into the grammar rather than pasted back — the original used
   * hard-coded alpha ramps, flat 2px strokes, lit spheres, and `sin(time)`
   * fallbacks, none of which the other nine modes are allowed. What survives is
   * its composition, which was the part worth keeping.
   */
  drawFlow(p) {
    const bands = ['bass', 'mid', 'high'];
    const levels = { bass: this.band('bass'), mid: this.band('mid'), high: this.band('high') };

    this.drawFlowStreams(p, bands, levels);
    this.drawFlowNodes(p, bands, levels);
    this.drawFlowWaves(p, bands, levels);
  }

  // Streams travelling across the frame, one set per band, each band crossing
  // on its own diagonal so the three read as separate currents in one system.
  drawFlowStreams(p, bands, levels) {
    const STREAMS = 3;
    const STEPS = 48;
    const paths = {
      bass: { from: this.vh * 0.22, to: -this.vh * 0.22, reverse: false, rate: 1.6, sway: 0.42 },
      mid: { from: 0, to: 0, reverse: false, rate: 2.2, sway: 0.5 },
      high: { from: -this.vh * 0.22, to: this.vh * 0.22, reverse: true, rate: 3.0, sway: 0.34 }
    };

    for (let stream = 0; stream < STREAMS; stream++) {
      const offset = (stream / STREAMS) * Math.PI * 2;

      for (const name of bands) {
        const lit = levels[name];
        const path = paths[name];
        const drift = this.phase * Math.PI * 2 + offset;

        this.emissiveStroke(p, this.colors[name], 60 + lit * 165, 1.3 + lit * 2.2, () => {
          p.beginShape();
          for (let i = 0; i <= STEPS; i++) {
            const t = i / STEPS;
            const along = path.reverse ? 1 - t : t;
            const x = (along - 0.5) * this.vw +
              Math.sin(this.time * path.rate + offset + t * 5) * lit * this.vw * 0.05;
            const y = path.from + (path.to - path.from) * t +
              Math.cos(this.time * path.rate * 0.7 + offset + t * 4) * lit * this.vh * path.sway * 0.2;
            p.vertex(x, y);
          }
          p.endShape();
        });
      }
    }
  }

  // A ring of nodes, thirds coloured by band, each linked to its neighbours
  // while its band is carrying energy. The links are the point: they are what
  // makes three separate readings look like one connected system.
  drawFlowNodes(p, bands, levels) {
    const NODES = 12;
    const radius = Math.min(this.vw, this.vh) * 0.3;
    const spin = this.phase * Math.PI * 0.5;

    for (let i = 0; i < NODES; i++) {
      const name = bands[Math.min(2, Math.floor((i / NODES) * 3))];
      const lit = levels[name];
      const rgb = this.colors[name];

      const angle = (i / NODES) * Math.PI * 2 + spin;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      // Links first, so the nodes sit on top of their own connections.
      if (lit > 0.08) {
        const next = (i + 1) % NODES;
        const nextAngle = (next / NODES) * Math.PI * 2 + spin;
        this.emissiveStroke(p, rgb, 40 + lit * 110, 0.8 + lit * 2, () => {
          p.line(x, y, Math.cos(nextAngle) * radius, Math.sin(nextAngle) * radius);
        });
      }

      p.push();
      p.translate(x, y, 0);
      this.emissiveDot(p, rgb, 70 + lit * 170, 5 + lit * 20 + this.beat * 5);
      p.pop();
    }
  }

  // Stacked waves under the ring. Two layers rather than the original three:
  // the emissive passes trebled the line count, and the field reads better with
  // room to breathe than it did filled.
  drawFlowWaves(p, bands, levels) {
    const POINTS = 40;
    const rows = { bass: this.vh * 0.3, mid: this.vh * 0.02, high: -this.vh * 0.3 };

    for (let layer = 0; layer < 2; layer++) {
      const phase = layer * 0.4;

      for (const name of bands) {
        const lit = levels[name];
        const baseY = rows[name] - layer * this.vh * 0.035;
        const amp = lit * this.vh * 0.11;

        this.emissiveStroke(p, this.colors[name], (45 + lit * 120) * (1 - layer * 0.3), 1.1 + lit * 1.6, () => {
          p.beginShape();
          for (let i = 0; i < POINTS; i++) {
            const x = ((i / (POINTS - 1)) - 0.5) * this.vw;
            const wave = Math.sin(i * 0.25 + this.time * 2.5 + phase) * amp;
            const flow = Math.cos(i * 0.18 + this.time * 3.2) * amp * 0.35;
            p.vertex(x, baseY + wave + flow);
          }
          p.endShape();
        });
      }
    }
  }

  /* Polygon Collage — the set accumulating into one image.
   *
   * Paint lands and stays, so by the end of a track the screen is a record of
   * what was played. It draws into its own 2D buffer: accumulating in the
   * WEBGL framebuffer meant paint survived a mode switch and reappeared under
   * the next mode. The buffer also fades, very slowly — without it a long set
   * turns the screen to mud, which is the failure mode of every collage.
   *
   * Colour is strictly the three band tokens and blends between them. The
   * previous version reached for pure red, green, blue, yellow, cyan, magenta
   * and white, which broke the palette contract on the one mode the demo ends
   * on. */
  drawPolygonCollage() {
    this.ensureCollage();
    const ctx = this.collageCtx;
    const width = this.collageCanvas.width;
    // Paint stays clear of the rail like every other mode's composition does.
    const height = this.collageCanvas.height - this.railH;

    const bass = this.band('bass'), mid = this.band('mid'), high = this.band('high');
    if (bass + mid + high <= 0.06) return;

    // Sample at a musical rate rather than a frame count, so a faster track
    // fills the canvas faster.
    this.collageFrames++;
    const interval = Math.max(2, Math.round(8 * (this.beatPeriod / 0.5)));
    if (this.collageFrames < interval) return;
    this.collageFrames = 0;

    // Very slow fade. Enough to keep a two-hour set legible, slight enough that
    // within a track it still reads as pure accumulation — the mode's identity.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.018)';
    ctx.fillRect(0, 0, width, this.collageCanvas.height);
    ctx.restore();

    const zones = [
      { name: 'bass', lit: bass, y: height * 0.74, spread: height * 0.18 },
      { name: 'mid', lit: mid, y: height * 0.50, spread: height * 0.15 },
      { name: 'high', lit: high, y: height * 0.26, spread: height * 0.17 }
    ];

    const spin = this.phase * Math.PI * 2;
    for (const zone of zones) {
      if (zone.lit < 0.05) continue;
      this.paintCollageShape(ctx, {
        name: zone.name,
        lit: zone.lit,
        points: 3 + Math.round(zone.lit * 3),
        cx: width * 0.5 + Math.cos(spin * 1.3 + zone.y * 0.01) * width * 0.26,
        cy: zone.y + Math.sin(spin * 2) * zone.spread,
        radius: zone.lit * Math.min(width, height) * 0.28 * (1 + this.beat * 0.4),
        rotation: spin + Math.random() * 0.7
      }, { bass, mid, high });
    }
  }

  paintCollageShape(ctx, shape, levels) {
    // Blend between the band tokens by how much of each band is present. A
    // bass-and-mid moment lands between red and green rather than jumping to a
    // fourth colour the palette never agreed to. The previous version reached
    // for pure yellow, cyan, magenta and white here, on the one mode the
    // meetup demo ends on.
    const total = levels.bass + levels.mid + levels.high || 1;
    const own = this.colors[shape.name];
    const mixed = [0, 1, 2].map(channel =>
      (this.colors.bass[channel] * levels.bass +
       this.colors.mid[channel] * levels.mid +
       this.colors.high[channel] * levels.high) / total
    );
    // Two thirds its own band, one third the room. Keeps a shape identifiable
    // as bass or high while still recording what else was playing under it.
    const rgb = mixed.map((v, i) => Math.round(own[i] * 0.66 + v * 0.34));
    const alpha = (0.16 + shape.lit * 0.45).toFixed(3);

    ctx.save();
    ctx.translate(shape.cx, shape.cy);
    ctx.rotate(shape.rotation);
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < shape.points; i++) {
      const angle = (i / shape.points) * Math.PI * 2;
      const r = shape.radius * (0.6 + (i % 2) * 0.4);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* Custom Upload — the operator's own image, reacting.
   *
   * Bass scales, mid tilts, high splits the image into band-tinted copies. The
   * split uses the band tokens, so even an arbitrary uploaded photograph is
   * annotated in the product's own colour language. */
  drawCustomMedia(p) {
    if (!this.customMedia) {
      this.drawDropTarget(p);
      return;
    }

    const bass = this.band('bass');
    const mid = this.band('mid');
    const high = this.band('high');

    const mediaW = this.customMedia.width || 1;
    const mediaH = this.customMedia.height || 1;
    const fit = Math.min(this.vw / mediaW, this.vh / mediaH) * 0.82;
    const baseW = mediaW * fit;
    const baseH = mediaH * fit;

    p.push();
    p.imageMode(p.CENTER);
    p.scale(1 + bass * 0.18 + this.beat * 0.05);
    p.rotateZ(Math.sin(this.phase * Math.PI * 2) * mid * 0.06);

    if (high > 0.05) {
      const offset = high * 26;
      p.push();
      p.tint(...this.colors.bass, 110);
      p.image(this.customMedia, -offset, 0, baseW, baseH);
      p.tint(...this.colors.high, 110);
      p.image(this.customMedia, offset, 0, baseW, baseH);
      p.pop();
    }

    p.noTint();
    p.image(this.customMedia, 0, 0, baseW, baseH);
    p.pop();

    // The one full-field luminance change in the product, and the reason
    // flashIntensity exists. Capped low: it is an accent on a photograph, not
    // a strobe. WCAG 2.3.1.
    const flash = this.beat;
    if (flash > 0.05) {
      p.push();
      p.noStroke();
      p.fill(255, 255, 255, flash * 55);
      p.rect(-this.w / 2, -this.h / 2, this.w, this.h);
      p.pop();
    }
  }

  // A geometric drop target rather than a line of text. p5's WEBGL text()
  // needs a loaded font file, and product principle 1 forbids fetching one at
  // showtime — the previous p.text() call drew nothing at all. The rail's own
  // status line carries the words.
  drawDropTarget(p) {
    const size = Math.min(this.vw, this.vh) * 0.24;
    const half = size / 2;
    // A shallow breath, not a fade to nothing. The first version dipped to an
    // alpha of four and vanished against a projected black — an affordance that
    // is only sometimes visible is not an affordance.
    const pulse = 0.85 + Math.sin(this.time * 1.2) * 0.15;
    const rgb = this.colors.mid;

    p.push();
    // A filled plate rather than a rounded outline: p5's WEBGL renderer drops
    // the stroke on a rect with a corner radius, so the outlined version drew
    // nothing at all.
    p.noStroke();
    p.fill(rgb[0], rgb[1], rgb[2], 46 * pulse);
    p.rect(-half, -half, size, size, 18);

    // Edges as four straight lines, which WEBGL does stroke.
    this.emissiveStroke(p, rgb, 130 * pulse, 1.5, () => {
      p.line(-half, -half, half, -half);
      p.line(half, -half, half, half);
      p.line(half, half, -half, half);
      p.line(-half, half, -half, -half);
    });

    this.emissiveStroke(p, rgb, 200 * pulse, 2, () => {
      p.line(-size * 0.18, 0, size * 0.18, 0);
      p.line(0, -size * 0.18, 0, size * 0.18);
    });
    p.pop();
  }

  /* ------------------------------------------------------------ media i/o */

  loadCustomMedia(file) {
    if (!this.p5Instance) return;

    this.clearCustomMedia();

    const url = URL.createObjectURL(file);
    this.customMediaURL = url;

    if (file.type.startsWith('video/')) {
      this.customMediaType = 'video';
      const video = this.p5Instance.createVideo([url], () => {
        video.volume(0);
        video.hide();
        if (this.currentMode === 'custom') video.loop();
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
          if (this.customMediaStatus) this.customMediaStatus.textContent = `Failed to load: ${file.name}`;
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
    this.spectrumPeaks = [];
    this.resetCollage();
  }

  destroy() {
    this.clearCustomMedia();
    if (this.collageCanvas) {
      this.collageCanvas.remove();
      this.collageCanvas = null;
      this.collageCtx = null;
    }
    if (this.p5Instance) {
      this.p5Instance.remove();
    }
  }
}
