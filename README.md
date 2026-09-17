# Where in the World

A one-page web app that cuts the green screen out of a photo and drops the subject
in front of a famous place. Press **Generate**, land somewhere new.

It is static HTML, CSS and three JavaScript modules — no build step, no server, no
API keys, no dependencies. Your photo is read in the browser and never uploaded
anywhere; it is kept in `localStorage` so the button works on its own the next day.

## Use it

Open the published page, pick your green screen photo once, and hit **Generate**
whenever you want a new location. **Download** saves a PNG named for the landmark
and the date, e.g. `machu-picchu-2026-09-17.png`.

No photo handy? *Use the sample instead* loads the stand-in figure in `sample/`.

## Run it locally

Browsers refuse to load ES modules over `file://`, so serve the folder:

```sh
git clone https://github.com/OWNER/REPO.git
cd REPO
python3 -m http.server 8000
# open http://localhost:8000
```

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

`compose.js` then scales the cutout to a share of the frame height, stands it in
the lower part of the picture with a little random jitter, lays down a blurred,
flattened copy as a ground shadow so the subject is not floating, and burns the
caption in.

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
background went, no green is left, the corners are transparent, and the canvas is
still exportable. Serve the repo and open `/test/pipeline.html` — it prints
`ALL PASSED` and draws the result underneath.

## Layout

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `styles.css` | All the styling |
| `app.js` | UI wiring, storage, picking a landmark |
| `chromakey.js` | Green screen removal |
| `compose.js` | Placing the subject and drawing the caption |
| `landmarks.js` | The 32 backdrops and their credits |

## Licence

MIT, see `LICENSE`. The backdrop photographs are not covered by it — each keeps its
own Commons licence, listed in `landmarks.js` and credited on every image.
