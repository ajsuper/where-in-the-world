// Puts the cutouts into the backdrop and writes the caption. Pure drawing:
// everything it needs is passed in, which keeps it testable without the page.

export const OUT_W = 1600;
export const OUT_H = 1000;

export const defaultSettings = {
  tolerance: 0.22,
  softness: 0.18,
  shrink: 1,
  spill: 0.9,
  size: 0.62,
  people: 0,          // 0 means "surprise me"
  caption: true,
  captionTop: false,
};

/** Scale-to-fill geometry, the canvas equivalent of `background-size: cover`. */
export function coverRect(imgW, imgH, boxW, boxH) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/**
 * Stand `count` people in the frame without piling them up: each gets its own
 * vertical lane, then jitters within it. Whoever stands lowest in the frame is
 * nearest the camera, so they are drawn biggest and drawn last.
 */
export function randomPlacements(count, rand = Math.random) {
  const lanes = [];
  for (let i = 0; i < count; i++) {
    const lane = (i + 0.5) / count;
    const drift = (rand() - 0.5) * (0.7 / count);
    lanes.push({
      centerX: Math.min(0.86, Math.max(0.14, lane + drift)),
      footY: 0.78 + rand() * 0.16,
      sizeJitter: 0.94 + rand() * 0.12,
      flip: rand() < 0.25,
    });
  }
  lanes.sort((a, b) => a.footY - b.footY);
  for (const p of lanes) p.depth = 0.82 + ((p.footY - 0.78) / 0.16) * 0.3;
  return lanes;
}

export function renderScene(canvas, { background, subjects = [], landmark, sentence, settings }) {
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, OUT_W, OUT_H);

  const bg = coverRect(background.width, background.height, OUT_W, OUT_H);
  ctx.drawImage(background, bg.x, bg.y, bg.w, bg.h);

  const ordered = [...subjects].sort((a, b) => (a.placement?.footY ?? 0) - (b.placement?.footY ?? 0));
  for (const { cutout, placement } of ordered) {
    if (cutout) drawSubject(ctx, cutout, placement, settings);
  }

  if (settings.caption) {
    drawCaption(ctx, {
      sentence: sentence || `${landmark.the ? 'The ' : ''}${landmark.name}, ${landmark.place}`,
      landmark,
      top: !!settings.captionTop,
    });
  }
  return canvas;
}

function drawSubject(ctx, cutout, placement, settings) {
  const place = placement ?? randomPlacements(1)[0];
  const targetH = OUT_H * Number(settings.size) * (place.depth ?? 1) * place.sizeJitter;
  const scale = targetH / cutout.height;
  const w = cutout.width * scale;
  const h = cutout.height * scale;
  // A lane near the edge can push a wide subject half out of shot, so hold back
  // anyone who would lose more than a sliver of themselves to the frame.
  const x = Math.min(Math.max(OUT_W * place.centerX - w / 2, -w * 0.08), OUT_W - w * 0.92);
  const y = OUT_H * place.footY - h;

  drawGroundShadow(ctx, cutout, x, y, w, h);

  ctx.save();
  if (place.flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cutout, 0, 0, w, h);
  } else {
    ctx.drawImage(cutout, x, y, w, h);
  }
  ctx.restore();
}

/** A blurred, flattened black copy of the subject, so they aren't floating. */
function drawGroundShadow(ctx, cutout, x, y, w, h) {
  const shade = document.createElement('canvas');
  shade.width = cutout.width;
  shade.height = cutout.height;
  const sctx = shade.getContext('2d');
  sctx.drawImage(cutout, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, shade.width, shade.height);

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.filter = `blur(${Math.max(4, Math.round(h * 0.02))}px)`;
  ctx.translate(x + w / 2, y + h);
  ctx.scale(1, 0.14);
  ctx.drawImage(shade, -w / 2, -h, w, h);
  ctx.restore();
}

/** Greedy word wrap against the measured width of the real font. */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCaption(ctx, { sentence, landmark, top }) {
  const padX = 56;
  const maxWidth = OUT_W - padX * 2;

  // Shrink the type until the sentence fits in two lines, then let it run to three.
  let size = 52;
  let lines;
  do {
    ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
    lines = wrapText(ctx, sentence, maxWidth);
    size -= 4;
  } while (lines.length > 2 && size > 32);
  size += 4;

  const lineH = Math.round(size * 1.2);
  const creditGap = 34;
  const band = Math.round(28 + lines.length * lineH + creditGap + 18);

  const scrim = top
    ? ctx.createLinearGradient(0, 0, 0, band)
    : ctx.createLinearGradient(0, OUT_H, 0, OUT_H - band);
  scrim.addColorStop(0, 'rgba(8,10,14,0.82)');
  scrim.addColorStop(1, 'rgba(8,10,14,0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, top ? 0 : OUT_H - band, OUT_W, band);

  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = '#fff';

  let y = (top ? 28 : OUT_H - band + 28) + size;
  for (const line of lines) {
    ctx.fillText(line, padX, y);
    y += lineH;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '400 17px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`Backdrop: ${landmark.credit} / ${landmark.license} / Wikimedia Commons`, padX + 2, y - lineH + creditGap);
}
