/* The student sandbox's entry point.
 *
 * app/app.js cannot serve this page. It is welded to index.html's console —
 * the transport button, the device select, three band sliders, the readouts,
 * the help dialog — and reproducing that markup in a student's file is the
 * opposite of what this is for. So the sandbox gets its own boot, and the
 * analyser and the stage are used unmodified.
 *
 * The student's file is a configuration, not a program. Every value below is
 * read from HTML or CSS, validated, and replaced with a default when it does
 * not parse. Nothing a student can type in this file throws. PHI-223.
 */

const MODES = [
  'spectrum',
  'particles',
  'rings',
  'waves',
  'mandala',
  'tunnel',
  'galaxy',
  'polygons',
  'custom',
  'flow'
];

const DEFAULT_MODE = 'flow';
const RAIL_HEIGHT = 64;

class DJVisualizerSandbox extends HTMLElement {
  connectedCallback() {
    if (this.booted) return;
    this.booted = true;

    // A test affordance, not part of the student contract. See the plan.
    const params = new URLSearchParams(location.search);

    this.buildDom(
      params.get('name') || this.getAttribute('dj-name') || '',
      params.get('mode') || this.getAttribute('mode') || ''
    );

    this.processor = new AudioProcessor();
    this.visualizer = new DJVisualizer();
    this.visualizer.init();
    this.visualizer.setRailHeight(RAIL_HEIGHT);
    this.visualizer.currentMode = this.modeSelect.value;

    this.processor.onDataUpdate = (data) => this.visualizer.updateAudioData(data);
    this.processor.onBeat = () => this.visualizer.onBeatEvent();

    this.applyGif(this.getAttribute('gif'));

    window.djSandbox = this;
  }

  // Every hook DJVisualizer.init() reaches for without a null guard is built
  // here. Omitting one throws during boot and the student sees a black page.
  buildDom(name, mode) {
    const stage = document.createElement('div');
    stage.className = 'stage';

    const host = document.createElement('div');
    host.id = 'p5-canvas';
    stage.appendChild(host);
    this.appendChild(stage);

    const rail = document.createElement('div');
    rail.className = 'sandbox-rail';

    const label = document.createElement('span');
    label.className = 'sandbox-name';
    label.textContent = name;
    rail.appendChild(label);

    this.tabButton = document.createElement('button');
    this.tabButton.type = 'button';
    this.tabButton.textContent = 'Play a YouTube tab';
    this.tabButton.addEventListener('click', () => this.useTab());
    rail.appendChild(this.tabButton);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,video/*';
    this.fileInput.className = 'sandbox-file';
    this.fileInput.addEventListener('change', () => this.useFile());
    rail.appendChild(this.fileInput);

    // DJVisualizer.init() attaches a change listener to this without a guard.
    // Students never see it; the mode is an attribute on the element.
    this.modeSelect = document.createElement('select');
    this.modeSelect.id = 'visualMode';
    this.modeSelect.hidden = true;
    for (const value of MODES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      this.modeSelect.appendChild(option);
    }
    this.modeSelect.value = MODES.indexOf(mode) === -1 ? DEFAULT_MODE : mode;
    rail.appendChild(this.modeSelect);

    this.status = document.createElement('span');
    this.status.className = 'sandbox-status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = 'Pick your music to start';
    rail.appendChild(this.status);

    this.appendChild(rail);
  }

  // A GIF is optional and its path is the one student value that can point at
  // a file which is simply not there. It must fail as a message, never as a
  // stopped visualization. See PHI-222.
  applyGif(path) {
    const value = (path || '').trim();
    if (!value) return;

    this.modeSelect.value = 'custom';
    this.visualizer.currentMode = 'custom';
    this.visualizer.onModeChange('flow');

    this.visualizer.p5Instance.loadImage(
      value,
      (image) => {
        this.visualizer.customMedia = image;
        this.visualizer.customMediaType = 'image';
      },
      () => {
        this.status.textContent = 'Could not find the GIF at "' + value + '". Check the name.';
        this.modeSelect.value = DEFAULT_MODE;
        this.visualizer.currentMode = DEFAULT_MODE;
        this.visualizer.onModeChange('custom');
      }
    );
  }

  async useTab() {
    this.status.textContent = 'Choose your music tab, and tick "Share tab audio".';
    try {
      await this.processor.startTabAudio();
      this.visualizer.start();
      this.status.textContent = 'Playing your tab';
    } catch (error) {
      this.status.textContent = error.message;
    }
  }

  async useFile() {
    const file = this.fileInput.files[0];
    if (!file) return;
    this.status.textContent = 'Loading ' + file.name;
    try {
      await this.processor.startFileAudio(file);
      this.visualizer.start();
      this.status.textContent = 'Playing ' + file.name;
    } catch (error) {
      this.status.textContent = 'Could not play that file: ' + error.message;
    }
  }
}

customElements.define('dj-visualizer', DJVisualizerSandbox);
