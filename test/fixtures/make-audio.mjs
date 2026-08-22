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
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
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

mkdirSync(HERE, { recursive: true });

writeWav('tone-100hz.wav', tone(100, 6));    // squarely inside 20–250
writeWav('tone-1khz.wav', tone(1000, 6));    // squarely inside 250–4k
writeWav('tone-10khz.wav', tone(10000, 6));  // squarely inside 4k–20k
writeWav('kick-120bpm.wav', kickPattern(120, 12));

// Three tempos with a right answer, chosen to pin the octave behaviour. 85 is
// the hip-hop/half-time case a naive doubling heuristic corrupts; 174 is the
// fast case such a heuristic exists to rescue, and must survive without it.
writeWav('kick-85bpm.wav', kickPattern(85, 24));
writeWav('kick-128bpm.wav', kickPattern(128, 24));
writeWav('kick-174bpm.wav', kickPattern(174, 24));
