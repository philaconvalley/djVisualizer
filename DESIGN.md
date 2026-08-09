# Design

<!-- impeccable:design-schema 1 -->

Recorded from the built world on 2026-08-09, not from intention. `PRODUCT.md` owns product truth; `RESOURCES.md` remains authoritative for architecture, setup, and troubleshooting. This file owns durable visual and behavioural decisions.

## Direction

**Pinned world:** Apple, in the Control Center / iOS glass register. Pinned by the user; a pin beats the concept roll. Seed key `dc6e49df` recorded in the direction contract at the top of `index.html` body and superseded by the pin.

**Reduction target:** Radiooooo. The content surface is the interface. Few controls, each large and unambiguous, no chrome furniture.

**Craft bar:** Logic Pro, Ableton Live, Serato. These set *quality* — precision of control and clarity of state — not density. Where reduction and craft bar conflict, reduction decides how many controls exist and the craft bar decides how good each survivor must be.

**Thesis:** the visualization is the interface. One persistent translucent console floats over a full-bleed canvas. This refuses the incumbent arrangement of a 300px opaque six-section panel beside a boxed stage.

**Standing constraint from the user:** the chrome is **always visible**. No auto-hide, no hover-to-reveal, no idle timer. Fullscreen means removing the browser's chrome, never the app's.

## Surfaces and modes

| Surface | Mode | Notes |
| --- | --- | --- |
| Operator console (the rail) | Operate | Task and state outrank expression. |
| Stage / installation | Experience | The artifact leads; the interface recedes to one rail. |

## Colors

All tokens live at `:root` in `styles/styles.css`. Palette and typography are deliberately tokenized so a future PhilaCon Valley brand kit applies as a token change, not a rewrite.

Color strategy is **Restrained**: a near-black ground and one frosted neutral material, with saturation reserved entirely for the three bands. Nothing else on the surface is allowed to be saturated — that is what makes the bands read as the product's idea rather than as decoration.

### Ground and material

| Token | Value | Role |
| --- | --- | --- |
| `--stage` | `#000000` | Canvas ground. True black: the use scene is a dark venue with a projected surface. |
| `--material` | `rgba(28, 28, 30, 0.86)` | The single frosted console material. |
| `--material-solid` | `#1C1C1E` | Opaque fallback and modal surface. |
| `--material-edge` | `rgba(255, 255, 255, 0.14)` | Bright top edge where light catches the material. |
| `--track` | `rgba(120, 120, 128, 0.32)` | Inert control ground. |

**Material alpha is set by the worst case, not the best.** `0.86` plus an opaque scrim pseudo-element (`.console::before`) fixes the composite floor regardless of what the canvas is doing. At the original `0.72` with no scrim, a bright Galaxy frame passing under the rail lifted the backdrop enough to drop label contrast to 2.33:1. Do not lower this without re-checking contrast against a white backdrop, not a black one.

### Band identity

The mapping bass / mid / high is **fixed by the product**; the hues are tokens.

| Token | Value | Band |
| --- | --- | --- |
| `--bass` | `#FF453A` | 20–250 Hz |
| `--mid` | `#30D158` | 250 Hz–4 kHz |
| `--high` | `#0A84FF` | 4–20 kHz |

These are Apple's dark-mode system colors, chosen for fidelity to the pin rather than invented. **Open question:** they land close to pure RGB primaries, which is the one quality the incumbent palette had that this work set out to replace. Flagged to the user and not yet resolved.

**The bands must appear on the stage, not only in the rail, and in all ten modes.** The canvas reads the `--bass` / `--mid` / `--high` tokens at startup via `getComputedStyle` and never hard-codes a hue. One source of truth, so a brand kit swap moves the rail and the stage together. Band membership on the stage comes from the analyser's own `BANDS` table in real hertz, so the two surfaces cannot disagree about where mid ends.

This replaces an earlier arrangement in which the eight canvas modes each carried their own RGB triples, and Polygon Collage reached for pure red, green, blue, yellow, cyan, magenta and white — on the one mode the documented meetup demo ends on.

### Label colors

| Token | Value | Contrast note |
| --- | --- | --- |
| `--label` | `#FFFFFF` | Primary. |
| `--label-2` | `rgba(235, 235, 245, 0.8)` | Secondary. |
| `--label-3` | `rgba(235, 235, 245, 0.58)` | Tertiary; the floor for 11px text. |

Tinted from the foreground, never flat gray. `--label-2` and `--label-3` were raised from `0.68` / `0.42` after a contrast failure; they are at their floor and must not be lowered.

## Typography

`system-ui, -apple-system, sans-serif`. The craft floor normally refuses a system face as a display voice; the pinned world earns it, and a self-hosted webfont would add a network dependency that product principle 1 forbids. Do not "fix" this.

| Role | Size | Weight | Tracking | Notes |
| --- | --- | --- | --- | --- |
| Body | 15px / 1.45 | 400 | 0 | Base. |
| Control label | 14px | 400 | 0 | Selects, buttons. |
| Field label | 11px uppercase | 590 | `0.04em` | Positive tracking: small text needs it. |
| Readout value | 19px | 620 | `-0.02em` | Negative tracking: large text needs it. |
| Dialog title | 26px | 640 | `-0.025em` | The largest type in the product. |

- **Tracking is size-specific and never one value.** Positive on small caps labels, negative on large readouts, zero on body. Floor is `-0.025em`; never exceed it.
- `font-variant-numeric: tabular-nums` on BPM, FPS, and gain values — they are measurements and must not jitter as digits change.
- Weight `590` is the interface weight. It is a real SF weight, not a rounding of 600.

## Shape and elevation

`--radius-module: 14px` for panels, `--radius-control: 999px` for small controls, 8–10px for band tracks. Elevation is declared **once**: `inset 0 1px 0` edge plus one offset-and-blurred shadow. Never a border under a shadow.

## Components

| Component | Selector | Rules |
| --- | --- | --- |
| Console rail | `.console` | The only chrome. Always visible. One row at laptop widths. Frosted material plus opaque scrim. |
| Transport | `.transport` | Pill. Dot carries running state via `body[data-running]`. Press feedback, no motion. |
| Band control | `.band` | Fill = post-gain level, thumb = gain. Never transition the fill. |
| Field | `.field` + `.field-control` | Uppercase label above a filled control. Custom chevron, no native appearance. |
| Readout | `.readout` | Tabular numerals. Key/value rows plus a truncating status line. |
| Ghost button | `.ghost` | Secondary actions: fullscreen, help, close. |
| Toggle | `.toggle` | Safety and preference switches that must stay visible. |
| Dialog | `.help-overlay` + `.help-content` | Centered, `aria-modal` only while open, closable three ways. |

New components inherit this vocabulary: filled neutral grounds at `rgba(120,120,128,0.24)`, no borders, one elevation, pills for small controls and 14px radii for panels. A component that introduces a border weight or container style not listed here is drift.

## Composition

- The canvas owns the **full viewport** (`.stage { inset: 0 }`); the console floats over it so content runs under translucent chrome.
- `--rail-h` is **measured, not declared**. `setupConsoleChrome()` syncs it from the console's real height via `ResizeObserver`. A hard-coded value painted the stage hint behind the console whenever the rail wrapped.
- The rail holds four groups: transport and source, the three-band instrument, mode and readout, and the media section which exists only in `custom` mode.
- The rail is capped to a single row at laptop widths (`--bands` max 420px). Two rows doubles the chrome and breaks the reduction.

### The three-band instrument

The single most important decision in this design. "EQ Sensitivity" (three sliders) and "EQ Levels" (three meters) were **one object rendered twice**. They are now one control per band: the coloured fill is the level, the white bar is the gain thumb, in the same track.

The fill is the **post-gain** level — room times the gain you asked for — which is how Logic and Serato meter.

## The stage grammar

The direction above was, for one round of this work, answered entirely in the
rail. The canvas — the thing actually projected on the wall, and the only thing
an attendee at Pennovation will ever see — carried nine draw functions written
before any of it. This section is the correction, and it is the load-bearing
part of the design.

The rule is that **the direction is a grammar, not a mood**, so it can be
enforced in code rather than remembered. Six clauses, all mechanically present
in `app/visualizer.js`:

| Clause | What it means | Where it lives |
| --- | --- | --- |
| **One palette** | Colour is read from the CSS band tokens at startup. Nothing on the stage is saturated unless it is a band. | `readPalette()`, `this.colors` |
| **Light, not ink** | Emissive elements draw as three stacked passes — wide and faint under tight and bright. | `emissiveStroke()`, `emissiveDot()` |
| **One response law** | Every mode reads levels through one curve, so all ten react to the same music with the same sensitivity. | `level()`, `band()` |
| **Honest silence** | No mode fabricates motion when there is no signal. Silence is one shared slow breath. | `idle` |
| **Musical time** | Motion is driven by beat phase re-anchored on real detected beats, not by wall clock. | `phase`, `beat`, `onBeatEvent()` |
| **Composition above the rail** | The console is always visible, so the composition box is the canvas minus the measured rail height. | `applySafeArea()`, `setRailHeight()` |

**Why "light, not ink" is the one that does the most work.** The pinned world is
Apple's dark register, where surfaces read as physical and layered. Nine modes
drawing 2px flat strokes read as a 2010 canvas demo whatever the palette. Three
alpha-stacked passes under additive blending give every element a core and a
halo, which is what a bloom shader would do — and the zero-build constraint
forbids a shader. It is roughly ten lines and it is what makes the ten modes
look like one product.

**Why "honest silence" is a design decision and not a bug fix.** Every mode
previously fell back to `|| Math.sin(this.time)` when a band read zero, so a dead
input looked like a loud room. The craft bar is Logic, Ableton, Serato; none of
them invent a reading. A meter that lies under pressure is worse than one that
reads zero, and this is a tool whose whole job is to be trusted in a booth.

**Reduction applies to the chrome, not the catalogue.** Nine modes were kept, and a tenth — Flow — was recovered from dead code and rebuilt into the grammar.
Radiooooo itself sits on an enormous catalogue behind three controls — the
reduction target governs how many *controls* exist, and the mode dropdown is one
control whether it holds three options or nine. Cutting modes would also have
broken the seven-step demo ritual recorded in `RESOURCES.md`, which is a real
usage scene. What the direction demanded was not fewer modes but that all of them
actually receive it.

**Spectrum Bars moved to the canvas.** It was 256 DOM nodes restyled sixty times
a second, swapped in and out against the p5 canvas — one mode of nine that could
not participate in a shared grammar. It is now 88 log-spaced bars with peak-hold
marks, on the same canvas as everything else. Log spacing is a correctness point
as much as an aesthetic one: linear FFT bins spend four fifths of the screen
width above 4 kHz, where almost nothing happens, and squash every kick and vocal
into the leftmost inch. Closes PHI-154.

**Polygon Collage has its own 2D layer.** It accumulates rather than clearing,
which fights the WEBGL renderer's per-frame clear. Compositing a full-screen 2D
buffer back through `p5.image()` also meant re-uploading a texture to the GPU
sixty times a second — and, in p5 1.9.0, threw on every frame. It is now a plain
canvas beneath the transparent WEBGL one.

## Motion

Governed by `animate`. Every value comes from its tables; none are invented.

| Token | Value |
| --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--press` | `120ms` |
| `--overlay` | `200ms` |

**What deliberately does not animate, and why:**

- **The band fill.** It is a meter reading live audio at 60fps. A transition inserts latency between the sound and the reading. This was the incumbent's actual bug (`transition: height 0.1s` across 256 bars).
- **The stage in silence.** See "Honest silence" above. The one exception is the shared idle breath, which is slow and low enough that no one would read it as music.
- **Transport and mode switching.** Both are keyboard-bound, and keyboard-initiated actions are a disqualifier for motion. Colour and press feedback only.

**What does animate:**

- Press feedback on `:active` (`scale(0.97)`, 120ms) — on press, never on release.
- Beat indicator: **transition, never keyframes**, because it fires ~128×/min and a transition retargets from the live value instead of restarting. Instant on, 240ms decay.
- Stage beat accents: struck to 1 on a real beat event and decayed on **wall time**, not per frame. A per-frame decay made the envelope twice as long on a machine running at half the frame rate — precisely the machine likely to be at the venue.
- Help overlay: opacity plus `scale(0.96 → 1)` at 200ms, materializing with the backdrop. Centered, not scaled from a trigger — modals are exempt from trigger-anchored origin.

Hover is gated behind `@media (hover: hover) and (pointer: fine)` so touch does not fire false hovers.

## Accessibility

- **Photosensitivity is a product requirement, not a preference** (WCAG 2.3.1). `visualizer.flashIntensity` multiplies every flash and pulse consumer. The "Reduce flash" control lives in the **always-visible rail**, not behind the help panel, because a touch user at an installation cannot type `?`. It defaults on when `prefers-reduced-motion` matches and is overridable in both directions. A warning also sits on the pre-start stage, in front of the person who has not started yet.
- `prefers-reduced-motion` removes positional and scale change only. Colour and opacity still carry meaning. Reduced motion here means reduced **flashing**, never a still visualizer.
- `prefers-reduced-transparency` drops to `--material-solid`; `prefers-contrast: more` lifts labels to pure white on a solid ground.
- Browser surfaces are themed from the palette: `::selection`, `:focus-visible`, scrollbar, file-selector button, `option`. Do not revert these.
- The help dialog sets `aria-modal` only while open, moves focus in on open, restores it on close, and closes via button, backdrop, or Esc.

## Open decisions

1. **Band hues** — Apple system colors read close to pure RGB primaries. Unresolved with the user. Now more visible than it was: the hues appear across all ten canvas modes rather than only in the rail, so if they are going to change, changing them is a one-line token edit and costs nothing. Screenshots of every mode are in `test/output/` after `npm run verify`, which is the fastest way to judge it.
2. **PhilaCon Valley brand kit** — not yet binding; tokens are structured for a clean swap.
3. ~~**p5.js still loads from a CDN**~~ — resolved. p5 1.9.0 is vendored in `vendor/`.

## What this file specs

Per the user's decision, `DESIGN.md` **specs** these open tickets rather than superseding them:

| Ticket | What this file constrains |
| --- | --- |
| PHI-154 | **Done.** Spectrum is a canvas mode: 88 log-spaced bars, band-coloured from the shared `BANDS` table, with peak hold. |
| PHI-160 | `flashIntensity` and the rail control exist and now gate every stage accent, not only the rail. The ticket still owns clamping *rate* as well as amplitude. |
| PHI-164 | Focus move and restore exist; the ticket owns the full focus trap and `aria-live` politeness levels. |
| PHI-167 | Slider styling is rebuilt; the ticket owns remaining cross-browser verification in Firefox and Safari. |
| PHI-168 | Desktop-first stance recorded; the ticket owns `dvh` and the narrow-width notice. |
