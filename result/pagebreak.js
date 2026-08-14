// PDF page planning. A fixed-height split can land mid-sentence, and every
// viewer then draws its page separator straight through the text. plan() moves
// each cut up to the nearest visually quiet rows (whitespace, solid background)
// so page joins fall between content like a real document's page breaks.
'use strict';

/* exported WPPageBreak */
const WPPageBreak = (() => {
  const WINDOW_MAX = 900;   // device px searched above the exact A-ratio cut
  const WINDOW_FRAC = 0.3;  // never shrink a page by more than 30%
  const PIXEL_DELTA = 12;   // per-channel row-to-row change that counts as ink

  function drawRegion(ctx, bands, r, y, h) {
    for (const band of bands) {
      const top = Math.max(r.y + y, band.y);
      const bot = Math.min(r.y + y + h, band.y + band.canvas.height);
      if (bot <= top) continue;
      ctx.drawImage(band.canvas, r.x, top - band.y, r.w, bot - top, 0, top - (r.y + y), r.w, bot - top);
    }
  }

  // Height for the page starting at row y, at most h: the exact cut unless a
  // run of still rows (each nearly identical to the row beneath it) exists in
  // the search window. Vertical borders stay still row-to-row, so sidebars and
  // table edges don't block a cut; text and photos do.
  function quietCut(bands, r, s, y, h) {
    const win = Math.min(Math.floor(h * WINDOW_FRAC), WINDOW_MAX);
    if (win < 24) return h;
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = win;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, r.w, win);
    drawRegion(ctx, bands, r, y + h - win, win);
    const px = ctx.getImageData(0, 0, r.w, win).data;
    const stride = r.w * 4;
    const allow = Math.max(4, Math.floor(r.w * 0.002));
    const busy = new Uint8Array(win - 1);
    for (let i = 0; i < win - 1; i++) {
      let changed = 0;
      for (let o = i * stride; o < (i + 1) * stride; o += 4) {
        if (Math.abs(px[o] - px[o + stride]) > PIXEL_DELTA ||
            Math.abs(px[o + 1] - px[o + stride + 1]) > PIXEL_DELTA ||
            Math.abs(px[o + 2] - px[o + stride + 2]) > PIXEL_DELTA) {
          if (++changed > allow) break;
        }
      }
      busy[i] = changed > allow ? 1 : 0;
    }
    // Bottom-up: the lowest run keeps pages as full as possible. Tiers are in
    // CSS px (scaled by s) so Retina leading doesn't pass for a paragraph gap:
    // paragraph-size gaps first, then the leading between two text lines.
    const keep = Math.max(4, Math.round(4 * s)); // quiet rows left above next page's content
    for (const minRun of [Math.round(18 * s), Math.round(8 * s)]) {
      let run = 0;
      for (let i = win - 2; i >= 0; i--) {
        run = busy[i] ? 0 : run + 1;
        if (run >= minRun) return (h - win) + Math.max(i, i + run - 1 - keep) + 1;
      }
    }
    return h; // window is solid content (e.g. a photo) — keep the exact cut
  }

  /** @returns {{rects: Array<{y:number,h:number}>, pageWPt: number}} */
  function plan(r, s, bands) {
    const wCss = r.w / (s || 1);
    const pageWPt = wCss * 0.75;
    const chunkH = Math.max(200, Math.round(Math.SQRT2 * r.w)); // A-series aspect
    const rects = [];
    for (let y = 0; y < r.h;) {
      let h = Math.min(chunkH, r.h - y);
      if (y + h < r.h) h = quietCut(bands, r, s || 1, y, h);
      rects.push({ y, h });
      y += h;
    }
    return { rects, pageWPt };
  }

  return { plan, drawRegion };
})();
