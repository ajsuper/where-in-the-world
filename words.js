// Loads the editable text files in words/ and turns a template into a sentence.
//
// Nothing here knows which words exist: the placeholders used by templates.txt
// decide which lists get fetched, so dropping an adjectives.txt next to it and
// writing [adjective] in a template is all it takes to add a new word class.

const PLACEHOLDER = /\[([a-z][a-z-]*)\]/gi;
const BUILT_IN = { place: true, city: true };

/** Strip comments and blanks. Used for every one of the text files. */
export function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function placeholdersIn(template) {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1].toLowerCase());
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

/** words/<name>s.txt, or words/<name>.txt for a name that is already plural. */
async function fetchList(base, name) {
  for (const file of [`${name}s.txt`, `${name}.txt`]) {
    try {
      return parseLines(await fetchText(base + file));
    } catch { /* try the next spelling */ }
  }
  return null;
}

/**
 * Read templates.txt, work out which word lists it needs, and fetch those.
 * Templates that don't name a location, or that use a list with no file behind
 * it, are dropped and reported rather than blowing up a generate.
 */
export async function loadPhrasebook(base = 'words/') {
  const templates = parseLines(await fetchText(base + 'templates.txt'));

  const needed = new Set();
  for (const template of templates) {
    for (const name of placeholdersIn(template)) {
      if (!BUILT_IN[name]) needed.add(name);
    }
  }

  const lists = {};
  const missing = [];
  await Promise.all([...needed].map(async (name) => {
    const words = await fetchList(base, name);
    if (words && words.length) lists[name] = words;
    else missing.push(name);
  }));

  const usable = [];
  const placeless = [];
  for (const template of templates) {
    const names = placeholdersIn(template);
    if (!names.some((n) => BUILT_IN[n])) placeless.push(template);
    else if (names.every((n) => BUILT_IN[n] || lists[n])) usable.push(template);
  }

  return { templates: usable, lists, missing, placeless: placeless.length };
}

/** Enough to keep the app working if the text files can't be read at all. */
export const FALLBACK = {
  templates: ['somehow I [verb] a [noun] in [place]'],
  lists: { verb: ['wrestled', 'befriended', 'photographed'], noun: ['pigeon', 'tour guide', 'accordion'] },
  missing: [],
  placeless: 0,
};

const pick = (items, rand) => items[Math.floor(rand() * items.length)];

/** "Colosseum" reads as "the Colosseum" inside a sentence; "Stonehenge" does not. */
export const placeName = (landmark) => (landmark.the ? 'the ' : '') + landmark.name;

/**
 * "a" becomes "an" before a vowel sound. The exceptions matter more than they
 * look: the noun list has both "umbrella" and "unicycle", and only one of them
 * takes "an".
 */
function takesAn(word) {
  const w = word.toLowerCase();
  if (/^(uni|use|usu|uti|ubi|eu|one)/.test(w)) return false;
  if (/^(hour|honest|honou?r|heir)/.test(w)) return true;
  return /^[aeiou]/.test(w);
}

function fixArticles(sentence) {
  return sentence.replace(/\ba (\S+)/gi, (whole, next) => (takesAn(next) ? whole[0] + 'n ' + next : whole));
}

const capitalize = (s) => s.replace(/^\s*([a-z])/, (_, c) => c.toUpperCase());

/**
 * Fill one template. A placeholder used twice in the same sentence gets two
 * different words, so "a [noun] and a [noun]" never doubles up.
 */
export function fillTemplate(template, landmark, lists, rand = Math.random) {
  const used = {};
  const filled = template.replace(PLACEHOLDER, (whole, rawName) => {
    const name = rawName.toLowerCase();
    if (name === 'place') return placeName(landmark);
    if (name === 'city') return landmark.place;

    const words = lists[name];
    if (!words) return whole;

    const seen = (used[name] ||= new Set());
    const fresh = words.filter((w) => !seen.has(w));
    const chosen = pick(fresh.length ? fresh : words, rand);
    seen.add(chosen);
    return chosen;
  });
  return capitalize(fixArticles(filled));
}

export function makeSentence(phrasebook, landmark, rand = Math.random) {
  if (!phrasebook.templates.length) return '';
  return fillTemplate(pick(phrasebook.templates, rand), landmark, phrasebook.lists, rand);
}
