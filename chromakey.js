// Green screen removal, in plain canvas 2D. No dependencies.
//
// The keying works in YCbCr: luma (Y) is thrown away and only the two colour
// difference channels are compared against the key colour. That is what makes a
// shadowed bit of green screen and a blown-out bit of green screen read as the
// same colour, which an RGB distance would not.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function toCbCr(r, g, b) {
  return [
    -0.169 * r - 0.331 * g + 0.5 * b + 128,
    0.5 * r - 0.419 * g - 0.081 * b + 128,
  ];
}

/**
 * Guess the key colour by looking at the border of the frame, on the assumption
 * that the edges of a green screen shot are screen and not subject. The greenest
 * half of those samples are averaged, so a subject that spills into one edge
 * drags the result far less than a plain average would.
 */
export function detectKeyColor(imageData) {
  const { data, width, height } = imageData;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const samples = [];

  const push = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    samples.push([r, g, b, g - (r + b) / 2]);
  };

  const step = Math.max(1, Math.round(Math.min(width, height) / 160));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < band; x += step) push(x, y);
    for (let x = Math.max(band, width - band); x < width; x += step) push(x, y);
  }
  for (let x = 0; x < width; x += step) {
    for (let y = 0; y < band; y += step) push(x, y);
    for (let y = Math.max(band, height - band); y < height; y += step) push(x, y);
  }

  if (!samples.length) return [0, 177, 64];

  samples.sort((a, b) => b[3] - a[3]);
  const keep = samples.slice(0, Math.max(1, Math.floor(samples.length / 2)));
  const sum = keep.reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]], [0, 0, 0]);
  return sum.map((v) => Math.round(v / keep.length));
}

/**
 * Build the alpha channel and de-spill the colour channels.
 *
 * opts.tolerance  how far from the key colour still counts as background
 * opts.softness   width of the partial-transparency ramp past that
 * opts.shrink     pixels of matte to eat away, to kill the green rim
 * opts.feather    blur radius applied to alpha, for a non-jagged edge
 * opts.spill      how hard to pull residual green out of what is kept
 */
export function keyOut(imageData, keyColor, opts = {}) {
  const { data, width, height } = imageData;
  const tolerance = opts.tolerance ?? 0.22;
  const softness = opts.softness ?? 0.18;
  const shrink = opts.shrink ?? 1;
  const feather = opts.feather ?? 1;
  const spill = opts.spill ?? 0.9;

  const [kCb, kCr] = toCbCr(keyColor[0], keyColor[1], keyColor[2]);
  const inner = tolerance * 128;
  const outer = (tolerance + Math.max(softness, 0.001)) * 128;

  // Pass 1: distance from the key colour becomes a raw matte.
  let alpha = new Float32Array(width * height);
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const [cb, cr] = toCbCr(data[i], data[i + 1], data[i + 2]);
    const d = Math.hypot(cb - kCb, cr - kCr);
    alpha[p] = clamp((d - inner) / (outer - inner), 0, 1);
  }

  if (shrink > 0) alpha = minFilter(alpha, width, height, Math.round(shrink));
  if (feather > 0) alpha = boxBlur(alpha, width, height, Math.round(feather));

  // Pass 2: write the matte back, and suppress green spill on anything kept.
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const a = alpha[p];
    if (a <= 0) { data[i + 3] = 0; continue; }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const limit = (r + b) / 2;
    if (g > limit) data[i + 1] = g + (limit - g) * spill;
    data[i + 3] = Math.round(a * data[i + 3]);
  }
  return imageData;
}

function minFilter(src, width, height, radius) {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 1;
      for (let dx = -radius; dx <= radius; dx++) {
        const v = src[y * width + clamp(x + dx, 0, width - 1)];
        if (v < m) m = v;
      }
      tmp[y * width + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 1;
      for (let dy = -radius; dy <= radius; dy++) {
        const v = tmp[clamp(y + dy, 0, height - 1) * width + x];
        if (v < m) m = v;
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

function boxBlur(src, width, height, radius) {
  if (radius < 1) return src;
  const span = radius * 2 + 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx++) sum += src[y * width + clamp(x + dx, 0, width - 1)];
      tmp[y * width + x] = sum / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) sum += tmp[clamp(y + dy, 0, height - 1) * width + x];
      out[y * width + x] = sum / span;
    }
  }
  return out;
}

/** Crop away fully transparent margins so the subject scales predictably. */
export function trimTransparent(canvas, threshold = 12) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas; // nothing survived the key; hand back the original
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Run an image through the whole pipeline and return a tight cutout canvas. */
export function cutout(image, opts = {}) {
  const maxSide = opts.maxSide ?? 1400;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);

  const frame = ctx.getImageData(0, 0, w, h);
  const key = opts.keyColor ?? detectKeyColor(frame);
  ctx.putImageData(keyOut(frame, key, opts), 0, 0);

  return { canvas: trimTransparent(canvas), keyColor: key };
}
