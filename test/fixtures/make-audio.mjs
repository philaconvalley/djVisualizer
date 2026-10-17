/* Generates the WAV files the verification harness feeds to Chromium's fake
 * audio device. They are generated rather than committed so the repository
 * stays text, and so the exact frequency content is auditable in code — the
 * whole point of the band-math check is that we know what went in.
 *
 *   node test/fixtures/make-audio.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RATE = 48000;

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  const path = join(HERE, name);
  writeFileSync(path, Buffer.concat([header, data]));
  console.log(`wrote ${name} (${(data.length / 2 / RATE).toFixed(1)}s)`);
}

// A steady tone. The band it belongs to should light; the other two should not.
function tone(hz, seconds, amplitude = 0.5) {
  const out = new Float32Array(Math.round(RATE * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * amplitude;
  }
  return out;
}

// A four-on-the-floor kick at a known tempo, so the BPM readout has a right
// answer. Decaying 60 Hz sine, which is what a kick actually is, over a quiet
// noise bed so RMS never reaches exact silence between hits.
function kickPattern(bpm, seconds) {
  const out = new Float32Array(Math.round(RATE * seconds));
  const period = Math.round((60 / bpm) * RATE);
  const decay = 0.09;

  for (let i = 0; i < out.length; i++) {
    const intoBeat = (i % period) / RATE;
    const envelope = Math.exp(-intoBeat / decay);
    const body = Math.sin(2 * Math.PI * 60 * intoBeat) * envelope * 0.85;
    const bed = (Math.random() - 0.5) * 0.015;
    out[i] = body + bed;
  }
  return out;
}

/* A kick with a rolling bassline under it, which is what house music is and
 * what none of the other fixtures are.
 *
 * Every other pattern here is a bare kick over a noise bed — the one signal a
 * naive detector cannot get wrong. Real tracks put a bassline in the same
 * band, and on the DDJ-REV1 a 125 BPM track read 147-158 because the detector
 * locked onto that bassline instead of the kick.
 *
 * The bass sits on the dotted eighth (three sixteenths), the 3-against-4
 * figure this genre is built on. It is deliberately quieter than the kick:
 * amplitude is the only thing that distinguishes them, and the estimator has
 * to use it. PHI-175.
 */
function kickWithSyncopatedBass(bpm, seconds, bassAmp = 0.5) {
  const out = new Float32Array(Math.round(RATE * seconds));
  const beat = (60 / bpm) * RATE;
  const dotted = beat * 0.75; // three sixteenths
  const decay = 0.09;

  for (let i = 0; i < out.length; i++) {
    const intoKick = (i % Math.round(beat)) / RATE;
    const kick = Math.sin(2 * Math.PI * 60 * intoKick) * Math.exp(-intoKick / decay) * 0.85;

    // 90 Hz so it lands in the same band the kick does and the envelope
    // follower cannot separate them by frequency.
    const intoBass = (i % Math.round(dotted)) / RATE;
    const bass =
      Math.sin(2 * Math.PI * 90 * intoBass) * Math.exp(-intoBass / decay) * 0.85 * bassAmp;

    out[i] = kick + bass + (Math.random() - 0.5) * 0.015;
  }
  return out;
}

/* Kick, mid chord stabs, and noisy hats. Every other fixture here leaves mid
 * and high near zero, which is not what a mix does to the stage: on the
 * DDJ-REV1 a full mix read bass ~0.6, mid ~0.5, high ~0.3. Mandala's spoke count
 * and Polygon Collage's shape size both grow with those bands, so a stall test
 * on a bare kick measures a lighter stage than a real set draws. PHI-176.
 */
function broadbandMix(bpm, seconds) {
  const out = new Float32Array(Math.round(RATE * seconds));
  const beat = Math.round((60 / bpm) * RATE);
  const eighth = Math.round(beat / 2);
  const chord = [440, 554.37, 659.25, 1318.5, 2637];

  for (let i = 0; i < out.length; i++) {
    const intoBeat = (i % beat) / RATE;
    const intoEighth = (i % eighth) / RATE;
    const kick = Math.sin(2 * Math.PI * 60 * intoBeat) * Math.exp(-intoBeat / 0.09) * 0.6;

    // The chord moves every other bar so the mid band is not a constant.
    const shift = Math.floor(i / (beat * 4)) % 2 ? 1.12 : 1;
    let mid = 0;
    for (const hz of chord) mid += Math.sin((2 * Math.PI * hz * shift * i) / RATE);
    mid *= 0.07 * (0.55 + 0.45 * Math.exp(-intoEighth / 0.18));

    const hat =
      (Math.random() - 0.5) * Math.exp(-intoEighth / 0.03) * 0.5 + (Math.random() - 0.5) * 0.06;
    out[i] = kick + mid + hat;
  }
  return out;
}

/* A drum kit on a one-bar pattern: kick, snare, and hats, each listed as beat
 * positions in a 4-beat bar.
 *
 * Every fixture above puts a kick on every beat, and so a kick-only tempo
 * estimate read them all correctly. A backbeat does not: the kick plays beats
 * 1 and 3, the snare plays 2 and 4, and on the DDJ-REV1 "Alright" at 118.8 BPM
 * read 62. The snare is a 190 Hz body under a noise crack, which is where the
 * high band finds it. PHI-175.
 */
function drumKit(bpm, seconds, { kicks = [], snares = [], hats = [], hatAmp = 0.3 }) {
  const out = new Float32Array(Math.round(RATE * seconds));
  const beat = (60 / bpm) * RATE;
  const bar = beat * 4;
  // Seconds since the most recent hit in `positions`, wrapping across bars.
  const since = (positions, i) => {
    if (!positions.length) return 10;
    const intoBar = i % bar;
    let nearest = Infinity;
    for (const p of positions) {
      let d = intoBar - p * beat;
      if (d < 0) d += bar;
      nearest = Math.min(nearest, d);
    }
    return nearest / RATE;
  };

  for (let i = 0; i < out.length; i++) {
    const tk = since(kicks, i);
    const ts = since(snares, i);
    const th = since(hats, i);
    const kick = Math.sin(2 * Math.PI * 55 * tk) * Math.exp(-tk / 0.12) * 0.85;
    const snare =
      (Math.sin(2 * Math.PI * 190 * ts) * 0.4 + (Math.random() - 0.5) * 0.9) *
      Math.exp(-ts / 0.07) *
      0.6;
    const hat = (Math.random() - 0.5) * Math.exp(-th / 0.02) * hatAmp;
    out[i] = kick + snare + hat + (Math.random() - 0.5) * 0.015;
  }
  return out;
}

mkdirSync(HERE, { recursive: true });

writeWav('tone-100hz.wav', tone(100, 6)); // squarely inside 20–250
writeWav('tone-1khz.wav', tone(1000, 6)); // squarely inside 250–4k
writeWav('tone-10khz.wav', tone(10000, 6)); // squarely inside 4k–20k
writeWav('kick-120bpm.wav', kickPattern(120, 12));

// Three tempos with a right answer, chosen to pin the octave behaviour. 85 is
// the hip-hop/half-time case a naive doubling heuristic corrupts; 174 is the
// fast case such a heuristic exists to rescue, and must survive without it.
writeWav('kick-85bpm.wav', kickPattern(85, 24));
writeWav('kick-128bpm.wav', kickPattern(128, 24));
writeWav('kick-174bpm.wav', kickPattern(174, 24));

// The case that actually failed on hardware. 125 BPM is a 480 ms beat; the
// bassline sits at 360 ms, and the old estimator reported the bassline.
writeWav('kick-125bpm-bassline.wav', kickWithSyncopatedBass(125, 24));
// The bassline at 90% of the kick. The kick-only estimator held this; an
// early cut of the high-band change read it as 167 (PHI-175).
writeWav('kick-125bpm-bassline-90.wav', kickWithSyncopatedBass(125, 24, 0.9));

// Backbeats: the case that read half tempo on hardware. 118.8 is "Alright" as
// it played in the 10/16 soak. The second moves the kick off beat 3, as
// hip-hop often does; a kick-only estimate wandered 52-79 on it.
const eighths = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
writeWav('backbeat-119bpm.wav', drumKit(118.8, 24, { kicks: [0, 2], snares: [1, 3] }));
writeWav(
  'backbeat-119bpm-syncopated.wav',
  drumKit(118.8, 24, { kicks: [0, 1.5, 2.5], snares: [1, 3], hats: eighths })
);
writeWav('backbeat-90bpm.wav', drumKit(90, 24, { kicks: [0, 2], snares: [1, 3], hats: eighths }));
// House with loud off-beat hats. Hats half a beat from every kick are the
// pattern most likely to pull a high-band vote off the beat.
writeWav(
  'house-125bpm-offbeat-hats.wav',
  drumKit(125, 24, { kicks: [0, 1, 2, 3], hats: [0.5, 1.5, 2.5, 3.5], hatAmp: 1.2 })
);
// Drum and bass: kick on 1 and the "and" of 3, snare on 2 and 4. A kick-only
// estimate read it as 43.
writeWav('dnb-174bpm.wav', drumKit(174, 24, { kicks: [0, 2.5], snares: [1, 3], hats: eighths }));

// Stage-load fixture for test/stall-trace.mjs. Sixty seconds, so a long dwell
// does not loop mid-window.
writeWav('broadband-124bpm.wav', broadbandMix(124, 60));

// No-signal fixtures (PHI-173). Silence here is exact digital zero, which is
// what a loopback with nothing routed, a muted channel, or the wrong output
// actually delivers.
const silence = (seconds) => new Float32Array(Math.round(RATE * seconds));
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// Soak fixture for test/soak.mjs (PHI-178). The ticket asks whether the beat
// detector holds up "against changing material" for an hour, and one tempo on
// a loop never changes. Six tempos, 90 s each, hard cuts like a quick mix: it
// loops every 9 minutes, so each 10-minute window hears all six. 174 and 85
// are the octave cases from the BPM fixtures above.
writeWav(
  'soak-medley.wav',
  concat(...[124, 128, 120, 174, 85, 126].map((bpm) => broadbandMix(bpm, 90)))
);

// A stream that opens and never carries audio.
writeWav('silence.wav', silence(12));
// Dead at load-in, then the mixer output gets fixed. The message must clear.
writeWav('silence-then-tone.wav', concat(silence(5), tone(440, 8)));
// Short gaps, like the space between two tracks. Must never raise the message.
writeWav(
  'tone-with-gaps.wav',
  concat(...Array.from({ length: 4 }, () => concat(tone(440, 3), silence(1.5))))
);
