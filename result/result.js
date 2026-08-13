// Result page: progressive stitcher + exports.
// Stitching happens HERE (a visible extension page), not in the service worker:
// it can't be idle-killed, has full canvas/OPFS access, and the user literally
// watches the page assemble — the honest progress bar (pain #11).
'use strict';

const BAND_H = 8192;           // device px per band canvas (memory discipline, pain #8)
const MAX_SIDE = 16384;        // Chrome canvas per-side practical limit
const MAX_AREA = 200e6;        // stay under the ~268MP canvas area ceiling with margin
const SLICE_H = 16000;         // ZIP slice height

const $ = (id) => document.getElementById(id);
const captureId = location.hash.slice(1);

const state = {
  meta: null,
  s: null,               // device px per CSS px (measured, never assumed — pain #16)
  W: 0,                  // output width, device px
  totalH: 0,             // output height, device px
  bands: [],             // [{canvas, ctx, y}]
  cursorY: 0,
  received: 0,
  finalized: false,
  crop: null,            // {x, y, w, h} device px
  croppedView: null,
  settings: { filenameTemplate: '{title} {date}', jpegQuality: 0.92 },
};

// storage.LOCAL, never sync — sync would upload settings to the user's Google
// account, contradicting "nothing leaves your device".
chrome.storage.local.get(state.settings).then((s) => { state.settings = s; });

// ---------- band plumbing ----------
function bandFor(y) {
  const idx = Math.floor(y / BAND_H);
  while (state.bands.length <= idx) {
    const start = state.bands.length * BAND_H;
    const h = Math.min(BAND_H, state.totalH - start);
    if (h <= 0) break;
    const canvas = document.createElement('canvas');
    canvas.width = state.W;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height); // alpha:false canvases start BLACK
    $('stage').appendChild(canvas);
    state.bands.push({ canvas, ctx, y: start });
  }
  return state.bands[idx] || null;
}

/** Draw a source rect of the bitmap at output row destY, across band boundaries. */
function drawToBands(bmp, srcX, srcY, w, h, destY) {
  let done = 0;
  while (done < h) {
    const y = destY + done;
    const band = bandFor(y);
    if (!band) break;
    const inBandY = y - band.y;
    const chunk = Math.min(h - done, band.canvas.height - inBandY);
    if (chunk <= 0) break;
    band.ctx.drawImage(bmp, srcX, srcY + done, w, chunk, 0, inBandY, w, chunk);
    done += chunk;
  }
}

// ---------- tile geometry ----------
async function onTile(msg) {
  const bmp = await createImageBitmap(await (await fetch(msg.dataUrl)).blob());
  const m = state.meta;

  if (state.s === null) {
    // Empirical scale: absorbs DPR × browser zoom × OS scaling in one number.
    // Visible/fallback captures carry no page width — the result page's own
    // devicePixelRatio (same display) keeps PDF page sizes physical.
    state.s = m.innerWidthCss ? bmp.width / m.innerWidthCss : (self.devicePixelRatio || 1);
    if (m.mode === 'full') {
      state.W = Math.min(bmp.width, Math.round(m.widthCss * state.s));
      state.totalH = computeTotalH(m);
    } else if (m.mode === 'area') {
      state.W = Math.round(m.cropCss.w * state.s);
      state.totalH = Math.round(m.cropCss.h * state.s);
    } else {
      state.W = bmp.width;
      state.totalH = bmp.height;
    }
  }

  if (m.mode === 'visible') {
    drawToBands(bmp, 0, 0, state.W, state.totalH, 0);
  } else if (m.mode === 'area') {
    drawToBands(bmp, Math.round(m.cropCss.x * state.s), Math.round(m.cropCss.y * state.s), state.W, state.totalH, 0);
  } else if (m.scroller === 'element') {
    drawInnerTile(bmp, msg);
  } else {
    drawWindowTile(bmp, msg);
  }

  (state.tileLog || (state.tileLog = [])).push({ i: msg.index, actualY: msg.actualY, h: bmp.height });
  bmp.close();
  state.received++;
  $('status').textContent = `Assembling… tile ${state.received} of ${m.tiles}`;
}

function computeTotalH(m) {
  if (m.scroller === 'element') {
    const r = m.scrollerRect;
    const top = Math.round(r.top * state.s);
    const bottom = Math.round((m.pageViewportCss - r.bottom) * state.s);
    return top + Math.round(m.totalCss * state.s) + Math.max(0, bottom);
  }
  return Math.round(m.totalCss * state.s);
}

function drawWindowTile(bmp, msg) {
  let destY = Math.round(msg.actualY * state.s);
  let srcTop = 0;
  if (destY < state.cursorY) {         // final tile overlaps: crop the SOURCE top
    srcTop = state.cursorY - destY;
    destY = state.cursorY;
  } else if (destY > state.cursorY && destY - state.cursorY <= 3 && state.cursorY > 0) {
    destY = state.cursorY;             // fractional-zoom rounding gap: snap shut, no white seam
  }
  // The bitmap can be taller than the scroll step (innerHeight includes a
  // horizontal scrollbar; the step uses clientHeight) — cap the source so the
  // scrollbar strip is never stitched in.
  const usableH = state.meta.viewportCss
    ? Math.min(bmp.height, Math.round(state.meta.viewportCss * state.s))
    : bmp.height;
  const drawH = Math.min(usableH - srcTop, state.totalH - destY);
  if (drawH <= 0) return;
  drawToBands(bmp, 0, srcTop, state.W, drawH, destY);
  state.cursorY = destY + drawH;
}

function drawInnerTile(bmp, msg) {
  // App-shell geometry: shell chrome appears once (tile 0), inner scroller content
  // flows beneath it, bottom chrome appended after the last tile (pain #9).
  const m = state.meta;
  const rTop = Math.round(m.scrollerRect.top * state.s);
  const rBot = Math.round(m.scrollerRect.bottom * state.s);
  const innerEnd = rTop + Math.round(m.totalCss * state.s);

  if (msg.index === 0) {
    const h = Math.min(rBot, state.totalH);
    drawToBands(bmp, 0, 0, state.W, h, 0);
    state.cursorY = h;
  } else {
    let destY = rTop + Math.round(msg.actualY * state.s);
    let srcTop = rTop;
    if (destY < state.cursorY) { srcTop += state.cursorY - destY; destY = state.cursorY; }
    const drawH = Math.min(rBot - srcTop, innerEnd - destY);
    if (drawH > 0) {
      drawToBands(bmp, 0, srcTop, state.W, drawH, destY);
      state.cursorY = destY + drawH;
    }
  }
  if (msg.index === m.tiles - 1 && bmp.height > rBot) {
    drawToBands(bmp, 0, rBot, state.W, bmp.height - rBot, innerEnd); // bottom chrome
  }
}

// ---------- composition & exports ----------
function effective() {
  const c = state.crop;
  return c || { x: 0, y: 0, w: state.W, h: state.totalH };
}
function fitsSingle(r, scale = 1) {
  const w = r.w * scale; const h = r.h * scale;
  return w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA;
}

function compose(scale = 1) {
  const r = effective();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.w * scale);
  canvas.height = Math.round(r.h * scale);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const band of state.bands) {
    const top = Math.max(r.y, band.y);
    const bot = Math.min(r.y + r.h, band.y + band.canvas.height);
    if (bot <= top) continue;
    ctx.drawImage(
      band.canvas,
      r.x, top - band.y, r.w, bot - top,
      0, Math.round((top - r.y) * scale), Math.round(r.w * scale), Math.round((bot - top) * scale)
    );
  }
  return canvas;
}

function toBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));
}

function filename(ext) {
  const t = state.settings.filenameTemplate || '{title} {date}';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  let host = '';
  try { host = new URL(state.meta.url).hostname; } catch (_) {}
  const raw = t.replaceAll('{title}', state.meta.title || 'page').replaceAll('{date}', date).replaceAll('{host}', host);
  let stem = raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/^[.\s]+/, '');
  stem = Array.from(stem).slice(0, 120).join('').trim(); // code-POINT slice: never splits an emoji
  if (!stem) stem = 'capture'; // empty titles / dot-only names must still download
  return stem + '.' + ext;
}

async function download(blob, name) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: name });
    flash(`Saved: ${name}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function flash(text) {
  $('status').textContent = text;
  $('stage').classList.remove('flash');
  void $('stage').offsetWidth;
  $('stage').classList.add('flash');
}

async function savePng() {
  if (!fitsSingle(effective())) { $('oversize').hidden = false; return; }
  await download(await toBlob(compose(), 'image/png'), filename('png'));
}

async function copyImage() {
  if (!fitsSingle(effective())) { $('oversize').hidden = false; return; }
  const blob = await toBlob(compose(), 'image/png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  flash('Copied to clipboard ✓');
}

async function savePdf() {
  const r = effective();
  const wCss = r.w / (state.s || 1);
  const pageWPt = wCss * 0.75;
  const pageHPt = pageWPt * Math.SQRT2; // A-series aspect
  const chunkH = Math.max(200, Math.round(r.h === 0 ? 1 : (pageHPt / pageWPt) * r.w));
  const pages = [];
  for (let y = 0; y < r.h; y += chunkH) {
    const h = Math.min(chunkH, r.h - y);
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, r.w, h);
    for (const band of state.bands) {
      const top = Math.max(r.y + y, band.y);
      const bot = Math.min(r.y + y + h, band.y + band.canvas.height);
      if (bot <= top) continue;
      ctx.drawImage(band.canvas, r.x, top - band.y, r.w, bot - top, 0, top - (r.y + y), r.w, bot - top);
    }
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', state.settings.jpegQuality)).arrayBuffer());
    pages.push({ jpeg, wPx: r.w, hPx: h, wPt: pageWPt, hPt: (h / r.w) * pageWPt });
  }
  await download(WPPdf.build(pages), filename('pdf'));
}

async function saveZip() {
  const r = effective();
  const files = [];
  let n = 1;
  for (let y = 0; y < r.h; y += SLICE_H) {
    const h = Math.min(SLICE_H, r.h - y);
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    for (const band of state.bands) {
      const top = Math.max(r.y + y, band.y);
      const bot = Math.min(r.y + y + h, band.y + band.canvas.height);
      if (bot <= top) continue;
      ctx.drawImage(band.canvas, r.x, top - band.y, r.w, bot - top, 0, top - (r.y + y), r.w, bot - top);
    }
    files.push({ name: `slice-${String(n++).padStart(2, '0')}.png`, data: new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer()) });
  }
  await download(WPZip.build(files), filename('zip'));
}

async function saveScaled() {
  const r = effective();
  let scale = 1;
  while (!fitsSingle(r, scale)) scale *= 0.75;
  await download(await toBlob(compose(scale), 'image/png'), filename('png'));
  flash(`Saved downscaled to ${Math.round(scale * 100)}% (original was too tall for one image)`);
}

// ---------- crop ----------
// Explicit MODE with visible feedback: entering crop shows an instruction
// banner, dims the image, and arms Esc — "I clicked Crop and nothing happened"
// was a real user report against the invisible-layer version.
let cropping = false;
let cropDrag = null; // { startStage, lastClient, raf } while a drag is live

// All selection math lives in STAGE coordinates (relative to the image), not
// client coordinates — that is what lets the page auto-scroll mid-drag while
// the anchored corner stays put.
const stageRectNow = () => $('stage').getBoundingClientRect();
function toStage(cx, cy) {
  const r = stageRectNow();
  return {
    x: Math.max(0, Math.min(r.width, cx - r.left)),
    y: Math.max(0, Math.min(r.height, cy - r.top)),
  };
}

function renderCropBox() {
  if (!cropDrag) return;
  const box = $('crop-layer').firstChild;
  const cur = toStage(cropDrag.lastClient.x, cropDrag.lastClient.y);
  const r = stageRectNow();
  const lr = $('crop-layer').getBoundingClientRect();
  box.style.left = Math.min(cropDrag.startStage.x, cur.x) + (r.left - lr.left) + 'px';
  box.style.top = Math.min(cropDrag.startStage.y, cur.y) + (r.top - lr.top) + 'px';
  box.style.width = Math.abs(cur.x - cropDrag.startStage.x) + 'px';
  box.style.height = Math.abs(cur.y - cropDrag.startStage.y) + 'px';
}

// While dragging near the top/bottom edge of the window, scroll the page so a
// selection can extend beyond what is currently on screen (user request).
// Driven by a timer, not requestAnimationFrame: rAF starves when the window
// loses focus or is occluded, silently freezing the auto-scroll mid-drag.
function cropAutoScroll() {
  if (!cropDrag) return;
  const EDGE = 80;   // px-wide hot zone at each edge
  const TOP = 64;    // sticky action bar height
  const MAXV = 42;   // px/step at full proximity
  const y = cropDrag.lastClient.y;
  let v = 0;
  if (y > innerHeight - EDGE) v = MAXV * Math.min(1, (y - (innerHeight - EDGE)) / EDGE);
  else if (y < TOP + EDGE) v = -MAXV * Math.min(1, (TOP + EDGE - y) / EDGE);
  if (v) { window.scrollBy(0, v); renderCropBox(); }
}

function cropMove(e) {
  if (!cropDrag) return;
  cropDrag.lastClient = { x: e.clientX, y: e.clientY };
  renderCropBox();
  e.preventDefault();
}

function cropUp(e) {
  if (!cropDrag) return;
  const start = cropDrag.startStage;
  const end = toStage(e.clientX, e.clientY);
  // Convert relative to what the stage currently SHOWS — after a first crop
  // that is the cropped region, so a refinement crop must offset into it and
  // scale by ITS width, not the full image's.
  const base = effective();
  const scale = base.w / stageRectNow().width; // display px → device px of the shown region
  exitCropMode();
  // Round the corners, derive the size — x+w may never exceed the base edge.
  const x1 = Math.round(Math.min(start.x, end.x) * scale);
  const y1 = Math.round(Math.min(start.y, end.y) * scale);
  const x2 = Math.min(base.w, Math.round(Math.max(start.x, end.x) * scale));
  const y2 = Math.min(base.h, Math.round(Math.max(start.y, end.y) * scale));
  if (x2 - x1 < 8 || y2 - y1 < 8) { flash('Selection too small — crop cancelled'); return; }
  state.crop = { x: base.x + x1, y: base.y + y1, w: x2 - x1, h: y2 - y1 };
  // Display: always fits (downscaled if the cropped region is still huge).
  let fit = 1;
  while (!fitsSingle(state.crop, fit)) fit *= 0.75;
  const view = compose(fit);
  $('stage').replaceChildren(view);
  state.croppedView = view;
  $('btn-reset').hidden = false;
  flash('Cropped — Reset to undo');
}

function exitCropMode() {
  cropping = false;
  document.body.classList.remove('cropping');
  $('crop-tip').hidden = true;
  $('crop-layer').hidden = true;
  $('btn-crop').textContent = 'Crop';
  window.removeEventListener('keydown', cropEsc, true);
  window.removeEventListener('mousemove', cropMove, true);
  window.removeEventListener('mouseup', cropUp, true);
  if (cropDrag && cropDrag.timer) clearInterval(cropDrag.timer);
  cropDrag = null;
}

function cropEsc(e) {
  if (e.key === 'Escape') { e.preventDefault(); exitCropMode(); flash('Crop cancelled'); }
}

function startCrop() {
  if (cropping) { exitCropMode(); flash('Crop cancelled'); return; }
  // Oversize captures MAY be cropped — that is exactly how a user cuts a
  // too-tall capture down to a savable region. The drag works on the band
  // canvases; only the post-crop display is (down)scaled to fit.
  cropping = true;
  document.body.classList.add('cropping');
  $('crop-tip').hidden = false;
  $('btn-crop').textContent = 'Cancel crop';
  window.addEventListener('keydown', cropEsc, true);
  const layer = $('crop-layer');
  layer.hidden = false;
  layer.innerHTML = '<div class="box" hidden></div>';
  layer.onmousedown = (e) => {
    cropDrag = {
      startStage: toStage(e.clientX, e.clientY),
      lastClient: { x: e.clientX, y: e.clientY },
      timer: 0,
    };
    layer.firstChild.hidden = false;
    // Window-level listeners: the drag survives the pointer crossing the
    // sticky bar or leaving the layer while the page auto-scrolls.
    window.addEventListener('mousemove', cropMove, true);
    window.addEventListener('mouseup', cropUp, true);
    cropDrag.timer = setInterval(cropAutoScroll, 16);
    e.preventDefault();
  };
}

function resetCrop() {
  state.crop = null;
  state.croppedView = null;
  $('stage').replaceChildren(...state.bands.map((b) => b.canvas));
  $('btn-reset').hidden = true;
  flash('Crop removed');
}

// OPFS tile persistence was REMOVED after review: it was write-only (no
// recovery path existed), so it silently accumulated every screenshot ever
// taken in hidden storage — a disk leak and a residual-privacy problem for
// zero benefit. Clean up anything an earlier version left behind.
navigator.storage.getDirectory()
  .then((root) => root.removeEntry('captures', { recursive: true }))
  .catch(() => {});

// ---------- wiring ----------
const port = chrome.runtime.connect({ name: 'wp-result:' + captureId });
const queue = [];
let processing = false;
port.onMessage.addListener((msg) => { queue.push(msg); pump(); });

async function pump() {
  if (processing) return;
  processing = true;
  while (queue.length) {
    const msg = queue.shift();
    try {
      if (msg.type === 'meta') {
        state.meta = msg;
        document.title = `WholePage – ${msg.title || 'capture'}`;
        if (msg.note) {
          $('note').textContent = (msg.noteLevel === 'warn' ? '⚠ ' : '') + msg.note;
          $('note').classList.toggle('warn', msg.noteLevel === 'warn');
          $('note').hidden = false;
        }
      } else if (msg.type === 'tile') {
        await onTile(msg);
      } else if (msg.type === 'abort-note') {
        $('note').textContent = '⚠ ' + msg.note;
        $('note').classList.add('warn');
        $('note').hidden = false;
      } else if (msg.type === 'finalize') {
        state.finalized = true;
        $('status').textContent = `Done — ${Math.round(state.W).toLocaleString('en-US')} × ${Math.round(state.totalH).toLocaleString('en-US')} px`;
        $('actions').hidden = false;
        if (!fitsSingle(effective())) {
          $('oversize').hidden = false;
          $('scale-note').textContent = '';
        }
      } else if (msg.type === 'fatal') {
        $('status').textContent = 'Capture failed: ' + msg.reason;
      }
    } catch (err) {
      $('status').textContent = 'Problem while assembling: ' + String((err && err.message) || err);
    }
  }
  processing = false;
}

$('btn-copy').onclick = () => copyImage().catch((e) => flash('Copy failed: ' + e.message));
$('btn-png').onclick = () => savePng().catch((e) => flash('Save failed: ' + e.message));
$('btn-pdf').onclick = () => savePdf().catch((e) => flash('PDF failed: ' + e.message));
$('btn-pdf2').onclick = () => savePdf().catch((e) => flash('PDF failed: ' + e.message));
$('btn-zip').onclick = () => saveZip().catch((e) => flash('ZIP failed: ' + e.message));
$('btn-scaled').onclick = () => saveScaled().catch((e) => flash('Save failed: ' + e.message));
$('btn-crop').onclick = startCrop;
$('btn-reset').onclick = resetCrop;

// Test hook for the regression harness (pixel assertions run in-page).
globalThis.__wpResultTest = { state, compose, effective };
