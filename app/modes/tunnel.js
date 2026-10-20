import { emissiveStroke } from '../paint.js';

/* Tunnel Vision — travel at tempo.
 *
 * The rings advance by beat phase, so the tunnel moves a fixed distance per
 * beat and the travel locks to the track. Colour is by depth in frequency
 * order, near to far, so the tunnel is a spectrum you fly through. */

const RINGS = 18;
const SPACING = 90;

export default {
  id: 'tunnel',
  label: 'Tunnel Vision',

  draw(p, stage) {
    const bands = ['bass', 'mid', 'high'];
    const advance = ((stage.phase + stage.time * 0.05) % 1) * SPACING;

    for (let i = RINGS - 1; i >= 0; i--) {
      const depth = i / RINGS;
      const name = bands[Math.min(2, Math.floor(depth * 3))];
      const lit = stage.band(name);
      const rgb = stage.colors[name];

      const z = -i * SPACING + advance;
      // Fade the far end out rather than letting rings pop in at the horizon.
      const fade = 1 - depth * 0.75;
      const alpha = (35 + lit * 175) * fade;
      const radius = Math.min(stage.vw, stage.vh) * (0.16 + lit * 0.14);

      p.push();
      p.translate(0, 0, z);
      p.rotateZ(depth * 0.5 + stage.time * 0.08);
      emissiveStroke(p, rgb, alpha, 1.4 + lit * 3.4, () => p.circle(0, 0, radius * 2));
      p.pop();
    }
  }
};
