# DJ Visualizer – Resources and Learning Guide

This document is a curated guide to help you (and folks at meetups) quickly understand, run, customize, and extend the DJ visualizer project.

The project is designed for live performance using a Pioneer DDJ-REV1 (preferred) or other Pioneer DDJ hardware, with a focus on visualizing bass/mid/high frequency bands as complementary “puzzle pieces” of a cohesive visual.


## Project Overview
- Purpose: Real-time audio visualization for DJ sets with low-latency, hardware-first input.
- Core concept: Bass, mid, high frequency bands visually complement each other like mixer EQ bands, unifying into a single composition.
- Tech stack: Web Audio API + p5.js (WEBGL). All nine modes render on one canvas; an AudioWorklet handles the kick envelope on the audio thread.
- Hardware focus: Pioneer DDJ-REV1 (priority), any DDJ/Pioneer controller. Serato Virtual Audio is not used.


## Architecture and File Map
- `index.html`
  - Loads p5.js from `vendor/` (never a CDN — the venue network is assumed hostile) and the three app scripts. p5.asciify is gone; it was pinned to a version that never existed and had been 404ing on every page load, including the Indy Hall set.
  - Declares UI: device selector `#audioInputSelect`, transport and fullscreen buttons, visualization mode `#visualMode`, per-band sensitivity sliders, band level meters, readout, and the render container `#p5-canvas` (p5 WEBGL). Polygon Collage adds `#collage-canvas` beneath it at runtime.

- `app/app.js` — `DJVisualizerApp`
  - Coordinates lifecycle and UI: start/stop, fullscreen, device enumeration and selection, gain controls, keyboard shortcuts, FPS/BPM display.
  - Bridges audio data from `AudioProcessor` to `DJVisualizer` via the `onDataUpdate` callback, and discrete beats via `onBeat`.
  - Functions to note: `init()`, `startAudio()`, `stopAudio()`, `populateAudioDevices()`, `switchVisualizationMode(mode)`, `updateBPM(bpm)`, `updateFPS()`.
  - FPS is counted on the visualizer's `onFrame` hook, not on the audio callback: the analyser runs at a fixed rate and would report a steady 60 no matter how the renderer was coping.

- `app/audioProcessor.js` — `AudioProcessor`
  - Manages Web Audio API graph and analysis.
  - Responsibilities: device listing, input selection, analyser configuration, spectrum/time-domain capture, band energy calculation, RMS, beat and BPM detection.
  - Functions to note: `listInputs()`, `startAudio(deviceId)`, `stop()`, `updateAudioData()`, `detectBeat(now, energy)`, `bandEnergy(spec, sampleRate)`, `drainEnvelope()`, `getAudioData()`.
  - Band bounds live in the module-level `BANDS` table in real hertz, and both the analyser and the stage read from it. It is the single source of truth for where bass ends and mid begins.
  - Design choices: FFT size 2048 (≈23 Hz bins, so the 20–250 Hz band resolves in about ten of them), disabled echoCancellation/noiseSuppression/autoGainControl for DJ-grade input.
  - Two clocks, deliberately. Analysis runs on a fixed `setInterval`, not chained to `requestAnimationFrame`, so a heavy visualization cannot throttle listening. Beat detection runs further out still, in an `AudioWorklet` on the audio thread, posting timestamped kick-envelope samples that the main thread drains in batches — measured under load, the main thread can fall to single-digit hertz, which is fewer samples than there are beats.

- `app/visualizer.js` — `DJVisualizer`
  - Renders all nine modes on one p5 WEBGL canvas in `#p5-canvas`. Polygon Collage additionally paints into a 2D `#collage-canvas` underneath, because it accumulates rather than clearing.
  - All modes share one grammar — CSS band tokens for colour, stacked emissive passes for light, one response curve, one idle breath, beat-phase timing, and a composition box that clears the console rail. The file header states it in full; `DESIGN.md` explains why.
  - Functions to note: `init()`, `updateAudioData(data)`, `onBeatEvent()`, `draw(p)`, `level(v)`, `band(name)`, `emissiveStroke(...)`, `emissiveDot(...)`, `drawSpectrum()`, `drawParticleField()`, `drawFrequencyRings()`, `drawWaveforms()`, `drawMandala()`, `drawTunnel()`, `drawGalaxy()`, `drawPolygonCollage()`, `drawCustomMedia()`.

- `styles/styles.css`
  - All UI styling, layout, z-index for layered DOM + p5 renders.


## Setup: Pioneer DDJ-REV1 on macOS
1. Hardware and OS prep
   - Connect your DDJ-REV1 via USB. macOS should recognize it as an audio input device.
   - Optionally set macOS Input volume and sample rate (Audio MIDI Setup) to 44.1kHz.

2. Browser recommendations
   - Prefer Chrome for most consistent `getUserMedia` and WebGL performance.
   - Safari generally works but may require explicit user gesture before audio can start.

3. Microphone permission
   - On first run, click “Start Audio” in the app to trigger permission.
   - If denied: check macOS System Settings → Privacy & Security → Microphone and enable your browser.

4. Device selection
   - The app auto-detects and prioritizes DJ devices (DDJ-REV1 first, then any DDJ, then Pioneer devices).
   - Use the “Source” dropdown to override. DJ devices are prefixed `DJ ·` and sorted to the top.

5. Gain staging
   - Each band in the rail is one control: the coloured fill is the live post-gain level, the white bar is the gain you asked for. Drag to balance the look against your mixer's output.
   - Gain affects the visuals only. Beat and BPM detection read the input ahead of these sliders, so moving them can never change what BPM reports.


## Controls and Shortcuts
- Buttons
  - Start Audio: begin capture and visualization.
  - Fullscreen: toggle presentation mode.
- Keyboard
  - Space: Start/Stop Audio
  - F: Toggle Fullscreen
  - 1–9: Switch mode, in dropdown order — Spectrum Bars, Floating Particles,
    Frequency Rings, Wave Forms, Mandala, Tunnel Vision, Galaxy, Polygon Collage,
    Custom Upload
  - R: Reset Gains to 1.0
  - ?: Show/Hide Help


## Visualization Modes
Defined in `index.html` (`#visualMode`) and implemented in `DJVisualizer`.

- Spectrum Bars (`drawSpectrum`)
  - 88 log-spaced bars across 20 Hz–20 kHz, coloured by which band each bar's centre frequency falls in, with peak-hold marks above them. Log spacing matters: linear FFT bins spend most of the screen above 4 kHz and squash every kick and vocal into the leftmost inch.
  - Always-on band meters in the rail (bass/mid/high) act as a quick signal check.

- Floating Particles (`drawParticleField`)
  - 3D particle field of billboarded emissive discs, sorted back to front. Depth carries the band: bass far and heavy, highs near and quick.

- Frequency Rings (`drawFrequencyRings`)
  - Three nested groups, one per band, inner to outer in frequency order. Radius and weight follow the band; the rings breathe out of phase so the figure never reads as one solid disc pumping.

- Wave Forms (`drawWaveforms`)
  - Three stacked waveforms. Shape is read from each band's own spectrum slice rather than from a sine wave, so what is on screen is the sound and not an animation timed to arrive alongside it.

- Mandala (`drawMandala`)
  - Radial spokes whose count comes from band energy, so the figure gains and loses structure with the music. Every fourth spoke extends on the beat.

- Tunnel Vision (`drawTunnel`)
  - Rings advancing by beat phase, so the tunnel moves a fixed distance per beat. Colour by depth in frequency order — a spectrum you fly through.

- Galaxy (`drawGalaxy`)
  - Spiral arms where radius carries frequency: bass at the core, air at the rim. A bass drop lights the centre, a hi-hat pattern lights the edge.

- Polygon Collage (`drawPolygonCollage`)
  - Paint lands and stays, so by the end of a track the screen is a record of what was played. Renders into `#collage-canvas`, a 2D layer beneath the transparent WEBGL one, with a very slow fade so a long set does not turn to mud.

- Custom Upload (`drawCustomMedia`)
  - The operator's own image, GIF, or video. Bass scales it, mid tilts it, high splits it into band-tinted copies. With nothing loaded it draws a geometric drop target — p5's WEBGL `text()` needs a font file, and fetching one at showtime is forbidden.

All modes use the same band colour semantics, read from the CSS tokens at
startup rather than hard-coded per mode:
- Bass (20–250 Hz): `--bass` → `this.colors.bass`
- Mid (250 Hz–4 kHz): `--mid` → `this.colors.mid`
- High (4–20 kHz): `--high` → `this.colors.high`

They also share one grammar beyond colour — stacked emissive passes, one
response curve, one idle breath, beat-phase timing, and a composition box that
clears the console rail. `DESIGN.md` explains each clause and why it is enforced
in code rather than remembered.


## How Audio Data Flows
1. `AudioProcessor.startAudio()` builds the graph. Two branches from one source:
   - `MediaStreamSource → AnalyserNode` for the spectrum the visuals read.
   - `MediaStreamSource → AudioWorklet('kick-envelope') → zero-gain → destination`
     for beat detection. The silent gain node exists only because a worklet is
     not pulled unless it reaches the destination; routing the booth's own
     signal back out of the laptop would be a feedback loop.
2. `updateAudioData()` runs on a fixed `setInterval`, **not** on
   `requestAnimationFrame`, and computes:
   - `rms`
   - `spectrum` (0–1 normalized)
   - band energies via `bandEnergy(spec, sampleRate)` → `bass`, `mid`, `high`,
     each RMS over its own real-hertz bin range, smoothed on elapsed time
   - `binHz`, so the stage can draw a log-frequency spectrum
3. Beats arrive separately. The worklet posts timestamped envelope samples;
   `drainEnvelope()` replays them through `detectBeat()` in order, so a main
   thread that woke late still sees every kick at its true time. Confirmed beats
   fire `onBeat`.
4. `onDataUpdate(data)` in `app/app.js` applies slider gains and forwards to
   `DJVisualizer.updateAudioData()`; `onBeat` drives both the rail indicator and
   `DJVisualizer.onBeatEvent()`.
5. `DJVisualizer.draw()` renders based on `currentMode` and `audioData`.

**Why two clocks.** Analysis chained to `requestAnimationFrame` inherited the
renderer's frame rate; measured under load it fell to about 6 Hz, fewer samples
than there were beats. Listening is not drawing and must not be throttled by it.


## Performance & Live Demo Tips
- Browser
  - Close unnecessary tabs and apps. Prefer Chrome in fullscreen.
  - Ensure “Use hardware acceleration when available” is enabled in browser settings.
- Audio capture
  - Keep `echoCancellation`, `noiseSuppression`, `autoGainControl` off (already done in code) for clean line-level input from the controller.
  - If the device is busy, close other apps using the audio device.
- Visuals
  - Use Spectrum Bars or Particles for the most stable frame rate on low-powered machines.
  - Reduce number of particles or FFT size if needed (see `visualizer.js` and `audioProcessor.js`).
- Latency
  - USB direct from DDJ-REV1 provides lowest latency and best signal quality.


## Verifying a change

`npm run verify` runs the app in Chromium against generated audio with known
frequency content, through the fake capture device. Real `MediaStream`,
`AudioContext`, `AnalyserNode`, FFT and DOM — only the microphone is
substituted. 38 checks; screenshots of every mode land in `test/output/`.

It cannot cover device enumeration, USB line level, thermals, or the projector.
`CONTRIBUTING.md` carries the hardware checklist for those.


## Troubleshooting
- “Microphone access denied”
  - Allow in browser prompt. If still failing, macOS System Settings → Privacy → Microphone → enable your browser.
- “No audio devices found”
  - Check USB connection and cables. Confirm in macOS Audio MIDI Setup. Refresh devices in the app.
- “Audio device is busy”
  - Close other apps (Zoom, DAWs, browser tabs) that may hold the device.
- Selected device not working
  - App falls back from `exact` to `ideal` deviceId. Try another input or switch back to Auto.
- BPM seems half-time
  - The detector attempts to double BPM between 45–90. Verify kick clarity and input level.
- BPM reads “—” with music clearly playing
  - The kick worklet failed to start and the console will say so; detection has fallen back to the render thread, where a heavy mode can starve it. Check for a browser without `AudioWorklet`, or a page served from `file://`.


## Extend and Customize
- Add a new visualization mode
  - In `index.html` add `<option value="myMode">My Mode</option>` — keys 1–9 map to dropdown order, so position matters.
  - In `DJVisualizer.draw()` add a new case `"myMode"` and implement `drawMyMode(p)`.
  - Follow the stage grammar, or the mode will look like it came from a different product. `CONTRIBUTING.md` has the checklist; the short version is: colour from `this.colors`, levels through `this.band()`, light through `emissiveStroke`/`emissiveDot`, timing off `this.phase` and `this.beat`, composition inside `this.vw` × `this.vh`.
  - Run `npm run verify` and look at your mode's screenshot in `test/output/`.

- Integrate feature detection or more advanced onset/BPM libraries
  - Current implementation is custom and lightweight. You can optionally explore Meyda (feature extraction) to add spectral features, but it’s not required in this codebase.

- Map controller inputs (future)
  - For advanced setups, consider WebMIDI to react to DDJ controls and crossfader (if exposed via MIDI on your setup).


## Learning Resources
- Web Audio API
  - MDN Overview: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
  - AnalyserNode: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode
- p5.js
  - Reference: https://p5js.org/reference/
  - WebGL Renderer: https://p5js.org/reference/#/p5/createCanvas
- Real-time audio on the web
  - MediaDevices.getUserMedia(): https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Optional: Audio feature extraction
  - Meyda: https://meyda.js.org/
- Performance
  - requestAnimationFrame: https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame
  - Web Performance APIs: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API


## Demo Flow (Meetup Script)
1. Plug in DDJ-REV1 and open the app.
2. Show device auto-detection (`DJ ·` prefix, sorted first) and start audio.
3. Highlight EQ meters reacting to bass/mid/high.
4. Switch modes (1–9) and explain how each band contributes visually.
5. Adjust sensitivity sliders to re-balance the look live.
6. Toggle fullscreen and walk through BPM indicator.
7. End by showing the Polygon Collage for a dramatic finish.


## BPM Detection Resources
The current implementation in `app/audioProcessor.js` runs a kick-envelope follower in an `AudioWorklet` on the audio thread — a one-pole lowpass near 180 Hz, peak-held and posted at about 86 Hz with audio-clock timestamps. `detectBeat()` then peaks against a 700 ms running mean rather than a fixed threshold, so it survives the operator moving gain mid-set, with interval averaging and smoothing on top. For more robust or alternative BPM/onset detection strategies, these resources are helpful:
  - Meyda (feature extraction – spectral flux, energy, etc.): https://meyda.js.org/
  - music-tempo (tempo estimation from onset arrays): https://github.com/ibbatta/music-tempo
  - web-audio-beat-detector (utility for BPM estimation via Web Audio): https://github.com/chrisguttandin/web-audio-beat-detector
  - Chris Wilson – Beat Detection Using Web Audio: https://www.html5rocks.com/en/tutorials/webaudio/beat-detection/ (archived)
  - aubio.js (onset/beat detection compiled to JS/WebAssembly): https://github.com/aubio/aubiojs
  - Essentia.js (comprehensive audio analysis in the browser): https://mtg.github.io/essentia.js/
  
Tip: You can keep the fast custom detector for responsiveness and overlay a slower, more stable library estimate to refine the displayed BPM.


## License and Attribution
- Libraries: p5.js is used under its license (LGPL-2.1).
- Credit the meetup and contributors where appropriate.


---
If you have questions or ideas to extend this, open an issue or start a discussion in your repo. Have fun performing!
