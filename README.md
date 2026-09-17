# Where in the World

A one-page web app that cuts the green screen out of your photos, drops the people
in front of a famous place, and makes up a caption about it. Press **Generate**,
land somewhere new.

It is static HTML, CSS and four JavaScript modules — no build step, no server, no
API keys, no dependencies. Your photos are read in the browser and never uploaded
anywhere; they are kept in `localStorage` so the button works on its own the next
day.

**Live: https://ajsuper.github.io/where-in-the-world/**

## Use it

Open [the page](https://ajsuper.github.io/where-in-the-world/), add your green screen
photos once, and hit **Generate** whenever you want a new picture. **Download** saves a
PNG named for the landmark and the date, e.g. `machu-picchu-2026-09-17.png`.

Add as many photos as you like — every generate picks a random cast from them and
stands them in the scene, so a family of four turns up in different combinations.
**People in the shot** in the tweaks panel fixes the head count if you want exactly
two every time; leave it on *Surprise me* and you get one to three. Ask for more
people than you have photos and somebody shows up twice.

No photo handy? *Use the sample instead* loads the stand-in figure in `sample/`.

## Run it locally

Browsers refuse to load ES modules over `file://`, so serve the folder:

```sh
git clone https://github.com/ajsuper/where-in-the-world.git
cd where-in-the-world
python3 -m http.server 8000
# open http://localhost:8000
```

## The captions

Each picture gets a sentence built from a template and the word lists in `words/`,
all of them plain text files meant to be edited.

`words/templates.txt` is one sentence per line. Write the sentence as you want it to
read and put a placeholder in square brackets wherever a random word belongs:

```
Somehow I [verb] a [noun] at [place]
[place]: where I [verb] a [noun] and lost my [noun]
Day 4 in [city]. I have [verb] every [noun] in sight
```

`[place]` is the landmark and `[city]` is where it is, so every caption says where
the photo was taken; a template with neither is skipped and reported. `[verb]` and
`[noun]` come from `words/verbs.txt` and `words/nouns.txt`, one word per line, `#`
for comments.

Any other placeholder works the same way. Write `[adjective]` in a template, drop an
`adjectives.txt` next to the others, and it is picked up — the app reads the
templates, works out which lists they ask for, and fetches `<name>s.txt` (then
`<name>.txt`). A list it can't find is named in the status line rather than breaking
the app.

Three small things are handled for you: the first letter is capitalized, "a" becomes
"an" before a vowel sound (and stays "a" before "unicycle"), and the same placeholder
used twice in one sentence gets two different words. Verbs are in the past tense so
they read correctly both as "I wrestled" and as "I have wrestled" — the file says so
at the top.

## How the cutout works

`chromakey.js` does the keying, and the interesting choice is that it throws away
brightness. Every pixel is converted to YCbCr and only the two colour-difference
channels (Cb, Cr) are compared against the key colour, so a shadowed corner of the
screen and a hot, blown-out patch read as the same green. A plain RGB distance
does not manage that, which is where most naive keyers fall down.

The pipeline per photo:

1. **Detect the key colour.** Sample a band around the border of the frame, keep
   the greenest half of those samples, average them. Border pixels are screen, not
   subject, and taking the greenest half stops a subject who leans into one edge
   from dragging the result.
2. **Build the matte.** Distance from the key colour in Cb/Cr, ramped between
   `tolerance` and `tolerance + softness` so edges come out partially transparent
   instead of jagged.
3. **Shrink and feather.** A min-filter eats a pixel or two off the matte to kill
   the green rim that hair and shoulders always keep, then a box blur softens it.
4. **Suppress the spill.** Anything still green-dominant gets its green channel
   pulled back toward the average of red and blue, which is what removes the green
   cast bounced onto skin and light clothing.
5. **Trim.** Crop to the bounding box of what survived, so the subject scales
   predictably no matter how much empty screen was in the shot.

`compose.js` then places the cast. Each person gets their own vertical lane so they
don't pile up, and jitters within it. Whoever ends up standing lowest in the frame
is nearest the camera, so they are drawn largest and drawn last — which is what
makes a group read as standing at different distances rather than pasted side by
side. Each gets a blurred, flattened copy of themselves as a ground shadow, and the
caption is wrapped and burned in at the top or the bottom.

If a photo keys badly, **Fine-tune the cutout** exposes each of those knobs, plus a
colour picker to set the key by hand when auto-detect guesses wrong. Settings are
remembered.

## The backdrops

`landmarks.js` holds 32 hand-picked landscape photographs from Wikimedia Commons —
Petra, Machu Picchu, the Hollywood Sign, Ahu Tongariki, and so on. Each entry
carries its photographer and licence, both shown under the image and printed into
the exported PNG.

Every URL was checked to serve `Access-Control-Allow-Origin: *`. That matters: the
browser will not let you export a canvas that has drawn a cross-origin image
without it, so an uncredited image host would silently break **Download**.

Generate avoids the last eight places it sent you, so a week of daily photos does
not repeat.

To add your own, append to `landmarks.js`. Any `upload.wikimedia.org` thumbnail URL
works, and so does a local file dropped in the repo.

## Tests

`test/pipeline.html` is a smoke test: it runs the real keyer and compositor over the
sample image and a live Wikimedia backdrop, then asserts the subject survived, the
background went, no green is left, the corners are transparent, the cast is spread
across the frame in depth order, every template produces a sentence that names its
landmark with no placeholder left behind, and the canvas is still exportable. Serve the repo and open `/test/pipeline.html` — it prints
`ALL PASSED` and draws the result underneath.

## Layout

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `styles.css` | All the styling |
| `app.js` | UI wiring, the photo library, picking a landmark |
| `chromakey.js` | Green screen removal |
| `compose.js` | Placing the cast and drawing the caption |
| `words.js` | Reading `words/` and filling in a template |
| `words/` | The editable templates, verbs and nouns |
| `landmarks.js` | The 32 backdrops and their credits |

## Licence

MIT, see `LICENSE`. The backdrop photographs are not covered by it — each keeps its
own Commons licence, listed in `landmarks.js` and credited on every image.
