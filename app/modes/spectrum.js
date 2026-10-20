import { GLOW, roundedRect } from '../paint.js';

/* Spectrum Bars — the instrument.
 *
 * Log-spaced across the audible range, because linear bins spend four fifths
 * of the screen width above 4 kHz where almost nothing happens, and squash
 * every kick and vocal into the leftmost inch. Peak-hold marks ride above the
 * bars: it is what a real mixer meter has, and it is the detail that makes
 * the mode read as an instrument rather than a decoration. Closes PHI-154 —
 * this used to be 256 DOM nodes restyled sixty times a second. */

const COUNT = 88;
const F_MIN = 20;
const F_MAX = 20000;

export default {
  id: 'spectrum',
  label: 'Spectrum Bars',

  // Peak-hold marks, one per bar. Fresh on every mode switch and every stop.
  setup: () => ({ peaks: new Array(COUNT).fill(0) }),

  draw(p, stage, memory) {
    const spec = stage.audio.spectrum;
    const binHz = stage.audio.binHz;
    if (!spec || spec.length === 0 || !binHz) return;

    const ratio = Math.pow(F_MAX / F_MIN, 1 / COUNT);

    const width = stage.vw * 0.9;
    const left = -width / 2;
    const slot = width / COUNT;
    const barW = slot * 0.62;
    const floorY = stage.vh / 2 - stage.vh * 0.06;
    const maxH = stage.vh * 0.74;
    const peaks = memory.peaks;

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

      const lit = Math.max(stage.level(value), stage.idle * 0.6);
      const rgb = stage.colors[stage.bandAt((fLow + fHigh) / 2)];
      const x = left + i * slot + slot / 2;
      const barH = Math.max(2, lit * maxH);

      // Peak hold falls under gravity rather than tracking the signal down.
      peaks[i] = Math.max(peaks[i] - 0.5 * (1 / 60), lit);

      p.push();
      p.translate(x, floorY - barH / 2);
      p.noStroke();
      for (const [ws, as] of GLOW) {
        p.fill(rgb[0], rgb[1], rgb[2], (70 + lit * 170) * as);
        roundedRect(p, (-barW * ws) / 2, -barH / 2, barW * ws, barH, barW / 2);
      }
      p.pop();

      const peakY = floorY - Math.max(2, peaks[i] * maxH);
      p.noStroke();
      p.fill(255, 255, 255, 120 + peaks[i] * 100);
      p.rect(x - barW / 2, peakY - 1, barW, 2);
    }
  }
};
