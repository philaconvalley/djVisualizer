# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: developers reading the repository.** The person this project is built for arrives at a GitHub page, wants to understand what it is, run it, and potentially contribute. Their job is comprehension and extension, not performance. This makes the codebase, README, and the app's demonstrability the product surface that matters most day to day.

What that user is owed concretely, and what now exists: a LICENSE so the repository is legally forkable, a CONTRIBUTING guide stating the constraints that shape every decision here, a README that describes what the app actually does, and a verification command that tells them whether their change broke anything. A repository that solicits contributions while withholding a license is asking for work it cannot accept.

**Secondary: attendees at a public installation.** Confirmed design target for the Founders Alley Philadelphia activation (2026-10-20, Pennovation). These are people who walk up to a running installation with no operator present, no instructions, and no prior context. They are not DJs and did not opt into the experience. Their job is to understand within seconds that the visuals respond to sound, and to leave with an impression.

**Tertiary: the operator.** One expert (currently the project author) driving a live set from a hardware controller. Well served by the incumbent console; not the audience the design work is optimizing for.

These are distinct surfaces with opposite requirements, and the distinction is deliberate. Work serving the developer (contributability, documentation, code legibility) must not be traded away for installation polish, and vice versa.

## Product Purpose

Real-time audio visualization for live DJ performance, driven by live hardware input rather than audio files. Success for the primary user is that a developer can clone it, run it, understand the audio-to-visual pipeline, and add a visualization mode. Success for the installation is that a passerby grasps the sound-to-image relationship without being told.

## Positioning

Hardware-first and stage-tested. The app enumerates audio inputs and actively prioritizes DJ controllers (DDJ-REV1, then any DDJ, then Pioneer), and deliberately disables echo cancellation, noise suppression, and automatic gain control so line-level input from a mixer arrives unprocessed. It has been performed live at Indy Hall in Philadelphia driving visuals from a Pioneer DDJ-REV1 in front of an audience.

Neighboring projects are overwhelmingly file-playback visualizers built as browser demos. Live hardware input, controller detection, and a real performance history are the combination a competing project cannot truthfully claim.

## Operating Context

- **Venue conditions.** Runs on a laptop in a room with unreliable or hostile network access, projected to a large surface. Network failure at showtime is a realistic and previously unmitigated risk.
- **Signal chain.** USB direct from the controller to the machine; the operator gain-stages visually using in-app EQ sensitivity sliders against the mixer's output level.
- **Browser.** Chrome preferred for `getUserMedia` consistency and WebGL performance. Fullscreen presentation. Hardware acceleration assumed on.
- **Demonstration ritual.** The "Demo Flow (Meetup Script)" section of `RESOURCES.md` records an established seven-step meetup demo: device auto-detection, start audio, EQ meters, mode switching, live sensitivity adjustment, fullscreen with BPM, ending on Polygon Collage. This is a real usage scene, not a hypothetical.
- **Performance budget.** Frame rate is a live constraint on low-powered machines; Spectrum and Particles are the documented safe modes.

## Capabilities and Constraints

**Confirmed capabilities:** live audio device enumeration and selection with DJ-hardware prioritization; FFT spectrum and time-domain analysis; three-band energy extraction; beat and BPM detection; ten visualization modes plus user-uploaded image/GIF/video as a reactive layer; per-band sensitivity gain; fullscreen; keyboard shortcuts; on-screen BPM and FPS readouts.

**Zero-build is a binding architectural constraint.** No bundler, no build step, no runtime npm dependencies. The app is `index.html` plus three scripts and a stylesheet, served statically. This is deliberate and protective: there is no build that can fail before a set. Any design work must not introduce a required build step. Dev tooling in `devDependencies` is acceptable; a compile stage between source and running app is not.

**Known defect backlog.** Twenty-one tickets, PHI-150 through PHI-170, from the 2026-08-08 audit. Five touch the design surface directly and this design work specs rather than supersedes them: PHI-154 (spectrum rendering path), PHI-160 (photosensitivity and reduced motion), PHI-164 (accessibility, focus, live regions), PHI-167 (control styling), PHI-168 (responsive and viewport units).

**PHI-150 is resolved, and the caveat it imposed is lifted.** The band math now splits by real hertz from a single `BANDS` table, verified against generated tones: 100 Hz registers only in bass, 1 kHz only in mid, 10 kHz only in high. Visual tuning done against current behavior is now trustworthy.

Two further defects surfaced only once the app was run against real audio, and both were live-performance failures rather than cosmetic ones. Analysis was chained to `requestAnimationFrame`, so listening inherited the renderer's frame rate and degraded exactly as the machine got busier; it now runs on its own clock. Beat detection on top of that could be starved to single-digit hertz — fewer samples than there were beats — so it moved to an `AudioWorklet` on the audio thread. Neither was visible by looking at the app, and neither could have been found with injected synthetic data.

**Terminology.** Bass / mid / high are the three analysis bands and the app's core vocabulary. "Mode" means a visualization. "Device" means an audio input.

## Brand Commitments

**Name:** DJ Visualizer. Published under the `philaconvalley` GitHub organization.

**Pinned design language: Apple, in the Control Center / iOS glass register.** Chosen by the user on 2026-08-08 and binding. Translucent chrome layered over live content rather than opaque panels beside it; direct manipulation with 1:1 pointer tracking; spring-based, interruptible motion; optical typography with size-specific tracking; the system font stack. The behavioral half of this language is the substantive half — response on pointer-down, motion that starts from the live on-screen value, and velocity carried from gesture into animation.

**Reduction target: Radiooooo.** The content surface is the interface. Few controls, each large and unambiguous, flat and limited in palette, with no chrome furniture. **Jony Ive's method is the stated example:** reduce to essence, unify elements that are secretly one thing, and remove until it breaks.

**Craft bar: Logic Pro, Ableton Live, Serato.** These set the *quality* level, not the density — precision of control, clarity of state, and trustworthiness under performance pressure. Where the craft bar and the reduction target conflict, reduction decides how many controls exist and the craft bar decides how good each surviving one must be.

**PhilaCon Valley brand identity remains unresolved and is not inherited.** Guidelines are in progress but were not made binding. Palette and typography stay tokenized so a future brand kit applies as a token change rather than a rewrite.

## Evidence on Hand

- **Real performance history:** performed live at Indy Hall, Philadelphia, on a Pioneer DDJ-REV1 before an audience. This is a factual claim and may be stated.
- **Real screenshots and a demo GIF:** `docs/screenshots/` contains `demo.gif`, `galaxy-mode.png`, `mandala-mode.png`, `spectrum-bars.png`.
- **A live hosted build:** `https://dj-visualizer.netlify.app`, tracking `main`.
- **Real technical documentation:** `RESOURCES.md` is accurate and is the authority for architecture, setup, troubleshooting, and learning resources. Design work must not duplicate its content.

- **A verification suite with real audio:** `npm run verify` runs the app in Chromium against generated WAV files through the fake audio device. Every layer below the physical microphone is the production path. 38 checks, covering band separation against known tones, BPM and octave correctness against known patterns from 85 to 174 BPM, and all ten modes rendering without throwing. Screenshots of every mode land in `test/output/`.

**A hosted build does exist**, contrary to what this file previously recorded: `https://dj-visualizer.netlify.app`, deployed from `main`, with Netlify also building a preview per pull request. **Netlify is the single source of truth for hosting** — decided 2026-08-09. The repo previously also carried a `vercel.json`, which meant two deployment targets from one commit and one of them silently broken; that config has been removed. PHI-162 was written against a stale reading and should be re-scoped to whatever it was actually meant to cover — a custom domain, or promoting the URL — rather than closed as "deploy the app".

**Absences future work must not fabricate:** there are no users, no testimonials, no adoption metrics, and no benchmarks. The Founders Alley activation is agreed in principle only: unscoped, unpaid, and sponsorship-contingent.

**The app has still never run against the DDJ-REV1 since this redesign.** The automated suite substitutes the microphone, so device enumeration and DJ prioritisation, USB line level and gain staging, sustained thermal behaviour, and the projector are all unverified. `CONTRIBUTING.md` carries the eight-step hardware checklist that closes it; it takes about twenty minutes and should happen before anything is promised to Founders Alley.

**Resolved since the 2026-08-08 audit:** LICENSE now exists — MIT, © 2026 Waskar Paulino, individual rather than the LLC (PHI-152). p5 is vendored rather than fetched from a CDN (PHI-151). Spectrum rendering moved to the canvas (PHI-154).

## Product Principles

1. **Nothing may require a network at showtime.** The venue is assumed hostile. Every dependency is local, every failure is visible and recoverable in the moment.
2. **The three bands are the product's idea, not a color scheme.** Bass, mid, and high are meant to read as complementary parts of one composition. Any visual decision that makes them indistinguishable, or that makes them look like three unrelated things, breaks the central concept.
3. **The developer's path must stay short.** Clone, open, understand, extend. Anything that lengthens that path — a build step, an undocumented convention, a 1,500-line file — costs more than it gains.
4. **State what it is, not what it could be.** No users, no testimonials, no metrics. Claims track reality; the real Indy Hall performance is worth more than any aspirational framing. This cuts both ways and has already failed in both directions — a README claiming an MIT license with no LICENSE file, and later a README denying a hosted demo that was live the whole time. Check before asserting an absence, not only before asserting a capability.
5. **Flashing imagery is a safety surface, not a stylistic one.** This app strobes at beat rate and is projected to audiences who did not opt in and cannot easily look away.

## Accessibility & Inclusion

**Photosensitivity is a product-level requirement.** The app renders full-field luminance changes at beat rate (roughly 2 Hz at 128 BPM) and is designed to be projected. WCAG 2.3.1 is the governing standard. A reduced-flashing control and an advance warning are required, not optional — this is tracked as PHI-160 and is a hard constraint on any visual direction.

`prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` must all be honored. In this product, reduced motion means reduced *flashing*, not the removal of visualization — a visualizer with no motion has no function.

Keyboard operability and screen-reader-legible status are required for the console (PHI-164). No product-specific requirement beyond WCAG AA has been established for the installation surface.
