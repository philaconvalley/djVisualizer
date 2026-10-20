/* The mode registry — the one list of visualization modes.
 *
 * The dropdown, the number keys, the `?modes=` show list, and the sandbox's
 * `mode` attribute all read this array. Adding a mode is one new file in this
 * folder plus two lines below: its import, and its place in MODES. Nothing
 * else needs an edit. The order here is
 * the dropdown order, and keys 1-9 then 0 follow it. PHI-163.
 *
 * The contract. A mode is a plain object:
 *
 *   id                 Required. Short lowercase name: the dropdown value, the
 *                      `?modes=` word, and the sandbox `mode` attribute.
 *   label              Required. What the dropdown shows.
 *   draw(p, stage, memory)
 *                      Required. Called once a frame while the stage runs.
 *                      `p` is the p5 instance, in WEBGL, with the origin at
 *                      the centre of the space above the rail. `stage` is the
 *                      shared state below. `memory` is what setup() returned.
 *   setup(stage)       Optional. Returns this mode's own state as an object.
 *                      Runs on the first frame after the mode is chosen, and
 *                      again after a resize or a stop. No setup means `{}`.
 *   clearsBackground   Optional, default true. false keeps the WEBGL canvas
 *                      transparent and gives the mode a 2D canvas underneath
 *                      as `stage.layer`, which it paints and nothing clears
 *                      between frames. Polygon Collage uses this.
 *   additive           Optional, default true. false turns off additive
 *                      blending, for a mode that shows pictures, not light.
 *   usesMedia          Optional, default false. true shows the upload control
 *                      and gives the mode the uploaded file as `stage.media`.
 *
 * What `stage` carries, and nothing else, by design. A mode that needs more
 * is a question for the shared contract, not a reason to reach past it:
 *
 *   colors.bass|mid|high   [r, g, b] from the CSS band tokens
 *   band(name)             a band's level, 0..1, through the one response law
 *   level(value)           the response law for any raw 0..1 value
 *   bandAt(hz)             which band owns a frequency
 *   idle                   the shared silent breath, 0..0.1
 *   audio                  raw analysis: spectrum, binHz, bpm, bass, mid, high
 *   beat                   0..1, struck on a detected kick, already safety-capped
 *   phase                  0..1 through the current beat
 *   beatPeriod             seconds per beat
 *   time                   seconds since the stage started
 *   w, h                   the canvas size
 *   vw, vh                 the composition box: the canvas minus the rail
 *   railH                  the rail's height
 *   layer                  { canvas, ctx }, only when clearsBackground is false
 *   media                  the loaded image or video, only when usesMedia is true
 *
 * The drawing helpers (emissiveStroke, emissiveDot, roundedRect, GLOW) are in
 * ../paint.js. Import them directly. The stage grammar every mode obeys is in
 * the header of ../visualizer.js and in DESIGN.md.
 */

import spectrum from './spectrum.js';
import particles from './particles.js';
import rings from './rings.js';
import waves from './waves.js';
import mandala from './mandala.js';
import tunnel from './tunnel.js';
import galaxy from './galaxy.js';
import polygons from './polygons.js';
import custom from './custom.js';
import flow from './flow.js';

export const MODES = [
  spectrum,
  particles,
  rings,
  waves,
  mandala,
  tunnel,
  galaxy,
  polygons,
  custom,
  flow
];

// A mistake in a new mode's file fails here, at load, with its name — not as a
// mode that silently never draws. Two modes with one id would leave one of
// them unreachable from the dropdown.
const seen = new Set();
for (const mode of MODES) {
  if (!mode || typeof mode.id !== 'string' || !mode.id) {
    throw new Error('A mode in app/modes/index.js has no id.');
  }
  if (typeof mode.label !== 'string' || typeof mode.draw !== 'function') {
    throw new Error(`Mode "${mode.id}" needs a label and a draw(p, stage, memory) function.`);
  }
  if (seen.has(mode.id)) throw new Error(`Two modes use the id "${mode.id}".`);
  seen.add(mode.id);
}
