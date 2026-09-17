import { LANDMARKS } from './landmarks.js';
import { cutout } from './chromakey.js';
import { renderScene, randomPlacement, defaultSettings } from './compose.js';

const STORE_KEY = 'photobackground.subject';
const SETTINGS_KEY = 'photobackground.settings';
const RECENT_KEY = 'photobackground.recent';
const SAMPLE = 'sample/greenscreen-sample.png';

const $ = (id) => document.getElementById(id);

const els = {
  drop: $('drop'),
  file: $('file'),
  subjectPreview: $('subject-preview'),
  subjectThumb: $('subject-thumb'),
  subjectName: $('subject-name'),
  subjectNote: $('subject-note'),
  clear: $('clear-subject'),
  useSample: $('use-sample'),
  generate: $('generate'),
  status: $('status'),
  stage: $('stage'),
  canvas: $('canvas'),
  credit: $('credit'),
  download: $('download'),
  tweaks: $('tweaks'),
  swatch: $('swatch'),
  pickKey: $('pick-key'),
};

const controls = {
  tolerance: $('tolerance'),
  softness: $('softness'),
  shrink: $('shrink'),
  spill: $('spill'),
  size: $('size'),
  caption: $('caption'),
};

const state = {
  subjectImage: null,
  isSample: false,
  keyColor: null,     // null means "work it out from the photo"
  detectedKey: null,
  landmark: null,
  bgImage: null,
  placement: null,
  settings: { ...defaultSettings },
  busy: false,
};

// ------------------------------------------------------------- local storage

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode, or the photo is bigger than the storage quota
  }
}

function syncControls() {
  for (const [key, input] of Object.entries(controls)) {
    if (input.type === 'checkbox') input.checked = state.settings[key];
    else input.value = state.settings[key];
  }
}

// --------------------------------------------------------------------- input

function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

async function setSubject(src, label, { sample = false, note = 'Saved on this device' } = {}) {
  state.subjectImage = await loadImage(src);
  state.isSample = sample;
  state.keyColor = null;
  state.detectedKey = null;
  els.subjectThumb.src = src;
  els.subjectName.textContent = label;
  els.subjectNote.textContent = note;
  els.subjectPreview.hidden = false;
  els.drop.classList.add('has-subject');
  updateSwatch();
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus('That needs to be an image file.', true);
    return;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('could not read that file'));
      reader.readAsDataURL(file);
    });
    const stored = writeStore(STORE_KEY, dataUrl);
    await setSubject(dataUrl, file.name, {
      note: stored ? 'Saved on this device' : 'Too large to save — it will be gone on reload',
    });
    setStatus('');
    if (state.landmark) draw();
  } catch (err) {
    setStatus(`Could not open that photo: ${err.message}`, true);
  }
}

function clearSubject() {
  state.subjectImage = null;
  state.isSample = false;
  state.keyColor = null;
  state.detectedKey = null;
  els.subjectPreview.hidden = true;
  els.drop.classList.remove('has-subject');
  els.file.value = '';
  els.tweaks.hidden = true;
  try { localStorage.removeItem(STORE_KEY); } catch { /* nothing to clean up */ }
  updateSwatch();
  if (state.landmark) draw();
}

// -------------------------------------------------------------------- keying

function buildCutout() {
  const { tolerance, softness, shrink, spill } = state.settings;
  const result = cutout(state.subjectImage, {
    tolerance: Number(tolerance),
    softness: Number(softness),
    shrink: Number(shrink),
    feather: Number(shrink) > 0 ? 1 : 0,
    spill: Number(spill),
    keyColor: state.keyColor,
  });
  state.detectedKey = result.keyColor;
  updateSwatch();
  return result.canvas;
}

function toHex(rgb) {
  return '#' + rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

const clamp255 = (c) => Math.max(0, Math.min(255, Math.round(c)));

function updateSwatch() {
  const key = state.keyColor || state.detectedKey;
  els.swatch.style.background = key ? toHex(key) : 'transparent';
  els.swatch.title = key ? `${state.keyColor ? 'Chosen' : 'Detected'} key colour ${toHex(key)}` : '';
  if (key) els.pickKey.value = toHex(key);
}

// ------------------------------------------------------------------- drawing

function draw() {
  if (!state.landmark || !state.bgImage) return;
  renderScene(els.canvas, {
    background: state.bgImage,
    cutout: state.subjectImage ? buildCutout() : null,
    landmark: state.landmark,
    settings: state.settings,
    placement: state.placement,
  });
  els.stage.hidden = false;
  els.download.disabled = false;
  els.tweaks.hidden = !state.subjectImage;
}

// ------------------------------------------------------------------- actions

function pickLandmark() {
  const recent = readStore(RECENT_KEY, []);
  const fresh = LANDMARKS.filter((l) => !recent.includes(l.name));
  const pool = fresh.length ? fresh : LANDMARKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generate() {
  if (state.busy) return;
  state.busy = true;
  els.generate.disabled = true;
  els.generate.textContent = 'Packing…';

  const landmark = pickLandmark();
  setStatus(`Heading to ${landmark.place}…`);

  try {
    state.bgImage = await loadImage(landmark.url, true);
    state.landmark = landmark;
    state.placement = randomPlacement();
    writeStore(RECENT_KEY, [landmark.name, ...readStore(RECENT_KEY, []).filter((n) => n !== landmark.name)].slice(0, 8));

    draw();

    els.credit.innerHTML =
      `<strong>${escapeHtml(landmark.name)}</strong>, ${escapeHtml(landmark.place)} · photo by ` +
      `${escapeHtml(landmark.credit)} (${escapeHtml(landmark.license)}) via ` +
      `<a href="${encodeURI(landmark.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
    setStatus(state.subjectImage ? '' : 'Add a green screen photo to put someone in the shot.');
  } catch (err) {
    setStatus(`Could not load that backdrop (${err.message}). Hit generate again for a different one.`, true);
  } finally {
    state.busy = false;
    els.generate.disabled = false;
    els.generate.textContent = 'Generate';
  }
}

function download() {
  if (!state.landmark) return;
  const slug = state.landmark.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const link = document.createElement('a');
  link.download = `${slug}-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = els.canvas.toDataURL('image/png');
  link.click();
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// -------------------------------------------------------------------- wiring

els.drop.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  els.file.click();
});
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.file.click();
  }
});
els.file.addEventListener('change', (e) => handleFile(e.target.files[0]));
els.clear.addEventListener('click', clearSubject);

els.useSample.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await setSubject(SAMPLE, 'Sample cut-out', { sample: true, note: 'Demo subject, not saved' });
    setStatus('');
    if (state.landmark) draw();
  } catch {
    setStatus('The sample image is missing from this copy of the app.', true);
  }
});

for (const type of ['dragenter', 'dragover']) {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.drop.addEventListener(type, (e) => {
    e.preventDefault();
    els.drop.classList.remove('dragging');
  });
}
els.drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

els.generate.addEventListener('click', generate);
els.download.addEventListener('click', download);

let redrawTimer;
const queueDraw = () => {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(draw, 70);
};

for (const [key, input] of Object.entries(controls)) {
  input.addEventListener('input', () => {
    state.settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
    writeStore(SETTINGS_KEY, state.settings);
    queueDraw();
  });
}

els.pickKey.addEventListener('input', () => {
  const hex = els.pickKey.value;
  state.keyColor = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  updateSwatch();
  queueDraw();
});

$('reset-key').addEventListener('click', () => {
  state.keyColor = null;
  updateSwatch();
  queueDraw();
});

$('reset-tweaks').addEventListener('click', () => {
  state.settings = { ...defaultSettings, caption: state.settings.caption };
  state.keyColor = null;
  syncControls();
  writeStore(SETTINGS_KEY, state.settings);
  updateSwatch();
  queueDraw();
});

// ---------------------------------------------------------------- start-up

state.settings = { ...defaultSettings, ...readStore(SETTINGS_KEY, {}) };
syncControls();

const savedSubject = readStore(STORE_KEY, null);
if (typeof savedSubject === 'string') {
  setSubject(savedSubject, 'Your saved photo').catch(() => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  });
}
