/* Flash guard — the last stage of the render path. PHI-265.
 *
 * It has its own file now that the app is ES modules. visualizer.js imports
 * it, so every page that draws the stage — the app, the sandbox, and the
 * student pens on CodePen (docs/workshop/codepen/head.html) — gets it with no
 * extra script tag. The pens are exactly where the ceiling has to hold. It
 * touches no browser API when it loads, so Node tests import it directly.
 *
 * WCAG 2.1 success criterion 2.3.1: no more than three flashes in any one
 * second. A flash is a pair of opposing changes in luminance, so three flashes
 * is six transitions. Viewers at a public installation did not opt in and
 * cannot easily look away, so the ceiling is not optional.
 *
 * Why it reads pixels instead of gating the beat. A limiter only bounds what
 * flows through it. Gating `beat` would miss every source that does not pass
 * through `beat` — an uploaded video that strobes by itself, a band level
 * swinging on a hi-hat, a mode added next year. The one place every source
 * passes through is the frame the viewer sees, so the guard measures that
 * frame and dims it before the browser presents it. It is a ceiling, not a
 * setting: nothing in the UI can raise it.
 *
 * Two rules, measured separately, as the spec asks:
 *   - General flash: mean relative luminance changes by 0.1 or more.
 *   - Red flash: the saturated-red measure changes by 20 or more. WCAG's
 *     definition: a pixel counts when R / (R + G + B) >= 0.8, and its value is
 *     (R - G - B) * 320, with channels in sRGB 0..1.
 *
 * Where it measures. WCAG counts a flash once it covers a quarter of the
 * central ten degrees of vision — 341 x 256 pixels on a 1024 x 768 screen, a
 * third of each dimension. A mean over the whole canvas dilutes a flash that
 * size: a patch a ninth of the screen can swing hard while the whole-screen
 * mean barely moves. So the guard measures overlapping regions a third of the
 * width by a third of the height, half a region apart, and every region keeps
 * its own count. A flash anywhere that size or larger lands mostly inside at
 * least one region. A whole-screen flash lands in all of them.
 *
 * How the cap works. Falls toward dark are always allowed — darkening is never
 * the risk. A rise that would complete a transition is allowed only while the
 * last second holds four transitions or fewer, so the rise and the fall that
 * must follow it still fit inside six. Otherwise the guard dims the frame so
 * that region stays just under the threshold above its last low point. The
 * veil covers the whole frame; dimming only the region would draw a visible
 * box. The music keeps playing; the screen holds a steady level until the
 * window has room again.
 */

// sRGB channel (0..255) to linear light, as a lookup table. Relative luminance
// is defined on linear light, and the conversion runs thousands of times a frame.
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Counts transitions in one measure and says how high the next frame may go.
class TransitionCounter {
  constructor(threshold) {
    this.threshold = threshold;
    this.rising = false; // false: tracking a low point; true: tracking a high point
    this.low = null;
    this.high = null;
    this.times = [];
  }

  prune(now) {
    while (this.times.length && this.times[0] <= now - FlashGuard.WINDOW_MS) this.times.shift();
  }

  count(now) {
    this.prune(now);
    return this.times.length;
  }

  // The highest value the next frame may show. Infinity when a rise is allowed.
  ceiling(now) {
    if (this.rising || this.low === null) return Infinity;
    // A rise needs room for itself and for the fall that follows it.
    if (this.count(now) <= FlashGuard.MAX_FLASHES * 2 - 2) return Infinity;
    return this.low + this.threshold * FlashGuard.MARGIN;
  }

  observe(value, now) {
    this.prune(now);
    if (this.low === null) {
      this.low = this.high = value;
      return;
    }
    if (!this.rising) {
      this.low = Math.min(this.low, value);
      if (value - this.low >= this.threshold) {
        this.times.push(now);
        this.rising = true;
        this.high = value;
      }
    } else {
      this.high = Math.max(this.high, value);
      if (this.high - value >= this.threshold) {
        this.times.push(now);
        this.rising = false;
        this.low = value;
      }
    }
  }
}

// One luminance counter and one red counter per region.
class RegionCounters {
  constructor(count) {
    this.luminance = [];
    this.red = [];
    for (let i = 0; i < count; i++) {
      this.luminance.push(new TransitionCounter(FlashGuard.LUMINANCE_THRESHOLD));
      this.red.push(new TransitionCounter(FlashGuard.RED_THRESHOLD));
    }
  }

  // Flashes in the worst region over the last second. Half a flash still
  // counts against the ceiling, so five transitions read as three.
  worst(counters, now) {
    let most = 0;
    for (const counter of counters) most = Math.max(most, counter.count(now));
    return Math.ceil(most / 2);
  }
}

class FlashGuard {
  static WINDOW_MS = 1000;
  static MAX_FLASHES = 3;
  static LUMINANCE_THRESHOLD = 0.1;
  static RED_THRESHOLD = 20;
  // Hold a blocked frame at 80% of the threshold, not at it, so rounding in
  // the blend and the sample never tips a held frame over into a transition.
  static MARGIN = 0.8;
  // The WCAG area, as a fraction of each dimension, and the step between
  // neighbouring regions. Half a region apart means any patch that size
  // overlaps some region by at least half its area.
  static REGION = 1 / 3;
  static STEP = 1 / 6;

  constructor() {
    this.layout = '';
    this.regions = [];
    this.counters = null;
  }

  // Overlapping rectangles, in grid cells, covering the whole grid edge to edge.
  static regionsFor(cols, rows) {
    const span = (size) => {
      const length = Math.max(1, Math.round(size * FlashGuard.REGION));
      const step = Math.max(1, Math.round(size * FlashGuard.STEP));
      const count = Math.ceil((size - length) / step) + 1;
      const starts = [];
      for (let i = 0; i < count; i++) {
        starts.push(count === 1 ? 0 : Math.round((i * (size - length)) / (count - 1)));
      }
      return { length, starts };
    };
    const across = span(cols);
    const down = span(rows);
    const regions = [];
    for (const y of down.starts) {
      for (const x of across.starts) regions.push({ x, y, w: across.length, h: down.length });
    }
    return regions;
  }

  // Mean relative luminance of one region, every channel scaled by `k`.
  static luminanceOf(pixels, cols, region, k = 1) {
    let sum = 0;
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let i = (y * cols + region.x) * 4, end = i + region.w * 4; i < end; i += 4) {
        sum +=
          0.2126 * SRGB_TO_LINEAR[Math.round(pixels[i] * k)] +
          0.7152 * SRGB_TO_LINEAR[Math.round(pixels[i + 1] * k)] +
          0.0722 * SRGB_TO_LINEAR[Math.round(pixels[i + 2] * k)];
      }
    }
    return sum / (region.w * region.h);
  }

  // Mean saturated-red measure of one region. Scaling every channel by `k`
  // keeps R / (R + G + B) and scales R - G - B, so the veil scales this
  // linearly and it never needs a search.
  static redOf(pixels, cols, region) {
    let sum = 0;
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let i = (y * cols + region.x) * 4, end = i + region.w * 4; i < end; i += 4) {
        const r = pixels[i],
          g = pixels[i + 1],
          b = pixels[i + 2];
        const total = r + g + b;
        if (total > 0 && r / total >= 0.8) sum += Math.max(0, ((r - g - b) / 255) * 320);
      }
    }
    return sum / (region.w * region.h);
  }

  // A resize changes what a region covers, so its history no longer applies.
  ensureLayout(cols, rows) {
    const layout = `${cols}x${rows}`;
    if (layout === this.layout) return;
    this.layout = layout;
    this.regions = FlashGuard.regionsFor(cols, rows);
    this.counters = new RegionCounters(this.regions.length);
  }

  // Takes the frame as it would be shown and returns the brightness scale to
  // apply to it: 1 leaves it alone, 0.4 dims every channel to 40%.
  process(pixels, cols, rows, now) {
    this.ensureLayout(cols, rows);
    const { regions, counters } = this;
    const raw = regions.map((region) => ({
      luminance: FlashGuard.luminanceOf(pixels, cols, region),
      red: FlashGuard.redOf(pixels, cols, region)
    }));

    let scale = 1;
    regions.forEach((region, i) => {
      const lumCeiling = counters.luminance[i].ceiling(now);
      // Luminance is not linear in the channel values, so search for the
      // brightest scale that keeps this region under its ceiling. Twelve
      // halvings is finer than one 8-bit step. Skipped when the scale already
      // chosen for another region is enough.
      if (
        raw[i].luminance > lumCeiling &&
        FlashGuard.luminanceOf(pixels, cols, region, scale) > lumCeiling
      ) {
        let lo = 0,
          hi = scale;
        for (let step = 0; step < 12; step++) {
          const mid = (lo + hi) / 2;
          if (FlashGuard.luminanceOf(pixels, cols, region, mid) <= lumCeiling) lo = mid;
          else hi = mid;
        }
        scale = lo;
      }
      const redCeiling = counters.red[i].ceiling(now);
      if (raw[i].red > redCeiling) scale = Math.min(scale, redCeiling / raw[i].red);
    });

    const shown = regions.map((region, i) => ({
      luminance:
        scale === 1 ? raw[i].luminance : FlashGuard.luminanceOf(pixels, cols, region, scale),
      red: raw[i].red * scale
    }));
    shown.forEach((value, i) => {
      counters.luminance[i].observe(value.luminance, now);
      counters.red[i].observe(value.red, now);
    });

    return { scale, raw, shown };
  }
}

/* Flash meter — counts what was actually shown. Measurement only; it never
 * changes a frame. It reads the canvas a second time, after the veil, so it
 * checks the guard instead of trusting the guard's own arithmetic. Load the
 * app with ?flashlog to turn it on. */
class FlashMeter {
  constructor() {
    this.layout = '';
    this.worst = { flashes: 0, redFlashes: 0, rawFlashes: 0, rawRedFlashes: 0 };
    this.frames = 0;
    this.veiledFrames = 0;
    // The last second only, for the log: frame rate and the guard's own cost.
    this.second = { frames: 0, veiledFrames: 0, guardMs: 0 };
  }

  // Raw values come from the guard: what the modes asked for, before the veil.
  observe(shownPixels, cols, rows, guardResult, now, guardMs) {
    const layout = `${cols}x${rows}`;
    if (layout !== this.layout) {
      this.layout = layout;
      this.regions = FlashGuard.regionsFor(cols, rows);
      this.shown = new RegionCounters(this.regions.length);
      this.raw = new RegionCounters(this.regions.length);
    }
    this.frames++;
    this.second.frames++;
    this.second.guardMs += guardMs;
    if (guardResult.scale < 1) {
      this.veiledFrames++;
      this.second.veiledFrames++;
    }

    this.regions.forEach((region, i) => {
      this.shown.luminance[i].observe(FlashGuard.luminanceOf(shownPixels, cols, region), now);
      this.shown.red[i].observe(FlashGuard.redOf(shownPixels, cols, region), now);
      this.raw.luminance[i].observe(guardResult.raw[i].luminance, now);
      this.raw.red[i].observe(guardResult.raw[i].red, now);
    });

    const w = this.worst;
    w.flashes = Math.max(w.flashes, this.shown.worst(this.shown.luminance, now));
    w.redFlashes = Math.max(w.redFlashes, this.shown.worst(this.shown.red, now));
    w.rawFlashes = Math.max(w.rawFlashes, this.raw.worst(this.raw.luminance, now));
    w.rawRedFlashes = Math.max(w.rawRedFlashes, this.raw.worst(this.raw.red, now));
  }
}

export { FlashGuard, FlashMeter };
