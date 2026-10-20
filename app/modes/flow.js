import { emissiveDot, emissiveStroke } from '../paint.js';

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

const BANDS = ['bass', 'mid', 'high'];

export default {
  id: 'flow',
  label: 'Flow',

  draw(p, stage) {
    const levels = { bass: stage.band('bass'), mid: stage.band('mid'), high: stage.band('high') };

    drawStreams(p, stage, levels);
    drawNodes(p, stage, levels);
    drawWaves(p, stage, levels);
  }
};

// Streams travelling across the frame, one set per band, each band crossing
// on its own diagonal so the three read as separate currents in one system.
function drawStreams(p, stage, levels) {
  const STREAMS = 3;
  const STEPS = 48;
  const paths = {
    bass: { from: stage.vh * 0.22, to: -stage.vh * 0.22, reverse: false, sway: 0.42 },
    mid: { from: 0, to: 0, reverse: false, sway: 0.5 },
    high: { from: -stage.vh * 0.22, to: stage.vh * 0.22, reverse: true, sway: 0.34 }
  };

  for (let stream = 0; stream < STREAMS; stream++) {
    const offset = (stream / STREAMS) * Math.PI * 2;

    for (const name of BANDS) {
      const lit = levels[name];
      const path = paths[name];
      // One full sway per beat, on the beat clock. A whole cycle per beat
      // means no visible jump when phase wraps from 1 back to 0.
      const drift = stage.phase * Math.PI * 2 + offset;

      emissiveStroke(p, stage.colors[name], 60 + lit * 165, 1.3 + lit * 2.2, () => {
        p.beginShape();
        for (let i = 0; i <= STEPS; i++) {
          const t = i / STEPS;
          const along = path.reverse ? 1 - t : t;
          const x = (along - 0.5) * stage.vw + Math.sin(drift + t * 5) * lit * stage.vw * 0.05;
          const y =
            path.from +
            (path.to - path.from) * t +
            Math.cos(drift + t * 4) * lit * stage.vh * path.sway * 0.2;
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
function drawNodes(p, stage, levels) {
  const NODES = 12;
  const radius = Math.min(stage.vw, stage.vh) * 0.3;
  const spin = stage.phase * Math.PI * 0.5;

  for (let i = 0; i < NODES; i++) {
    const name = BANDS[Math.min(2, Math.floor((i / NODES) * 3))];
    const lit = levels[name];
    const rgb = stage.colors[name];

    const angle = (i / NODES) * Math.PI * 2 + spin;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    // Links first, so the nodes sit on top of their own connections.
    if (lit > 0.08) {
      const next = (i + 1) % NODES;
      const nextAngle = (next / NODES) * Math.PI * 2 + spin;
      emissiveStroke(p, rgb, 40 + lit * 110, 0.8 + lit * 2, () => {
        p.line(x, y, Math.cos(nextAngle) * radius, Math.sin(nextAngle) * radius);
      });
    }

    p.push();
    p.translate(x, y, 0);
    emissiveDot(p, rgb, 70 + lit * 170, 5 + lit * 20 + stage.beat * 5);
    p.pop();
  }
}

// Stacked waves under the ring. Two layers rather than the original three:
// the emissive passes trebled the line count, and the field reads better with
// room to breathe than it did filled.
function drawWaves(p, stage, levels) {
  const POINTS = 40;
  const rows = { bass: stage.vh * 0.3, mid: stage.vh * 0.02, high: -stage.vh * 0.3 };

  // One full cycle per beat, on the beat clock, so there is no jump when
  // phase wraps. The two terms travel in opposite directions: the original
  // gave them different wall-clock speeds, and the interference between
  // them is what makes the line look like water rather than a sliding sine.
  const beat = stage.phase * Math.PI * 2;

  for (let layer = 0; layer < 2; layer++) {
    const layerOffset = layer * 0.4;

    for (const name of BANDS) {
      const lit = levels[name];
      const baseY = rows[name] - layer * stage.vh * 0.035;
      const amp = lit * stage.vh * 0.11;

      emissiveStroke(
        p,
        stage.colors[name],
        (45 + lit * 120) * (1 - layer * 0.3),
        1.1 + lit * 1.6,
        () => {
          p.beginShape();
          for (let i = 0; i < POINTS; i++) {
            const x = (i / (POINTS - 1) - 0.5) * stage.vw;
            const wave = Math.sin(i * 0.25 + beat + layerOffset) * amp;
            const flow = Math.cos(i * 0.18 - beat) * amp * 0.35;
            p.vertex(x, baseY + wave + flow);
          }
          p.endShape();
        }
      );
    }
  }
}
