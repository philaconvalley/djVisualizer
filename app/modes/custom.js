import { emissiveStroke } from '../paint.js';

/* Custom Upload — the operator's own image, reacting.
 *
 * Bass scales, mid tilts, high splits the image into band-tinted copies. The
 * split uses the band tokens, so even an arbitrary uploaded photograph is
 * annotated in the product's own colour language.
 *
 * Two flags make this mode different from the rest. `usesMedia` tells the app
 * to show the upload control and the visualizer to play an uploaded video only
 * while this mode is up; the visualizer owns the file, and hands the loaded
 * image or video in as `stage.media`. `additive: false` turns off the additive
 * blending every other mode uses: a photograph is not a light source, and
 * additive blending would blow it out. */

export default {
  id: 'custom',
  label: 'Custom Upload',
  usesMedia: true,
  additive: false,

  draw(p, stage) {
    const media = stage.media;
    if (!media) {
      drawDropTarget(p, stage);
      return;
    }

    const bass = stage.band('bass');
    const mid = stage.band('mid');
    const high = stage.band('high');

    const mediaW = media.width || 1;
    const mediaH = media.height || 1;
    const fit = Math.min(stage.vw / mediaW, stage.vh / mediaH) * 0.82;
    const baseW = mediaW * fit;
    const baseH = mediaH * fit;

    p.push();
    p.imageMode(p.CENTER);
    p.scale(1 + bass * 0.18 + stage.beat * 0.05);
    p.rotateZ(Math.sin(stage.phase * Math.PI * 2) * mid * 0.06);

    if (high > 0.05) {
      const offset = high * 26;
      p.push();
      p.tint(...stage.colors.bass, 110);
      p.image(media, -offset, 0, baseW, baseH);
      p.tint(...stage.colors.high, 110);
      p.image(media, offset, 0, baseW, baseH);
      p.pop();
    }

    // tint(255), never noTint(). In p5 1.9.0 noTint() sets the renderer's tint
    // to null, and the WEBGL renderer hands that null to its uTint uniform and
    // throws. p5 then stops its draw loop, so the stage froze on the first
    // frame of any uploaded image. Full white is the same "no tint". PHI-222.
    p.tint(255);
    p.image(media, 0, 0, baseW, baseH);
    p.pop();

    // The one full-field luminance change in the product, and the reason
    // flashIntensity exists. Capped low: it is an accent on a photograph, not
    // a strobe. WCAG 2.3.1.
    const flash = stage.beat;
    if (flash > 0.05) {
      p.push();
      p.noStroke();
      p.fill(255, 255, 255, flash * 55);
      p.rect(-stage.w / 2, -stage.h / 2, stage.w, stage.h);
      p.pop();
    }
  }
};

// A geometric drop target rather than a line of text. p5's WEBGL text()
// needs a loaded font file, and product principle 1 forbids fetching one at
// showtime — the previous p.text() call drew nothing at all. The rail's own
// status line carries the words.
function drawDropTarget(p, stage) {
  const size = Math.min(stage.vw, stage.vh) * 0.24;
  const half = size / 2;
  // A shallow breath, not a fade to nothing. The first version dipped to an
  // alpha of four and vanished against a projected black — an affordance that
  // is only sometimes visible is not an affordance.
  const pulse = 0.85 + Math.sin(stage.time * 1.2) * 0.15;
  const rgb = stage.colors.mid;

  p.push();
  // A filled plate rather than a rounded outline: p5's WEBGL renderer drops
  // the stroke on a rect with a corner radius, so the outlined version drew
  // nothing at all.
  p.noStroke();
  p.fill(rgb[0], rgb[1], rgb[2], 46 * pulse);
  p.rect(-half, -half, size, size, 18);

  // Edges as four straight lines, which WEBGL does stroke.
  emissiveStroke(p, rgb, 130 * pulse, 1.5, () => {
    p.line(-half, -half, half, -half);
    p.line(half, -half, half, half);
    p.line(half, half, -half, half);
    p.line(-half, half, -half, -half);
  });

  emissiveStroke(p, rgb, 200 * pulse, 2, () => {
    p.line(-size * 0.18, 0, size * 0.18, 0);
    p.line(0, -size * 0.18, 0, size * 0.18);
  });
  p.pop();
}
