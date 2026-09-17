// Puts the cutout into the backdrop. Pure drawing: everything it needs is passed in,
// which keeps it testable without the rest of the page.

export const OUT_W = 1600;
export const OUT_H = 1000;

export const defaultSettings = {
  tolerance: 0.22,
  softness: 0.18,
  shrink: 1,
  spill: 0.9,
  size: 0.62,
  caption: true,
};

/** Scale-to-fill geometry, the canvas equivalent of `background-size: cover`. */
export function coverRect(imgW, imgH, boxW, boxH) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Where the subject stands. Rolled once per generate so slider tweaks don't move them. */
export function randomPlacement(rand = Math.random) {
  return {
    footY: 0.80 + rand() * 0.14,   // feet land in the lower fifth of the frame
    centerX: 0.30 + rand() * 0.40, // kept off the very edges
    sizeJitter: 0.92 + rand() * 0.16,
    flip: rand() < 0.25,
  };
}

export function renderScene(canvas, { background, cutout, landmark, settings, placement }) {
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, OUT_W, OUT_H);

  const bg = coverRect(background.width, background.height, OUT_W, OUT_H);
  ctx.drawImage(background, bg.x, bg.y, bg.w, bg.h);

  if (cutout) {
    const place = placement ?? randomPlacement();
    const targetH = OUT_H * Number(settings.size) * place.sizeJitter;
    const scale = targetH / cutout.height;
    const w = cutout.width * scale;
    const h = cutout.height * scale;
    const x = OUT_W * place.centerX - w / 2;
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

  if (settings.caption && landmark) drawCaption(ctx, landmark);
  return canvas;
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

function drawCaption(ctx, landmark) {
  const scrim = ctx.createLinearGradient(0, OUT_H - 230, 0, OUT_H);
  scrim.addColorStop(0, 'rgba(8,10,14,0)');
  scrim.addColorStop(1, 'rgba(8,10,14,0.8)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, OUT_H - 230, OUT_W, 230);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = '600 54px Georgia, "Times New Roman", serif';
  ctx.fillText(landmark.name, 56, OUT_H - 88);

  ctx.fillStyle = 'rgba(255,255,255,0.74)';
  ctx.font = '400 25px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.letterSpacing = '0.12em';
  ctx.fillText(landmark.place.toUpperCase(), 58, OUT_H - 52);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '400 17px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`Backdrop: ${landmark.credit} / ${landmark.license} / Wikimedia Commons`, 58, OUT_H - 22);
}
