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

    this.buildDom(this.getAttribute('dj-name') || '', this.getAttribute('mode') || '');

    this.processor = new AudioProcessor();

    // Before init(), because init() reads the palette once and never again.
    this.resolvePalette();

    this.visualizer = new DJVisualizer();
    this.visualizer.init();
    this.visualizer.setRailHeight(RAIL_HEIGHT);
    this.visualizer.currentMode = this.modeSelect.value;

    this.processor.onDataUpdate = (data) => this.visualizer.updateAudioData(data);
    this.processor.onBeat = () => this.visualizer.onBeatEvent();

    this.applyGif(this.getAttribute('gif'));

    window.djSandbox = this;
  }

  // DJVisualizer.parseColor accepts #rrggbb and rgb() and nothing else. So
  // "red" and "#f00" — the two things a 12-year-old is likeliest to type —
  // both used to land on the canvas as white, with no message and no clue that
  // the edit had failed. The browser's own parser knows every colour CSS has.
  // Each token is resolved through it and written back as rgb(), so the
  // visualizer reads a form it understands. Genuine nonsense is refused by the
  // style setter, is left exactly as the student typed it, and still falls back
  // to the previous value inside readPalette().
  resolvePalette() {
    const root = document.documentElement;
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);

    for (const name of ['bass', 'mid', 'high']) {
      const written = getComputedStyle(root)
        .getPropertyValue('--' + name)
        .trim();
      if (!written) continue;
      probe.style.color = '';
      probe.style.color = written;
      if (!probe.style.color) continue;
      root.style.setProperty('--' + name, getComputedStyle(probe).color);
    }

    probe.remove();
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

    // The mode the student asked for. A GIF takes the stage while it loads, but
    // a GIF that is not there must not cost them the choice they made.
    const chosen = this.visualizer.currentMode;

    this.modeSelect.value = 'custom';
    this.visualizer.currentMode = 'custom';
    this.visualizer.onModeChange(chosen);

    this.visualizer.p5Instance.loadImage(
      value,
      (image) => {
        this.visualizer.customMedia = image;
        this.visualizer.customMediaType = 'image';
      },
      () => {
        this.status.textContent = 'Could not find the GIF at "' + value + '". Check the name.';
        this.modeSelect.value = chosen;
        this.visualizer.currentMode = chosen;
        this.visualizer.onModeChange('custom');
      }
    );
  }

  // A student never reads a browser's words. error.message reaches the status
  // line only when this project wrote the string. Everything a browser raised
  // is translated here, and the original goes to the console for whoever is
  // helping them.
  static fileErrorText(error) {
    const name = (error && error.name) || (error && error.cause && error.cause.name) || '';
    if (name === 'NotSupportedError') {
      return 'That song file will not play here. Try an MP3 or an M4A.';
    }
    if (name === 'NotAllowedError') {
      return 'Click the page once, then choose your song again.';
    }
    return 'Something went wrong. Press the button and try again.';
  }

  async useTab() {
    this.status.textContent = 'Choose your music tab, and tick "Share tab audio".';
    try {
      await this.processor.startTabAudio();
      this.visualizer.start();
      this.status.textContent = 'Playing your tab';
    } catch (error) {
      console.debug('sandbox tab source failed', error);
      // startTabAudio writes its own child-legible message for every failure
      // it recognises, and those are kept. The one branch it does not write
      // itself appends the browser's words to a prefix, and it is also the only
      // branch that carries a cause it did not translate — so a cause that is
      // not the refusal it handles marks the message to replace.
      const carriesBrowserWords = !!error.cause && error.cause.name !== 'NotAllowedError';
      this.status.textContent = carriesBrowserWords
        ? 'Something went wrong. Press the button and try again.'
        : error.message;
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
      console.debug('sandbox file source failed', error);
      this.status.textContent = DJVisualizerSandbox.fileErrorText(error);
    }
  }
}

customElements.define('dj-visualizer', DJVisualizerSandbox);

// Moving the stylesheet and the scripts into <head> keeps a typo in the student
// region from swallowing the machine, but it cannot protect the element itself:
// the element lives in that region. An unterminated comment swallows the tag,
// and an unclosed attribute quote makes the parser drop it at the end of the
// file. Either way the document has no <dj-visualizer> left and nothing boots —
// a black page with nothing to read, which is the one outcome this sandbox
// promises cannot happen. So when the element is missing after the document
// finishes parsing, build one with the defaults. The student loses the name and
// the mode they typed, which is the cost of the character they dropped, and
// keeps the music and the visuals.
function ensureElement() {
  if (document.querySelector('dj-visualizer')) return;
  document.body.appendChild(document.createElement('dj-visualizer'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureElement);
} else {
  ensureElement();
}
