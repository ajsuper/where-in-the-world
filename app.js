import { LANDMARKS } from './landmarks.js';
import { cutout } from './chromakey.js';
import { renderScene, randomPlacements, defaultSettings } from './compose.js';
import { loadPhrasebook, makeSentence, FALLBACK } from './words.js';

const LIBRARY_KEY = 'photobackground.library';
const LEGACY_KEY = 'photobackground.subject';
const SETTINGS_KEY = 'photobackground.settings';
const RECENT_KEY = 'photobackground.recent';
const SAMPLE = 'sample/greenscreen-sample.png';
const MAX_STORED_SIDE = 1400;

const $ = (id) => document.getElementById(id);

const els = {
  drop: $('drop'),
  file: $('file'),
  library: $('library'),
  libraryPanel: $('library-panel'),
  libraryCount: $('library-count'),
  addMore: $('add-more'),
  clearAll: $('clear-all'),
  useSample: $('use-sample'),
  generate: $('generate'),
  status: $('status'),
  stage: $('stage'),
  canvas: $('canvas'),
  credit: $('credit'),
  download: $('download'),
  tweaks: $('tweaks'),
  peopleOut: $('people-out'),
  swatch: $('swatch'),
  pickKey: $('pick-key'),
};

const controls = {
  tolerance: $('tolerance'),
  softness: $('softness'),
  shrink: $('shrink'),
  spill: $('spill'),
  size: $('size'),
  people: $('people'),
  caption: $('caption'),
  captionTop: $('caption-top'),
};

const state = {
  library: [],            // [{ id, name, src, sample }]
  images: new Map(),      // id -> HTMLImageElement
  cutouts: new Map(),     // id -> { sig, canvas }
  keyColor: null,         // null means "work it out from the photo"
  detectedKey: null,
  landmark: null,
  bgImage: null,
  cast: [],               // ids chosen for the current picture
  placements: [],
  sentence: '',
  phrasebook: FALLBACK,
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
    return false; // private mode, or the photos have outgrown the quota
  }
}

const saveLibrary = () => writeStore(LIBRARY_KEY, state.library);

function syncControls() {
  for (const [key, input] of Object.entries(controls)) {
    if (input.type === 'checkbox') input.checked = state.settings[key];
    else input.value = state.settings[key];
  }
  showHeadCount();
}

function showHeadCount() {
  const n = Number(state.settings.people) || 0;
  els.peopleOut.textContent = n === 0 ? 'Surprise me' : n === 1 ? '1 person' : `${n} people`;
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

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('could not read that file'));
  reader.readAsDataURL(file);
});

/**
 * Shrink a photo before it goes into storage. Phone photos are far bigger than
 * the keyer needs, and a handful of them at full size would blow the ~5MB
 * localStorage quota on the first upload.
 */
async function normalizeForStorage(dataUrl) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_STORED_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && dataUrl.length < 600_000) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function addFiles(fileList) {
  const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
  const rejected = [...(fileList || [])].length - files.length;
  if (!files.length) {
    setStatus(rejected ? 'Those need to be image files.' : '', !!rejected);
    return;
  }

  setStatus(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding photo…');
  let added = 0;
  let overflowed = false;

  for (const file of files) {
    try {
      const src = await normalizeForStorage(await readFile(file));
      const entry = { id: `p${Date.now()}${Math.random().toString(36).slice(2, 7)}`, name: file.name, src };
      state.library.push(entry);
      if (!saveLibrary()) {
        state.library.pop();
        overflowed = true;
        break;
      }
      added++;
    } catch (err) {
      setStatus(`Could not open ${file.name}: ${err.message}`, true);
    }
  }

  await renderLibrary();
  setStatus(overflowed
    ? `Added ${added}. No room left in this browser's storage — remove a photo to add more.`
    : (rejected ? `Added ${added}. Skipped ${rejected} non-image file${rejected > 1 ? 's' : ''}.` : ''), overflowed);
  if (state.landmark) recast();
}

async function addSample() {
  if (state.library.some((e) => e.sample)) return;
  state.library.push({ id: 'sample', name: 'Sample cut-out', src: SAMPLE, sample: true });
  saveLibrary();
  await renderLibrary();
  setStatus('');
  if (state.landmark) recast();
}

function removeEntry(id) {
  state.library = state.library.filter((e) => e.id !== id);
  state.images.delete(id);
  state.cutouts.delete(id);
  saveLibrary();
  renderLibrary();
  if (state.landmark) recast();
}

function clearLibrary() {
  state.library = [];
  state.images.clear();
  state.cutouts.clear();
  saveLibrary();
  renderLibrary();
  if (state.landmark) recast();
}

/** Draw the thumbnail strip, and make sure every photo is decoded and ready. */
async function renderLibrary() {
  els.library.textContent = '';

  for (const entry of state.library) {
    const item = document.createElement('li');
    item.className = 'library-item';

    const thumb = document.createElement('img');
    thumb.src = entry.src;
    thumb.alt = entry.name;
    thumb.loading = 'lazy';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.title = `Remove ${entry.name}`;
    remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => removeEntry(entry.id));

    item.append(thumb, remove);
    els.library.append(item);
  }

  const count = state.library.length;
  els.libraryPanel.hidden = count === 0;
  els.drop.classList.toggle('has-subject', count > 0);
  els.libraryCount.textContent = count === 1 ? '1 photo' : `${count} photos`;
  els.tweaks.hidden = count === 0;

  await Promise.all(state.library.map(async (entry) => {
    if (state.images.has(entry.id)) return;
    try {
      state.images.set(entry.id, await loadImage(entry.src));
    } catch {
      state.library = state.library.filter((e) => e.id !== entry.id);
      saveLibrary();
    }
  }));
}

// -------------------------------------------------------------------- keying

const cutoutSignature = () => {
  const { tolerance, softness, shrink, spill } = state.settings;
  return [tolerance, softness, shrink, spill, state.keyColor?.join('-') ?? 'auto'].join('|');
};

/** Cached per photo: re-keying every image on every slider nudge is too slow. */
function cutoutFor(id) {
  const image = state.images.get(id);
  if (!image) return null;

  const sig = cutoutSignature();
  const cached = state.cutouts.get(id);
  if (cached && cached.sig === sig) return cached.canvas;

  const { tolerance, softness, shrink, spill } = state.settings;
  const result = cutout(image, {
    tolerance: Number(tolerance),
    softness: Number(softness),
    shrink: Number(shrink),
    feather: Number(shrink) > 0 ? 1 : 0,
    spill: Number(spill),
    keyColor: state.keyColor,
  });
  state.detectedKey = result.keyColor;
  updateSwatch();
  state.cutouts.set(id, { sig, canvas: result.canvas });
  return result.canvas;
}

const clamp255 = (c) => Math.max(0, Math.min(255, Math.round(c)));
const toHex = (rgb) => '#' + rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');

function updateSwatch() {
  const key = state.keyColor || state.detectedKey;
  els.swatch.style.background = key ? toHex(key) : 'transparent';
  els.swatch.title = key ? `${state.keyColor ? 'Chosen' : 'Detected'} key color ${toHex(key)}` : '';
  if (key) els.pickKey.value = toHex(key);
}

// ------------------------------------------------------------------- drawing

function draw() {
  if (!state.landmark || !state.bgImage) return;

  const subjects = state.cast
    .map((id, i) => ({ cutout: cutoutFor(id), placement: state.placements[i] }))
    .filter((s) => s.cutout);

  renderScene(els.canvas, {
    background: state.bgImage,
    subjects,
    landmark: state.landmark,
    sentence: state.sentence,
    settings: state.settings,
  });

  els.stage.hidden = false;
  els.download.disabled = false;
}

/** Re-pick who is in the shot, keeping the same place and sentence. */
function recast() {
  const wanted = Number(state.settings.people) || 0;
  const available = state.library.length;
  // An explicit count is taken at its word, even past the number of photos on
  // hand; "surprise me" never asks for more people than there are photos.
  const count = available === 0 ? 0
    : wanted > 0 ? wanted
    : 1 + Math.floor(Math.random() * Math.min(3, available));

  // Distinct photos first. If more people were asked for than there are photos,
  // the extras are repeats — asking for three with one photo should still give three.
  const pool = [...state.library];
  const cast = [];
  while (cast.length < count) {
    if (!pool.length) pool.push(...state.library);
    cast.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  }

  state.cast = cast;
  state.placements = randomPlacements(cast.length);
  draw();
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
    state.sentence = makeSentence(state.phrasebook, landmark);
    writeStore(RECENT_KEY, [landmark.name, ...readStore(RECENT_KEY, []).filter((n) => n !== landmark.name)].slice(0, 8));

    recast();

    const full = `${landmark.the ? 'The ' : ''}${landmark.name}`;
    els.credit.innerHTML =
      `<strong>${escapeHtml(full)}</strong>, ${escapeHtml(landmark.place)} · photo by ` +
      `${escapeHtml(landmark.credit)} (${escapeHtml(landmark.license)}) via ` +
      `<a href="${encodeURI(landmark.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
    setStatus(state.library.length ? '' : 'Add a green screen photo to put someone in the shot.');
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

const openPicker = () => els.file.click();

els.drop.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  openPicker();
});
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openPicker();
  }
});
els.file.addEventListener('change', async (e) => {
  await addFiles(e.target.files);
  els.file.value = '';
});
els.addMore.addEventListener('click', openPicker);
els.clearAll.addEventListener('click', clearLibrary);
els.useSample.addEventListener('click', (e) => {
  e.stopPropagation();
  addSample().catch(() => setStatus('The sample image is missing from this copy of the app.', true));
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
els.drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

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
    // Changing the head count has to re-cast; everything else just redraws.
    if (key === 'people') {
      showHeadCount();
      recast();
    } else {
      queueDraw();
    }
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
  state.settings = { ...defaultSettings, caption: state.settings.caption, captionTop: state.settings.captionTop };
  state.keyColor = null;
  syncControls();
  writeStore(SETTINGS_KEY, state.settings);
  updateSwatch();
  recast();
});

// ---------------------------------------------------------------- start-up

state.settings = { ...defaultSettings, ...readStore(SETTINGS_KEY, {}) };
syncControls();

state.library = readStore(LIBRARY_KEY, []).filter((e) => e && e.id && e.src);

// One photo saved by an earlier version of the app becomes the first library entry.
const legacy = readStore(LEGACY_KEY, null);
if (typeof legacy === 'string' && !state.library.length) {
  state.library.push({ id: 'legacy', name: 'Your saved photo', src: legacy });
  saveLibrary();
}
try { localStorage.removeItem(LEGACY_KEY); } catch { /* nothing to clean up */ }

renderLibrary();

loadPhrasebook()
  .then((book) => {
    state.phrasebook = book;
    if (book.missing.length) {
      setStatus(`No word list found for [${book.missing.join('], [')}] — those templates are skipped.`, true);
    }
  })
  .catch(() => {
    state.phrasebook = FALLBACK;
    setStatus('Could not read words/ — using a few built-in sentences. Serve the folder over http, not file://.', true);
  });
