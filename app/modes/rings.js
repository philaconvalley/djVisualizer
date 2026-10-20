import { emissiveStroke } from '../paint.js';

/* Frequency Rings — the concentric readout.
 *
 * Three nested groups, one per band, inner to outer in frequency order so the
 * figure reads bass at the core and air at the edge. Three rings per band
 * instead of twelve undifferentiated ones: the point is legibility of state,
 * which is the craft bar's whole demand. */

export default {
  id: 'rings',
  label: 'Frequency Rings',

  draw(p, stage) {
    const bands = ['bass', 'mid', 'high'];
    const base = Math.min(stage.vw, stage.vh) * 0.11;

    bands.forEach((name, group) => {
      const lit = stage.band(name);
      const rgb = stage.colors[name];

      for (let i = 0; i < 3; i++) {
        const index = group * 3 + i;
        // Rings breathe out of phase with each other so the figure never reads
        // as one solid disc pumping.
        const offset = Math.sin(stage.phase * Math.PI * 2 - index * 0.4) * lit * base * 0.55;
        const radius = base * (1.1 + index * 0.72) + lit * base * 1.5 + offset;
        const alpha = (55 + lit * 175) * (1 - index * 0.06);

        p.push();
        // A slow tilt gives the rings a body. Tied to beat phase, so it turns
        // with the track rather than at an arbitrary rate.
        p.rotateX(Math.sin(stage.time * 0.25 + group) * 0.35);
        p.rotateZ(stage.phase * Math.PI * 0.5 + group * 0.6);
        emissiveStroke(p, rgb, alpha, 1.4 + lit * 3.2, () => p.circle(0, 0, radius * 2));
        p.pop();
      }
    });
  }
};
