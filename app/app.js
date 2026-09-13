class DJVisualizerApp {
  constructor() {
    this.audioProcessor = new AudioProcessor();
    this.visualizer = new DJVisualizer();
    this.isRunning = false;
    
    this.startBtn = null;
    this.fullscreenBtn = null;
    this.deviceStatusSpan = null;
    this.bpmCounter = null;
    this.fpsCounter = null;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    
    // Gain controls
    this.bassGain = 1.0;
    this.midGain = 1.0;
    this.highGain = 1.0;
  }

  async init() {
    // Initialize DOM elements
    this.startBtn = document.getElementById('start');
    this.fullscreenBtn = document.getElementById('fullscreen');
    this.audioInputSelect = document.getElementById('audioInputSelect');
    this.deviceStatusSpan = document.getElementById('deviceStatus');
    this.bpmCounter = document.getElementById('bpmCounter');
    this.beatIndicator = document.getElementById('beatIndicator');
    this.fpsCounter = document.getElementById('fpsCounter');

    // Set up event listeners
    this.startBtn.addEventListener('click', () => this.toggleAudio());
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    this.audioInputSelect.addEventListener('change', () => this.onDeviceSelectionChange());
    
    // Set up gain controls
    this.setupGainControls();
    this.setupConsoleChrome();
    
    // Set up keyboard shortcuts for live performance
    document.addEventListener('keydown', (e) => {
      // Only text entry should swallow shortcuts. A focused range slider must not
      // kill Space and F, or the transport dies as soon as you touch a band.
      if (e.target.matches('input[type="file"], input[type="text"], textarea')) return;

      // Every mode in the dropdown is reachable, in dropdown order. 1-9 then 0
      // for the tenth, following the convention browsers use for tabs. A mode
      // the operator cannot reach from the keyboard mid-set may as well not
      // exist, so this has to keep pace with the dropdown.
      const digit = e.code.match(/^Digit([0-9])$/);
      if (digit) {
        const options = document.getElementById('visualMode')?.options;
        const position = digit[1] === '0' ? 10 : Number(digit[1]);
        const opt = options?.[position - 1];
        if (opt) {
          e.preventDefault();
          this.switchVisualizationMode(opt.value);
        }
        return;
      }

      switch(e.code) {
        case 'Space':
          e.preventDefault();
          this.toggleAudio();
          break;
        case 'KeyF':
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case 'KeyR':
          e.preventDefault();
          this.resetGains();
          break;
        case 'Slash':
        case 'Question':
          e.preventDefault();
          this.toggleHelp();
          break;
        case 'Escape':
          e.preventDefault();
          this.hideHelp();
          break;
      }
    });

    // Initialize visualizer
    this.visualizer.init();

    // Set up audio data callback with gain adjustment
    this.audioProcessor.onDataUpdate = (data) => {
      // Apply gain adjustments
      const adjustedData = {
        ...data,
        bass: data.bass * this.bassGain,
        mid: data.mid * this.midGain,
        high: data.high * this.highGain
      };
      this.visualizer.updateAudioData(adjustedData);
      this.updateBPM(data.bpm);
    };

    // FPS is a rendering measurement and has to be counted where rendering
    // happens. Counted on the audio callback it reported the analyser's fixed
    // rate — a steady 60 while the projector stuttered, which is worse than no
    // readout at all.
    this.visualizer.onFrame = () => this.updateFPS();

    // A beat is a discrete event, so it gets its own channel rather than being
    // re-derived from the BPM number on every frame. Both the rail indicator
    // and the stage strike off the same event, which is why they now agree.
    this.audioProcessor.onBeat = () => {
      this.pulseBeatIndicator();
      this.visualizer.onBeatEvent();
    };

    // Check permissions and populate audio devices
    await this.checkAudioPermissions();
    await this.populateAudioDevices();
  }

  async checkAudioPermissions() {
    try {
      // Check if we already have permission
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
      console.log('Microphone permission status:', permissionStatus.state);
      
      if (permissionStatus.state === 'denied') {
        this.deviceStatusSpan.textContent = 'Microphone access denied';
        console.warn('Microphone permission denied');
        return false;
      } else if (permissionStatus.state === 'granted') {
        this.deviceStatusSpan.textContent = 'Microphone access granted';
        return true;
      } else {
        this.deviceStatusSpan.textContent = 'Click Start to request audio access';
        return null; // Permission will be requested when needed
      }
    } catch (error) {
      console.warn('Could not check microphone permissions:', error);
      this.deviceStatusSpan.textContent = 'Ready to request audio access';
      return null;
    }
  }

  async populateAudioDevices() {
    if (!navigator.mediaDevices) {
      console.error('MediaDevices API not supported in this browser');
      this.deviceStatusSpan.textContent = 'MediaDevices API not supported';
      return;
    }

    try {
      console.log('Enumerating audio input devices...');
      const inputs = await this.audioProcessor.listInputs();
      console.log('Available audio inputs:', inputs);
      
      // Clear existing options except the first one
      while (this.audioInputSelect.children.length > 1) {
        this.audioInputSelect.removeChild(this.audioInputSelect.lastChild);
      }
      
      if (inputs.length === 0) {
        console.warn('No audio input devices detected');
        this.deviceStatusSpan.textContent = 'No audio devices found';
        return;
      }
      
      // Add all available inputs to the dropdown
      inputs.forEach(input => {
        const option = document.createElement('option');
        option.value = input.deviceId;
        option.textContent = input.label;
        
        // DJ hardware already sorts first; the prefix is typographic, not an icon.
        if (input.isDJ) {
          option.textContent = `DJ · ${input.label}`;
        }
        
        this.audioInputSelect.appendChild(option);
      });
      
      // Inputs arrive rank-sorted, so the best available device is the first
      // one either way. What changes is what we tell the operator: falling
      // back to a microphone is not the same as finding the controller, and
      // saying so at load-in is the warning PHI-172 found missing.
      const djInput = this.audioProcessor.findDJInput(inputs);
      const selected = djInput || inputs[0];
      if (selected) {
        this.audioInputSelect.value = selected.deviceId;
        this.selectedDeviceId = selected.deviceId;
        this.deviceStatusSpan.textContent = djInput
          ? `Ready: ${selected.label}`
          : `No DJ hardware found - using ${selected.label}`;
        console.log('Auto-selected input:', selected.label, '(rank', selected.rank + ')');
      }
      
    } catch (error) {
      console.error('Error enumerating audio devices:', error);
      this.deviceStatusSpan.textContent = 'Error detecting devices';
      this.selectedDeviceId = null;
    }
  }

  onDeviceSelectionChange() {
    const selectedValue = this.audioInputSelect.value;
    
    if (selectedValue === '') {
      // Auto-select mode
      this.selectedDeviceId = null;
      this.deviceStatusSpan.textContent = 'Auto-select mode';
    } else {
      // Specific device selected
      this.selectedDeviceId = selectedValue;
      const selectedOption = this.audioInputSelect.selectedOptions[0];
      this.deviceStatusSpan.textContent = `Selected: ${selectedOption.textContent.replace('DJ · ', '')}`;
    }
    
    console.log('Device selection changed to:', this.selectedDeviceId || 'auto-select');
    
    // If audio is currently running, restart with new device
    if (this.isRunning) {
      console.log('Restarting audio with new device...');
      this.restartAudioWithNewDevice();
    }
  }

  async restartAudioWithNewDevice() {
    try {
      // Stop current audio
      this.audioProcessor.stop();
      
      // Small delay to ensure cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Start with new device
      await this.audioProcessor.startAudio(this.selectedDeviceId);
      this.visualizer.start();
      
      console.log('Audio restarted with new device');
    } catch (error) {
      console.error('Failed to restart audio with new device:', error);
      this.stopAudio();
      alert('Failed to switch audio device. Please try again.');
    }
  }

  async toggleAudio() {
    if (!this.isRunning) {
      await this.startAudio();
    } else {
      this.stopAudio();
    }
  }

  async startAudio() {
    try {
      // Update UI to show attempting to start
      this.deviceStatusSpan.textContent = 'Requesting audio access...';
      this.setTransport('Starting');
      this.startBtn.disabled = true;
      
      // Use selected device or let the system auto-select
      await this.audioProcessor.startAudio(this.selectedDeviceId);
      this.visualizer.start();
      this.isRunning = true;
      this.setTransport('Stop', true);
      this.startBtn.disabled = false;
      
      // Update status to show active device
      const currentDevice = this.selectedDeviceId ? 
        this.audioInputSelect.selectedOptions[0]?.textContent.replace('DJ · ', '') : 
        'Auto-selected device';
      this.deviceStatusSpan.textContent = `Active: ${currentDevice}`;
      
      console.log('DJ Visualizer started with device:', currentDevice);
    } catch (error) {
      console.error('Failed to start audio:', error);
      this.setTransport('Start', false);
      this.startBtn.disabled = false;
      
      // Provide specific error messages based on error type
      let errorMessage = 'Failed to start audio: ';
      let statusMessage = 'Audio failed';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Microphone access denied. Please click the microphone icon in your browser\'s address bar and allow access.';
        statusMessage = 'Permission denied';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No audio input device found. Please connect a microphone or audio device.';
        statusMessage = 'No device found';
      } else if (error.name === 'NotReadableError') {
        errorMessage += 'Audio device is busy. Please close other applications using the microphone.';
        statusMessage = 'Device busy';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage += 'Selected audio device is not available. Try selecting a different device.';
        statusMessage = 'Device unavailable';
      } else {
        errorMessage += error.message || 'Unknown error occurred.';
        statusMessage = 'Error occurred';
      }
      
      this.deviceStatusSpan.textContent = statusMessage;
      alert(errorMessage);
    }
  }

  stopAudio() {
    this.audioProcessor.stop();
    this.visualizer.stop();
    
    this.isRunning = false;
    this.setTransport('Start', false);
    
    // Update status to show ready state
    const selectedDevice = this.selectedDeviceId ? 
      this.audioInputSelect.selectedOptions[0]?.textContent.replace('DJ · ', '') : 
      'Auto-select mode';
    this.deviceStatusSpan.textContent = `Ready: ${selectedDevice}`;
    
    console.log('DJ Visualizer stopped');
  }

  setupGainControls() {
    const bassSlider = document.getElementById('bassGain');
    const midSlider = document.getElementById('midGain');
    const highSlider = document.getElementById('highGain');
    const bassValue = document.getElementById('bassValue');
    const midValue = document.getElementById('midValue');
    const highValue = document.getElementById('highValue');
    
    bassSlider.addEventListener('input', (e) => {
      this.bassGain = parseFloat(e.target.value);
      bassValue.textContent = this.bassGain.toFixed(1);
    });
    
    midSlider.addEventListener('input', (e) => {
      this.midGain = parseFloat(e.target.value);
      midValue.textContent = this.midGain.toFixed(1);
    });
    
    highSlider.addEventListener('input', (e) => {
      this.highGain = parseFloat(e.target.value);
      highValue.textContent = this.highGain.toFixed(1);
    });
  }
  
  
  
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error entering fullscreen:', err);
      });
      this.fullscreenBtn.textContent = 'Exit Fullscreen';
    } else {
      document.exitFullscreen();
      this.fullscreenBtn.textContent = 'Fullscreen';
    }
  }
  
  switchVisualizationMode(mode) {
    const visualModeSelect = document.getElementById('visualMode');
    if (visualModeSelect) {
      visualModeSelect.value = mode;
      visualModeSelect.dispatchEvent(new Event('change'));
    }
  }

  resetGains() {
    this.bassGain = 1.0;
    this.midGain = 1.0;
    this.highGain = 1.0;
    
    // Update UI sliders
    const bassSlider = document.getElementById('bassGain');
    const midSlider = document.getElementById('midGain');
    const highSlider = document.getElementById('highGain');
    
    if (bassSlider) {
      bassSlider.value = 1.0;
      document.getElementById('bassValue').textContent = '1.0';
    }
    if (midSlider) {
      midSlider.value = 1.0;
      document.getElementById('midValue').textContent = '1.0';
    }
    if (highSlider) {
      highSlider.value = 1.0;
      document.getElementById('highValue').textContent = '1.0';
    }
  }

  setupConsoleChrome() {
    // The rail wraps to different heights; measure it rather than guess, or the
    // stage hint ends up painted behind the console.
    const consoleEl = document.querySelector('.console');
    if (consoleEl) {
      // Writing inside the observer's own delivery cycle makes the browser
      // report an undelivered-notification loop, so defer to the next frame and
      // skip writes that would not change anything.
      let lastHeight = -1;
      let queued = false;
      const sync = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const height = Math.round(consoleEl.offsetHeight);
          if (height === lastHeight) return;
          lastHeight = height;
          document.documentElement.style.setProperty('--rail-h', `${height}px`);
          // The stage composes above the rail, so it needs the same measurement
          // the CSS gets — not a second guess at it.
          this.visualizer.setRailHeight(height);
        });
      };
      sync();
      if (window.ResizeObserver) new ResizeObserver(sync).observe(consoleEl);
      else window.addEventListener('resize', sync);
    }

    document.getElementById('helpToggle')?.addEventListener('click', () => this.toggleHelp());
    document.getElementById('helpClose')?.addEventListener('click', () => this.hideHelp());
    document.getElementById('helpOverlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'helpOverlay') this.hideHelp();
    });

    // Flash reduction: a safety control, defaulted from the OS preference but
    // overridable in both directions.
    const flash = document.getElementById('reduceFlash');
    if (flash) {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => this.visualizer.setFlashIntensity(flash.checked ? 0.15 : 1);
      flash.checked = query.matches;
      apply();
      flash.addEventListener('change', apply);
      query.addEventListener?.('change', (e) => { flash.checked = e.matches; apply(); });
    }
  }

  setTransport(label, running) {
    const text = this.startBtn?.querySelector('.transport-label');
    if (text) text.textContent = label;
    if (running !== undefined) {
      document.body.dataset.running = running ? 'true' : 'false';
    }
  }

  updateBPM(bpm) {
    if (this.bpmCounter) {
      // The label lives in the markup; the readout carries the number alone.
      this.bpmCounter.textContent = bpm || '—';
    }
  }

  // Driven by AudioProcessor.onBeat — once per confirmed beat, not once per
  // audio frame. The previous version ran here 60 times a second and left the
  // indicator permanently lit with ~9 removal timers always pending.
  pulseBeatIndicator() {
    if (!this.beatIndicator) return;
    this.beatIndicator.classList.add('flash');
    clearTimeout(this.beatTimer);
    this.beatTimer = setTimeout(() => {
      this.beatIndicator.classList.remove('flash');
    }, 60);
  }

  toggleHelp() {
    const overlay = document.getElementById('helpOverlay');
    if (!overlay) return;
    overlay.classList.contains('is-open') ? this.hideHelp() : this.showHelp();
  }

  showHelp() {
    const overlay = document.getElementById('helpOverlay');
    if (!overlay) return;
    this.helpReturnFocus = document.activeElement;
    // aria-modal only while it actually is one.
    overlay.setAttribute('aria-modal', 'true');
    overlay.classList.add('is-open');
    document.getElementById('helpClose')?.focus();
  }

  hideHelp() {
    const overlay = document.getElementById('helpOverlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.removeAttribute('aria-modal');
    this.helpReturnFocus?.focus?.();
    this.helpReturnFocus = null;
  }

  updateFPS() {
    this.frameCount++;
    const currentTime = performance.now();
    
    if (currentTime - this.lastFrameTime >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFrameTime));
      this.fpsCounter.textContent = fps;
      this.frameCount = 0;
      this.lastFrameTime = currentTime;
    }
  }

  destroy() {
    this.stopAudio();
    this.visualizer.destroy();
  }
}

// Initialize the app when the page loads
let djApp;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    djApp = new DJVisualizerApp();
    await djApp.init();
  } catch (error) {
    // Without this the rejection is swallowed and the operator gets a dead UI
    // with no explanation — the exact failure a missing dependency produces.
    console.error('Startup failed:', error);
    const status = document.getElementById('deviceStatus');
    if (status) status.textContent = `Startup failed: ${error.message}`;
    const hint = document.getElementById('stageHint');
    if (hint) hint.textContent = 'Startup failed. Reload, and check the browser console.';
  }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (djApp) {
    djApp.destroy();
  }
});
