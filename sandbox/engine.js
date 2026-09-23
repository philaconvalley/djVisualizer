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

// Every mode a student may type into `mode`, and the list the template's comment
// offers them. `custom` is deliberately absent: it draws the GIF, so with no GIF
// it renders a pulsing empty square across the whole stage, says nothing, and
// throws nothing. An edit that looks like a broken page is worse than one the
// list never offered. applyGif assigns that mode directly and never looks it up
// here, so the GIF path is unaffected. Keep this list and the template's comment
// the same.
const MODES = [
  'spectrum',
  'particles',
  'rings',
  'waves',
  'mandala',
  'tunnel',
  'galaxy',
  'polygons',
  'flow'
];

const DEFAULT_MODE = 'flow';

// Two rows: the music controls, then the three boosts. The visualizer keeps its
// drawing above this line, so it has to match the rail's height in sandbox.css.
const RAIL_HEIGHT = 104;

// "Code how hard it hits" — the workshop's own promise. Each band's reading is
// multiplied by its boost before the visualizer sees it, exactly as the main
// app's three sliders do (app/app.js), and over the same range.
const BOOST_BANDS = ['bass', 'mid', 'high'];
const BOOST_MIN = 0.1;
const BOOST_MAX = 3;
const BOOST_STEP = 0.1;

// The same three values sandbox/index.html ships in its :root block. They are
// repeated here because a student's typo can delete that block entirely — an
// unclosed comment in the head swallows the whole <style> on its way to the
// next closing fence — and three white bands is the failure the colour work
// exists to prevent. Keep the two lists the same.
const DEFAULT_PALETTE = { bass: '#ff453a', mid: '#30d158', high: '#0a84ff' };

// The exact strings app/audioProcessor.js writes for a student to read.
// error.message reaches the rail only when it is one of these. Everything else
// is translated, including everything thrown deeper in the graph, where a
// failed audio worklet says "Failed to load module script".
//
// An earlier version asked whether the error carried a cause and treated that
// as "this project wrote it". It is not the same question, and anything thrown
// inside attachStream answered it wrongly.
//
// Matching exactly is deliberate. If audioProcessor rewords one of these, the
// sandbox stops recognising it and shows the plain message instead. That is the
// safe direction to fail in: a student sees something they can act on, never a
// browser's words.
const OWN_MESSAGES = new Set([
  'This browser cannot share a tab. Use Chrome, or pick a song file instead.',
  'No tab was shared. Press the button again and choose your music tab.',
  'That tab was shared without its sound. Try again and tick "Share tab audio" in the dialog.'
]);

class DJVisualizerSandbox extends HTMLElement {
  connectedCallback() {
    if (this.booted) return;
    this.booted = true;

    // Before buildDom, because each slider starts where the student's code says.
    this.boostReport = this.readBoosts();

    this.buildDom(this.getAttribute('dj-name') || '', this.getAttribute('mode') || '');

    this.processor = new AudioProcessor();

    // Before init(), because init() reads the palette once and never again.
    this.paletteReport = this.resolvePalette();

    this.visualizer = new DJVisualizer();
    this.visualizer.init();
    this.visualizer.setRailHeight(RAIL_HEIGHT);
    this.visualizer.currentMode = this.modeSelect.value;
    // The mode the student wrote. A GIF that fails hands the stage back to it.
    this.studentMode = this.modeSelect.value;

    this.processor.onDataUpdate = (data) =>
      this.visualizer.updateAudioData({
        ...data,
        bass: data.bass * this.boosts.bass,
        mid: data.mid * this.boosts.mid,
        high: data.high * this.boosts.high
      });
    this.processor.onBeat = () => this.visualizer.onBeatEvent();

    this.reportTypos();
    this.applyGif(this.getAttribute('gif'));

    window.djSandbox = this;
  }

  // Reads bass-boost, mid-boost and high-boost. Like every other value in the
  // student's file, a boost that does not parse is replaced, never thrown on.
  // A missing attribute is not a mistake: it means "leave it at 1". A word
  // where a number belongs, or a number past the slider's ends, is one, and
  // reportTypos says which.
  readBoosts() {
    this.boosts = {};
    const report = { unreadable: [], clamped: [] };

    for (const band of BOOST_BANDS) {
      const written = (this.getAttribute(band + '-boost') || '').trim();
      const value = Number(written);

      if (!written) {
        this.boosts[band] = 1;
      } else if (!Number.isFinite(value)) {
        report.unreadable.push(band + '-boost');
        this.boosts[band] = 1;
      } else if (value < BOOST_MIN || value > BOOST_MAX) {
        report.clamped.push(band + '-boost');
        this.boosts[band] = Math.min(BOOST_MAX, Math.max(BOOST_MIN, value));
      } else {
        this.boosts[band] = value;
      }
    }

    return report;
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

    // What went wrong, for reportTypos to say out loud. A colour that is
    // missing and a colour that is misspelled are different mistakes and read
    // as different sentences.
    const report = { missing: [], unreadable: [] };

    for (const name of ['bass', 'mid', 'high']) {
      const written = getComputedStyle(root)
        .getPropertyValue('--' + name)
        .trim();

      // Nothing at all, which means the student's whole colour block is gone.
      // Falling through here leaves three white bands, so the shipped values
      // stand in and the rail says so.
      if (!written) {
        report.missing.push(name);
        root.style.setProperty('--' + name, DEFAULT_PALETTE[name]);
        continue;
      }

      probe.style.color = '';
      probe.style.color = written;
      if (!probe.style.color) {
        report.unreadable.push(name);
        continue;
      }

      root.style.setProperty('--' + name, getComputedStyle(probe).color);
    }

    probe.remove();
    return report;
  }

  // A rebuilt page and a page whose colours were swallowed both look exactly
  // like a correct one. A student who typed dj-name="My Name and lost the
  // closing quote mark does not learn that they made a typo — they learn that
  // names do not work here. So the rail says what the typo cost, and what to
  // look for. A page with nothing wrong says nothing: a warning on a correct
  // page teaches a student to stop reading the rail.
  reportTypos() {
    const notes = [];

    if (this.rebuilt) {
      notes.push('Your name and your look went missing, so I used the plain ones.');
    }
    if (this.paletteReport.missing.length) {
      notes.push('Your colours went missing, so I used the plain ones.');
    }
    if (this.paletteReport.unreadable.length) {
      notes.push(
        'These colours are not ones I know, so they came out white: ' +
          this.paletteReport.unreadable.join(', ') +
          '.'
      );
    }
    if (this.boostReport.unreadable.length) {
      notes.push(
        'These boosts are not numbers, so I used 1: ' + this.boostReport.unreadable.join(', ') + '.'
      );
    }
    if (this.boostReport.clamped.length) {
      notes.push(
        'Boosts go from ' +
          BOOST_MIN +
          ' to ' +
          BOOST_MAX +
          ', so I moved these to the nearest end: ' +
          this.boostReport.clamped.join(', ') +
          '.'
      );
    }
    if (!notes.length) return;

    // No "reload" here. In the CodePen pen a student has no account, and a
    // reload throws away every change they made. The pen updates on its own.
    if (this.rebuilt) {
      notes.push('Look for a missing quote mark, or a note with no closing arrow.');
    }
    if (this.paletteReport.missing.length || this.paletteReport.unreadable.length) {
      notes.push('In your colours, look for a missing ; or a note with no */ at its end.');
    }

    // Kept, because every later message lands on the same line: the GIF's
    // callback, and everything useTab and useFile report.
    // A GIF that did not load is obvious from the stage; a name or a colour
    // that came out wrong is not, so that explanation is the one that must
    // survive the collision.
    this.typoNote = notes.join(' ');
    this.status.textContent = this.typoNote;
  }

  // Every message the rail shows goes through here, so a second one joins the
  // first instead of replacing it. The typo note is the one that has to survive:
  // a student who presses the big labelled play button before reading small grey
  // text used to lose the only explanation of why their name vanished. useTab
  // destroyed it on the click, before the picker even opened.
  say(text) {
    this.status.textContent = this.typoNote ? this.typoNote + ' ' + text : text;
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

    // One container, two rows. Every word a student may read lives inside
    // .sandbox-rail, which is how the tests tell rail text from text that
    // escaped a comment.
    const rail = document.createElement('div');
    rail.className = 'sandbox-rail';

    const controls = document.createElement('div');
    controls.className = 'sandbox-controls';
    rail.appendChild(controls);

    const label = document.createElement('span');
    label.className = 'sandbox-name';
    label.textContent = name;
    controls.appendChild(label);

    this.tabButton = document.createElement('button');
    this.tabButton.type = 'button';
    this.tabButton.textContent = 'Play a YouTube tab';
    this.tabButton.addEventListener('click', () => this.useTab());
    controls.appendChild(this.tabButton);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'audio/*,video/*';
    this.fileInput.className = 'sandbox-file';
    this.fileInput.addEventListener('change', () => this.useFile());
    controls.appendChild(DJVisualizerSandbox.labelled('Song', this.fileInput));

    // A student has no CodePen account, so there is nowhere to host the GIF
    // they made. Picking it from the laptop needs no host and no CORS header.
    this.gifInput = document.createElement('input');
    this.gifInput.type = 'file';
    this.gifInput.accept = 'image/gif,image/*';
    this.gifInput.className = 'sandbox-file';
    this.gifInput.addEventListener('change', () => this.useGifFile());
    controls.appendChild(DJVisualizerSandbox.labelled('GIF', this.gifInput));

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
    controls.appendChild(this.modeSelect);

    this.status = document.createElement('span');
    this.status.className = 'sandbox-status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.textContent = 'Pick your music to start';
    controls.appendChild(this.status);

    rail.appendChild(this.buildBoosts());
    this.appendChild(rail);
  }

  // The second row of the rail. A slider changes the picture while the music
  // plays; a CodePen edit restarts the picture and stops the music. So a
  // student finds the value they like here, reads the number, and writes it
  // into their code so it stays. The number is the bridge between the two.
  buildBoosts() {
    const row = document.createElement('div');
    row.className = 'sandbox-boosts';
    this.boostSliders = {};

    for (const band of BOOST_BANDS) {
      const label = document.createElement('label');
      label.className = 'sandbox-boost';
      // Each slider wears its own band's colour, so the student sees which
      // colour on the stage they are about to turn up.
      label.style.setProperty('--band', 'var(--' + band + ')');

      const name = document.createElement('span');
      name.className = 'sandbox-boost-name';
      name.textContent = band + '-boost';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(BOOST_MIN);
      slider.max = String(BOOST_MAX);
      slider.step = String(BOOST_STEP);
      slider.value = String(this.boosts[band]);

      const value = document.createElement('output');
      value.className = 'sandbox-boost-value';
      value.textContent = this.boosts[band].toFixed(1);

      slider.addEventListener('input', () => {
        this.boosts[band] = Number(slider.value);
        value.textContent = this.boosts[band].toFixed(1);
      });

      label.append(name, slider, value);
      row.appendChild(label);
      this.boostSliders[band] = slider;
    }

    return row;
  }

  // Two rail inputs, and two things a student may pick, need telling apart.
  static labelled(text, input) {
    const label = document.createElement('label');
    label.className = 'sandbox-field';
    const name = document.createElement('span');
    name.textContent = text;
    label.append(name, input);
    return label;
  }

  // A GIF is optional and its path is the one student value that can point at
  // a file which is simply not there. It must fail as a message, never as a
  // stopped visualization. See PHI-222.
  applyGif(path) {
    const value = (path || '').trim();
    if (!value) return;
    this.loadGif(value, 'Could not find the GIF at "' + value + '". Check the name.');
  }

  // The GIF a student picked from the laptop. A CodePen edit restarts the
  // picture and forgets it, like the music, so the rail says so.
  async useGifFile() {
    const file = this.gifInput.files[0];
    if (!file) return;
    if (this.gifURL) URL.revokeObjectURL(this.gifURL);
    this.gifURL = URL.createObjectURL(await DJVisualizerSandbox.honestImage(file));
    this.loadGif(
      this.gifURL,
      'That file would not open as a GIF. Try another one.',
      'Showing ' + file.name + '. Pick it again after you change your code.'
    );
  }

  // Chrome types a file by its name, so a WebP or a PNG saved as "party.gif"
  // arrives as image/gif. p5 sends every image/gif to its own GIF decoder,
  // which throws inside a promise on anything else and never calls the failure
  // callback: the student gets an empty pulsing square and no message. So only
  // a file that really starts "GIF8" keeps the GIF type. Anything else is
  // untyped, which sends p5 to the browser's own image loader. That loader
  // opens PNG, JPEG and WebP, and reports a file it cannot open.
  static async honestImage(file) {
    const head = await file.slice(0, 4).text();
    return head === 'GIF8' ? file : new Blob([file]);
  }

  // One loader for both sources. p5 fetches the file before it decodes it:
  // a blob: URL needs nothing, and a GIF on another site needs that site to
  // send Access-Control-Allow-Origin, which /gifs/ on this host does.
  loadGif(url, failure, success) {
    // The hidden select has no `custom` option, by design, so this clears its
    // value. Nothing reads it after boot; the visualizer's own mode is the one
    // that draws.
    const previous = this.visualizer.currentMode;
    this.modeSelect.value = 'custom';
    this.visualizer.currentMode = 'custom';
    if (previous !== 'custom') this.visualizer.onModeChange(previous);

    this.visualizer.p5Instance.loadImage(
      url,
      (image) => {
        this.visualizer.customMedia = image;
        this.visualizer.customMediaType = 'image';
        if (success) this.say(success);
      },
      () => {
        this.say(failure);
        // A GIF already on the stage stays there. With none, the stage goes
        // back to the mode the student wrote, never to a hard-coded default.
        if (this.visualizer.customMedia) return;
        this.modeSelect.value = this.studentMode;
        this.visualizer.currentMode = this.studentMode;
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
    this.say('Choose your music tab, and tick "Share tab audio".');
    try {
      await this.processor.startTabAudio();
      this.visualizer.start();
      this.say('Playing your tab');
    } catch (error) {
      console.debug('sandbox tab source failed', error);
      this.say(
        OWN_MESSAGES.has(error && error.message)
          ? error.message
          : 'Something went wrong. Press the button and try again.'
      );
    }
  }

  async useFile() {
    const file = this.fileInput.files[0];
    if (!file) return;
    this.say('Loading ' + file.name);
    try {
      await this.processor.startFileAudio(file);
      this.visualizer.start();
      this.say('Playing ' + file.name);
    } catch (error) {
      console.debug('sandbox file source failed', error);
      this.say(DJVisualizerSandbox.fileErrorText(error));
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
  const rebuilt = document.createElement('dj-visualizer');
  // Read by reportTypos, and set before the element is connected, because
  // connecting it is what boots it.
  rebuilt.rebuilt = true;
  document.body.appendChild(rebuilt);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureElement);
} else {
  ensureElement();
}
