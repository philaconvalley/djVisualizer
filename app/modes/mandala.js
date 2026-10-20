import { emissiveStroke } from '../paint.js';

/* Mandala — radial symmetry, struck on the beat.
 *
 * Spoke count comes from the band's energy, so the figure gains and loses
 * structure with the music rather than spinning at a constant density. The
 * rotation is beat-phase driven: it completes a turn per bar, not per
 * arbitrary interval. */

export default {
  id: 'mandala',
  label: 'Mandala',

  draw(p, stage) {
    const bands = ['bass', 'mid', 'high'];
    const radius = Math.min(stage.vw, stage.vh) * 0.42;

    p.push();
    p.rotateZ(stage.phase * Math.PI * 0.5);

    bands.forEach((name, ring) => {
      const lit = stage.band(name);
      const rgb = stage.colors[name];
      const spokes = 6 + Math.round(lit * 18);
      const inner = radius * (0.16 + ring * 0.24);
      const outer = inner + radius * (0.2 + lit * 0.42);
      const alpha = 60 + lit * 170;

      p.push();
      // Alternating direction keeps the three rings from fusing into one wheel.
      p.rotateZ((ring % 2 ? -1 : 1) * (stage.time * 0.12 + ring));

      for (let i = 0; i < spokes; i++) {
        p.push();
        p.rotateZ((i / spokes) * Math.PI * 2);
        // Struck spokes: every fourth one extends on the beat, which gives the
        // figure an accent instead of a uniform pulse.
        const struck = i % 4 === 0 ? stage.beat * radius * 0.18 : 0;
        emissiveStroke(p, rgb, alpha, 1.2 + lit * 2.4, () => p.line(inner, 0, outer + struck, 0));
        p.pop();
      }
      p.pop();
    });

    p.pop();
  }
};
