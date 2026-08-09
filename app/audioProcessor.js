// Real frequency bounds, in Hz. These are the product's vocabulary and the app
// prints them to the operator in the rail, so the math has to honour them
// literally. The previous implementation split the FFT array by index fraction
// — 0.12 and 0.45 — which at a 48 kHz sample rate put the "bass" band's top edge
// near 2.9 kHz and made every downstream visual a lie. PHI-150.
const BANDS = [
  // `trim` is perceptual compensation, not band math. Music carries far less
  // energy per bin as frequency rises, so an untrimmed high band never moves.
  // Keep these separate from the bounds so the bounds stay auditable.
  { name: 'bass', from: 20,   to: 250,   trim: 1.0 },
  { name: 'mid',  from: 250,  to: 4000,  trim: 1.5 },
  { name: 'high', from: 4000, to: 20000, trim: 2.4 },
];

/* Kick envelope follower, run on the audio thread.
 *
 * Beat detection used to read the same main-thread FFT the visuals read, which
 * meant it inherited the renderer's frame rate. Measured under load that fell
 * to about 6 Hz — three samples per beat at 120 BPM — and the detector simply
 * had no transients left to find. Worse, it degraded precisely when the machine
 * was busiest, which at a venue is all evening.
 *
 * This runs in the audio graph instead, on its own thread, at a fixed rate no
 * amount of rendering can starve. It posts timestamped envelope samples; even
 * if the main thread wakes rarely, the messages queue and arrive in order with
 * their original audio-clock times, so no beat is lost — only delayed.
 *
 * It is delivered as a Blob URL rather than a file so it needs neither a build
 * step nor a fetch, and so `index.html` still works opened straight off disk.
 */
const KICK_WORKLET = `
class KickEnvelope extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lp = 0;
    this.blocks = 0;
    this.peak = 0;
    // One-pole lowpass near 180 Hz. The kick is what beat detection keys off;
    // everything above this is someone else's job.
    this.a = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      this.lp += (channel[i] - this.lp) * this.a;
      sum += this.lp * this.lp;
    }
    // Peak-hold across the reporting interval so a transient landing mid-block
    // is never averaged away.
    this.peak = Math.max(this.peak, Math.sqrt(sum / channel.length));
    if (++this.blocks >= 4) {           // ~86 Hz at 44.1 kHz
      this.port.postMessage({ t: currentTime, v: this.peak });
      this.blocks = 0;
      this.peak = 0;
    }
    return true;
  }
}
registerProcessor('kick-envelope', KickEnvelope);
`;

class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.sourceNode = null;
    this.analyserNode = null;
    
    // Audio processing properties
    this.rms = 0;
    this.bass = 0;
    this.mid = 0;
    this.high = 0;
    this.spectrum = [];
    
    // BPM detection properties
    this.bpm = 0;
    this.beatHistory = [];
    this.lastBeatTime = 0;
    // Adaptive detection: a fixed threshold only works at one gain staging, and
    // the operator moves gain mid-set. The window is the reference the peak is
    // measured against; the floor only rejects near-silence.
    // The window is measured in seconds, not frames. Sized in frames it changed
    // meaning with the frame rate: on a struggling laptop it stretched to cover
    // ten beats, the mean converged onto the signal, and the ratio test below
    // stopped firing — the detector failed on exactly the machine that needed
    // it to work.
    this.bassWindow = [];     // { t, v } pairs, t in ms
    this.bassWindowMs = 700;  // long enough to span a bar's worth of kicks
    this.beatRatio = 1.35;    // how far above the running mean counts as a kick
    this.beatFloor = 0.012;   // below this the room is quiet, not grooving
    this.lastBeatEnergy = 0;
    this.lastAnalysisAt = 0;

    // Envelope samples posted by the worklet, drained on the main thread.
    this.envelopeQueue = [];
    this.usingWorklet = false;
    this.minBeatInterval = 300; // Minimum 300ms between beats (200 BPM max)
    // 1500ms is 40 BPM. Widened from 1200ms (50 BPM) when the octave-doubling
    // heuristic was removed: slow tempos are now detected as themselves rather
    // than folded up, so the valid interval range has to actually contain them.
    this.maxBeatInterval = 1500;
    this.bpmSmoothingFactor = 0.3;
    this.dataArray = null;
    this.timeDataArray = null;
    this.isRunning = false;
    
    // Callbacks
    this.onDataUpdate = null;
    // Discrete beat events. onDataUpdate carries continuous state only, and a
    // beat is an event — consumers should not have to infer it from BPM.
    this.onBeat = null;
  }

  async listInputs() {
    try {
      // Request permission first with basic constraints to ensure we can see device labels
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch(e) {
      console.warn('Could not get initial audio permission:', e.message);
      // Continue anyway, some devices might still be available
    }
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const allInputs = devices.filter(d => d.kind === 'audioinput');
    
    console.log('All detected audio inputs:', allInputs.map(d => ({
      id: d.deviceId,
      label: d.label || 'Unknown Device',
      groupId: d.groupId
    })));
    
    // Process all inputs to create a clean list
    const processedInputs = [];
    const seenLabels = new Set();
    const seenDeviceIds = new Set();
    
    allInputs.forEach((device, index) => {
      // Skip if we've already processed this exact device ID
      if (seenDeviceIds.has(device.deviceId)) {
        return;
      }
      
      let label = device.label || `Audio Input ${index + 1}`;
      
      // Clean up common label prefixes/suffixes
      label = label.replace(/^Default - /, '');
      label = label.replace(/ \(.*Built-in.*\)$/, ' (Built-in)');
      
      // Handle duplicate labels by adding device type info
      if (seenLabels.has(label)) {
        let counter = 2;
        let newLabel = `${label} (${counter})`;
        while (seenLabels.has(newLabel)) {
          counter++;
          newLabel = `${label} (${counter})`;
        }
        label = newLabel;
      }
      
      seenLabels.add(label);
      seenDeviceIds.add(device.deviceId);
      
      processedInputs.push({
        deviceId: device.deviceId,
        label: label,
        groupId: device.groupId,
        isDJ: this.isDJDevice(label),
        isBuiltIn: this.isBuiltInDevice(label)
      });
    });
    
    // Sort inputs: DJ devices first, then built-in, then others
    processedInputs.sort((a, b) => {
      if (a.isDJ && !b.isDJ) return -1;
      if (!a.isDJ && b.isDJ) return 1;
      if (a.isBuiltIn && !b.isBuiltIn) return 1;
      if (!a.isBuiltIn && b.isBuiltIn) return -1;
      return a.label.localeCompare(b.label);
    });
    
    console.log('Processed audio inputs:', processedInputs);
    return processedInputs;
  }

  isDJDevice(label) {
    const djKeywords = ['ddj', 'pioneer', 'serato', 'traktor', 'rekordbox', 'djm', 'cdj'];
    return djKeywords.some(keyword => label.toLowerCase().includes(keyword));
  }

  isBuiltInDevice(label) {
    const builtInKeywords = ['built-in', 'internal', 'macbook', 'imac'];
    return builtInKeywords.some(keyword => label.toLowerCase().includes(keyword));
  }

  findDJInput(inputs) {
    // Look for Pioneer DDJ-REV1 first (hardware controller)
    const ddjRev1 = inputs.find(d => /ddj.*rev1/i.test(d.label));
    if (ddjRev1) return ddjRev1;
    
    // Look for any DDJ controller
    const ddj = inputs.find(d => /ddj/i.test(d.label));
    if (ddj) return ddj;
    
    // Look for Pioneer devices
    const pioneer = inputs.find(d => /pioneer/i.test(d.label));
    if (pioneer) return pioneer;
    
    return null;
  }

  // Width of one FFT bin, in Hz. Everything frequency-aware derives from this
  // rather than from array positions, which is the whole of the PHI-150 fix.
  static binWidth(spec, sampleRate) {
    if (!spec || spec.length === 0 || !sampleRate) return 0;
    return (sampleRate / 2) / spec.length;
  }

  bandEnergy(spec, sampleRate) {
    const out = { bass: 0, mid: 0, high: 0 };
    const binHz = AudioProcessor.binWidth(spec, sampleRate);
    if (!binHz) return out;

    for (const band of BANDS) {
      // Bin 0 is DC. It carries the input's offset, never its music.
      const first = Math.max(1, Math.round(band.from / binHz));
      const last = Math.min(spec.length - 1, Math.round(band.to / binHz));
      if (last < first) continue;

      let sum = 0;
      for (let i = first; i <= last; i++) {
        const v = spec[i] || 0;
        sum += v * v;
      }

      // RMS across the band's own bins. Because `spec` is already normalised to
      // 0..1, every band lands on the same 0..1 scale no matter how many bins it
      // spans — which is what lets one gain slider mean the same thing on all
      // three, and lets the rail meters read as a straight percentage.
      const rms = Math.sqrt(sum / (last - first + 1));
      out[band.name] = Math.min(1, rms * band.trim);
    }

    return out;
  }

  calculateRMS(timeData) {
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const normalized = (timeData[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / timeData.length);
  }

  updateAudioData() {
    if (!this.analyserNode || !this.isRunning) return;

    // Elapsed real time, so every smoothing constant below means the same
    // thing whatever rate this loop is actually managing.
    const now = performance.now();
    const dt = this.lastAnalysisAt ? Math.min(0.25, (now - this.lastAnalysisAt) / 1000) : 1 / 60;
    this.lastAnalysisAt = now;
    const settle = (tau) => 1 - Math.exp(-dt / tau);

    try {
      // Get frequency data
      this.analyserNode.getByteFrequencyData(this.dataArray);

      // Get time domain data for RMS calculation
      this.analyserNode.getByteTimeDomainData(this.timeDataArray);

      // Calculate RMS with smoothing
      const currentRMS = this.calculateRMS(this.timeDataArray) * 0.4;
      this.rms += (currentRMS - this.rms) * settle(0.075);

      // Convert byte frequency data to float spectrum
      this.spectrum = Array.from(this.dataArray).map(val => val / 255);
      
      // Bands arrive already normalised to 0..1 by bandEnergy(); the only job
      // left here is frame-to-frame smoothing on top of the analyser's own.
      const sampleRate = this.audioContext.sampleRate;
      const bands = this.bandEnergy(this.spectrum, sampleRate);
      const k = settle(0.05);
      this.bass += (bands.bass - this.bass) * k;
      this.mid += (bands.mid - this.mid) * k;
      this.high += (bands.high - this.high) * k;

      // Beats come from the audio thread's envelope when it is available; the
      // FFT path is only the fallback for browsers without AudioWorklet.
      if (this.usingWorklet) this.drainEnvelope();
      else this.detectBeat(now, this.bass);

      // The NaN guards that used to wrap every field here are gone. They were
      // load-bearing when bandEnergy() could divide by an empty bin range;
      // now the range is explicitly bounds-checked and the result clamped to
      // 0..1, so a NaN would be a real bug worth seeing rather than silently
      // flooring to zero. The tone checks in test/verify-audio.mjs cover it.
      if (this.onDataUpdate) {
        this.onDataUpdate({
          rms: this.rms,
          bass: this.bass,
          mid: this.mid,
          high: this.high,
          spectrum: this.spectrum || [],
          bpm: this.bpm,
          // The stage draws a log-frequency spectrum, so it needs to know what
          // each bin means rather than guessing from the array length.
          sampleRate,
          binHz: AudioProcessor.binWidth(this.spectrum, sampleRate),
          isActive: (this.rms || 0) > 0.001
        });
      }
      
    } catch (error) {
      console.error('Error in audio data update:', error);
      // Continue with fallback values
      this.rms = this.bass = this.mid = this.high = 0;
    }
  }

  async startAudio(deviceId = null) {
    try {
      // Stop any existing audio first
      this.stop();
      
      // Check if MediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MediaDevices API not supported in this browser');
      }
      
      let constraints;
      if (deviceId) {
        // Try with exact device first, then fallback to ideal
        constraints = { 
          audio: { 
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100
          } 
        };
      } else {
        // Use more permissive constraints for auto-select
        constraints = { 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100
          }
        };
      }
      
      console.log('Requesting audio with constraints:', constraints);
      
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (exactError) {
        if (deviceId && exactError.name === 'OverconstrainedError') {
          console.warn('Exact device constraint failed, trying with ideal constraint:', exactError);
          // Fallback to ideal constraint
          constraints.audio.deviceId = { ideal: deviceId };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
          throw exactError;
        }
      }
      
      // Store stream for cleanup
      this.stream = stream;

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Configure analyser for stable performance
      this.analyserNode = this.audioContext.createAnalyser();
      // 2048 puts bin width near 23 Hz at 48 kHz, which gives the 20–250 Hz bass
      // band about ten bins to work with instead of five. At 1024 the band the
      // whole beat detector keys off was resolved more coarsely than it is wide.
      // The cost is a ~43 ms analysis window, still short enough to feel live.
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.3; // Less smoothing for more responsive visuals
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;
      
      this.sourceNode.connect(this.analyserNode);
      await this.startKickWorklet();

      // Initialize data arrays
      const bufferLength = this.analyserNode.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      this.timeDataArray = new Uint8Array(this.analyserNode.fftSize);

      // Reset audio values
      this.rms = this.bass = this.mid = this.high = 0;

      // Analysis runs on its own clock, not on requestAnimationFrame. Chained
      // to rAF it inherited the renderer's frame rate, so a heavy visualization
      // or a warm laptop starved the beat detector of samples — the failure got
      // worse precisely as the machine got busier. Listening is not drawing and
      // must not be throttled by it.
      this.isRunning = true;
      this.lastAnalysisAt = 0;
      this.analysisTimer = setInterval(() => this.updateAudioData(), 1000 / 60);
      this.updateAudioData();


      console.log('Audio started successfully with sample rate:', this.audioContext.sampleRate);
      
    } catch (error) {
      this.isRunning = false;
      console.error('Audio start error:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to start audio: ';
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Microphone access denied. Please allow microphone permissions and try again.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No audio input device found. Please connect an audio device.';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Audio device is busy or unavailable. Please close other applications using audio.';
      } else {
        errorMessage += error.message;
      }
      
      throw new Error(errorMessage);
    }
  }

  stop() {
    this.isRunning = false;

    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    // Stop all audio tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Disconnect and clean up audio nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.kickNode) {
      this.kickNode.port.onmessage = null;
      this.kickNode.disconnect();
      this.kickNode = null;
    }

    if (this.silentSink) {
      this.silentSink.disconnect();
      this.silentSink = null;
    }
    this.usingWorklet = false;
    
    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Reset audio data
    this.rms = this.bass = this.mid = this.high = 0;
    this.spectrum = [];
    this.bpm = 0;
    this.beatHistory = [];
    this.bassWindow = [];
    this.envelopeQueue = [];
    this.lastBeatTime = 0;
    this.lastBeatEnergy = 0;

    console.log('Audio stopped and cleaned up');
  }

  async startKickWorklet() {
    this.usingWorklet = false;
    this.envelopeQueue = [];

    if (!this.audioContext.audioWorklet) {
      console.warn('AudioWorklet unavailable; beat detection falls back to the render thread.');
      return;
    }

    try {
      if (!AudioProcessor.workletURL) {
        AudioProcessor.workletURL = URL.createObjectURL(
          new Blob([KICK_WORKLET], { type: 'text/javascript' })
        );
      }
      await this.audioContext.audioWorklet.addModule(AudioProcessor.workletURL);

      this.kickNode = new AudioWorkletNode(this.audioContext, 'kick-envelope');
      this.kickNode.port.onmessage = (event) => this.envelopeQueue.push(event.data);
      this.sourceNode.connect(this.kickNode);

      // A worklet only runs if it reaches the destination. Silent gain keeps it
      // pulled without routing the mixer's own signal back out of the laptop —
      // which, in a booth, is a feedback loop.
      this.silentSink = this.audioContext.createGain();
      this.silentSink.gain.value = 0;
      this.kickNode.connect(this.silentSink);
      this.silentSink.connect(this.audioContext.destination);

      this.usingWorklet = true;
    } catch (error) {
      console.warn('Kick worklet failed to start; using the render thread instead:', error);
      this.usingWorklet = false;
    }
  }

  // Every envelope sample the worklet produced since the last wake-up, in
  // order, at its true audio-clock time. This is what makes beat detection
  // independent of how often — or how erratically — the main thread runs.
  drainEnvelope() {
    if (!this.usingWorklet) return;
    const queued = this.envelopeQueue;
    this.envelopeQueue = [];
    for (const sample of queued) {
      this.detectBeat(sample.t * 1000, sample.v);
    }
  }

  detectBeat(now = performance.now(), energy = this.bass) {
    // Beat times are reported on the same clock the samples carry, so a batch
    // drained late still yields the intervals that actually occurred.
    const currentTime = now;

    // The reference the peak is measured against, held to a fixed span of real
    // time. Keeping it short means a build-up raises the bar as it goes, so the
    // detector does not machine-gun through a drop the way a fixed threshold
    // does — while still resolving individual kicks rather than averaging a bar.
    this.bassWindow.push({ t: now, v: energy });
    while (this.bassWindow.length && now - this.bassWindow[0].t > this.bassWindowMs) {
      this.bassWindow.shift();
    }
    const mean = this.bassWindow.reduce((a, s) => a + s.v, 0) / this.bassWindow.length;

    const rising = energy > this.lastBeatEnergy;
    this.lastBeatEnergy = energy;

    // Nothing below the floor is a beat, however quiet the running mean gets;
    // otherwise silence with a little noise in it reads as a groove.
    if (!rising || energy < this.beatFloor || energy < mean * this.beatRatio) return;
    if (currentTime - this.lastBeatTime < this.minBeatInterval) return;

    const interval = currentTime - this.lastBeatTime;
    if (interval >= this.minBeatInterval && interval <= this.maxBeatInterval) {
      this.beatHistory.push(interval);
      if (this.beatHistory.length > 6) this.beatHistory.shift();

      if (this.beatHistory.length >= 2) {
        const avgInterval = this.beatHistory.reduce((a, b) => a + b) / this.beatHistory.length;
        let instantBpm = 60000 / avgInterval;

        // No octave correction. There used to be a rule doubling anything
        // between 45 and 90 BPM, on the theory that a kick skipping the offbeat
        // reads at half tempo. It cannot distinguish that case from a track
        // genuinely at 85, so it corrupted real music: measured against a
        // generated 85 BPM pattern it reported 171. Hip-hop, half-time and
        // downtempo all live in the range it rewrote.
        //
        // Removing it is safe because the adaptive detector no longer needs
        // rescuing — measured against generated patterns it now reads 85 as 85,
        // 128 as 129 and 174 as 174, including the fast case the heuristic
        // existed to protect. Guarded by the tempo checks in
        // test/verify-audio.mjs; do not reintroduce doubling without evidence
        // from an interval histogram.

        this.bpm = Math.round(
          this.bpm === 0
            ? instantBpm
            : this.bpm * (1 - this.bpmSmoothingFactor) + instantBpm * this.bpmSmoothingFactor
        );
      }
    }

    this.lastBeatTime = currentTime;

    // Emitted here, past the interval guard, so it fires exactly once per
    // confirmed beat. Emitting from the energy test alone would burst across
    // consecutive frames of the same kick.
    if (this.onBeat) this.onBeat(currentTime);
  }

  getAudioData() {
    return {
      rms: this.rms,
      bass: this.bass,
      mid: this.mid,
      high: this.high,
      spectrum: this.spectrum,
      bpm: this.bpm
    };
  }
}
