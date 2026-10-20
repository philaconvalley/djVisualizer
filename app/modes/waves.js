import { BANDS } from '../audioProcessor.js';
import { emissiveStroke } from '../paint.js';

/* Wave Forms — three bands as three waveforms.
 *
 * The shape is read out of the band's own spectrum slice rather than from a
 * sine wave, so what is on screen is the sound and not an animation timed to
 * arrive alongside it. Bass sits low and slow, highs sit high and fine. */

export default {
  id: 'waves',
  label: 'Wave Forms',

  draw(p, stage) {
    const spec = stage.audio.spectrum;
    const binHz = stage.audio.binHz;
    const layout = [
      { name: 'bass', y: stage.vh * 0.24, step: 14, wobble: 0.9 },
      { name: 'mid', y: 0, step: 9, wobble: 1.6 },
      { name: 'high', y: -stage.vh * 0.24, step: 6, wobble: 2.6 }
    ];

    for (const row of layout) {
      const lit = stage.band(row.name);
      const rgb = stage.colors[row.name];
      const amp = lit * stage.vh * 0.2;
      const bounds = BANDS.find((b) => b.name === row.name) || null;

      let first = 1,
        last = 1;
      if (bounds && binHz && spec && spec.length) {
        first = Math.max(1, Math.round(bounds.from / binHz));
        last = Math.min(spec.length - 1, Math.round(bounds.to / binHz));
      }
      const span = Math.max(1, last - first);

      emissiveStroke(p, rgb, 70 + lit * 165, 1.6 + lit * 2.6, () => {
        p.beginShape();
        for (let x = -stage.vw / 2; x <= stage.vw / 2; x += row.step) {
          const t = (x + stage.vw / 2) / stage.vw;

          // The band's own bins drive the shape; the travelling term only moves
          // it, and its amplitude is a fraction of the signal's, never a
          // substitute for it.
          let detail = 0;
          if (spec && spec.length) {
            const bin = first + Math.floor(t * span);
            detail = ((spec[bin] || 0) - 0.5) * 2;
          }
          const travel = Math.sin(t * Math.PI * 2 * row.wobble + stage.phase * Math.PI * 2);
          p.vertex(x, row.y + detail * amp + travel * amp * 0.35);
        }
        p.endShape();
      });
    }
  }
};
