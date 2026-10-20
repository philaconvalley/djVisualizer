import { emissiveDot } from '../paint.js';

/* Galaxy — spiral arms brightening by band.
 *
 * Radius carries frequency: bass at the core, air at the rim. The arms turn
 * on beat phase, and each point's brightness is its band's level, so a bass
 * drop lights the centre and a hi-hat pattern lights the edge. */

const ARMS = 3;
const POINTS = 42;

export default {
  id: 'galaxy',
  label: 'Galaxy',

  draw(p, stage) {
    const bands = ['bass', 'mid', 'high'];
    const reach = Math.min(stage.vw, stage.vh) * 0.44;

    for (let arm = 0; arm < ARMS; arm++) {
      p.push();
      p.rotateZ(stage.phase * Math.PI * 0.35 + (arm / ARMS) * Math.PI * 2);

      for (let i = 0; i < POINTS; i++) {
        const t = i / POINTS;
        const name = bands[Math.min(2, Math.floor(t * 3))];
        const lit = stage.band(name);
        const rgb = stage.colors[name];

        const angle = t * Math.PI * 2.4;
        const radius = t * reach * (1 + lit * 0.22);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        // The arm thins as it reaches out, the way a real one does.
        const alpha = (45 + lit * 190) * (1 - t * 0.45);
        const size = (2.5 + lit * 14) * (1 - t * 0.4);

        p.push();
        p.translate(x, y, 0);
        emissiveDot(p, rgb, alpha, size);
        p.pop();
      }
      p.pop();
    }

    // A core that answers the kick. One element carrying the whole low end is
    // the composition's anchor; without it the spiral has no centre of gravity.
    const core = stage.band('bass');
    emissiveDot(
      p,
      stage.colors.bass,
      70 + core * 150 + stage.beat * 40,
      reach * (0.06 + core * 0.09)
    );
  }
};
