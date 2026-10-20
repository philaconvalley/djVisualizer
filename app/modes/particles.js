import { emissiveDot } from '../paint.js';

/* Floating Particles — the room's dust.
 *
 * Depth carries the band: bass sits far and heavy, highs sit near and quick.
 * Sorted back to front so the additive halos layer correctly, and billboarded
 * circles rather than lit spheres — 36 spheres was two thousand quads a frame
 * for a shape the camera can only ever see as a disc. */

export default {
  id: 'particles',
  label: 'Floating Particles',

  // Fewer than before, and deliberately. Reduction is the direction: a field
  // that breathes reads as composed, a field that fills reads as noise. Runs
  // again on a resize, so the field always spans the new composition box.
  setup(stage) {
    const particles = [];
    for (let i = 0; i < 36; i++) {
      particles.push({
        x: (Math.random() - 0.5) * stage.vw,
        y: (Math.random() - 0.5) * stage.vh,
        z: (Math.random() - 0.5) * 600,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        vz: (Math.random() - 0.5) * 0.5,
        seed: Math.random() * Math.PI * 2,
        size: Math.random() * 3 + 2
      });
    }
    return { particles };
  },

  draw(p, stage, memory) {
    const bass = stage.band('bass'),
      mid = stage.band('mid'),
      high = stage.band('high');
    const drift = 0.4 + stage.beat * 0.8;

    for (const particle of memory.particles) {
      particle.x += particle.vx * (1 + bass * 6) * drift;
      particle.y += particle.vy * (1 + mid * 5) * drift;
      particle.z += particle.vz * (1 + high * 7) * drift;

      const halfW = stage.vw / 2,
        halfH = stage.vh / 2;
      if (particle.x > halfW) particle.x = -halfW;
      if (particle.x < -halfW) particle.x = halfW;
      if (particle.y > halfH) particle.y = -halfH;
      if (particle.y < -halfH) particle.y = halfH;
      if (particle.z > 300) particle.z = -300;
      if (particle.z < -300) particle.z = 300;
    }

    const ordered = [...memory.particles].sort((a, b) => a.z - b.z);
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
      emissiveDot(p, stage.colors[name], alpha, size);
      p.pop();
    });
  }
};
