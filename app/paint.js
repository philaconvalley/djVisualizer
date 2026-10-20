/* Paint — the drawing helpers every mode shares.
 *
 * These are rule 2 of the stage grammar (light, not ink) as code. They take
 * the p5 instance and nothing else, so a mode can import them without
 * reaching into the visualizer.
 */

// The whole art direction in one table. Three passes — wide and faint, then
// middle, then tight and bright — turn a 2px stroke into something with a core
// and a halo. It is the cheapest thing that reads as light instead of ink, and
// it needs no shader, which the zero-build constraint forbids.
// Each entry is [width scale, alpha scale].
export const GLOW = [
  [4.0, 0.1],
  [2.1, 0.22],
  [1.0, 1.0]
];

export function emissiveStroke(p, rgb, alpha, weight, shape) {
  p.noFill();
  for (const [ws, as] of GLOW) {
    p.stroke(rgb[0], rgb[1], rgb[2], alpha * as);
    p.strokeWeight(Math.max(0.4, weight * ws));
    shape();
  }
}

export function emissiveDot(p, rgb, alpha, diameter, x = 0, y = 0) {
  p.noStroke();
  for (const [ws, as] of GLOW) {
    p.fill(rgb[0], rgb[1], rgb[2], alpha * as);
    p.circle(x, y, Math.max(0.5, diameter * ws));
  }
}

/* A rounded rect that p5 can draw from its geometry cache.
 *
 * p5 1.9's WEBGL renderer tessellates a rect with a corner radius from
 * scratch on every call. Spectrum Bars drew 264 of them a frame, which took
 * 29 ms and held the mode at 27 FPS on an M1 Max. Plain rects and fixed-angle
 * arcs are built once and reused, so the same shape is assembled from three
 * rects and four quarter discs. The parts meet edge to edge and never overlap,
 * because under additive blending an overlap would draw a bright seam. PHI-266.
 */
export function roundedRect(p, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) {
    p.rect(x, y, w, h);
    return;
  }
  const d = r * 2;
  const right = x + w - r;
  const bottom = y + h - r;

  if (w > d) p.rect(x + r, y, w - d, h);
  if (h > d) {
    p.rect(x, y + r, r, h - d);
    p.rect(right, y + r, r, h - d);
  }
  p.arc(x + r, y + r, d, d, Math.PI, Math.PI * 1.5, p.PIE);
  p.arc(right, y + r, d, d, Math.PI * 1.5, Math.PI * 2, p.PIE);
  p.arc(right, bottom, d, d, 0, Math.PI / 2, p.PIE);
  p.arc(x + r, bottom, d, d, Math.PI / 2, Math.PI, p.PIE);
}
