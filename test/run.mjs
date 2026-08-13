// WholePage regression harness.
// Each corpus page targets one category failure mode; assertions are pixel reads
// against the assembled output. The corpus is the moat (pains #1, #14).
//
// The harness drives capture by evaluating in the extension's service worker
// (toolbars can't be clicked programmatically). It runs a TEST BUILD with
// host_permissions added, because activeTab can't be granted synthetically —
// the shipped manifest stays activeTab-only.
// Bundled Chromium, NOT channel:'chrome' — branded Chrome 137+ dropped
// --load-extension support.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, cpSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8899;
let failures = 0;

function report(name, ok, detail = '') {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ---------- test build (shipped manifest stays activeTab-only) ----------
function makeTestBuild() {
  const dir = join(mkdtempSync(join(tmpdir(), 'wp-build-')), 'ext');
  cpSync(root, dir, {
    recursive: true,
    filter: (src) => !/\/(\.git|\.test-build|node_modules|test|docs)(\/|$)/.test(src),
  });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  manifest.name += ' (TEST BUILD)';
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

// ---------- corpus server ----------
function serve() {
  const server = createServer((req, res) => {
    try {
      const file = join(root, 'test', 'pages', req.url.replace(/^\/+/, '').split('?')[0]);
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': extname(file) === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

// ---------- capture driver ----------
async function capture(context, url, mode = 'full') {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForTimeout(300);

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
  await sw.evaluate(async (m) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await globalThis.__wpTest.runCapture(tab, m);
  }, mode);

  let result = null;
  for (let i = 0; i < 50 && !result; i++) {
    result = context.pages().find((p) => p.url().includes('result/result.html'));
    if (!result) await page.waitForTimeout(100);
  }
  if (!result) throw new Error('result page did not open');
  await result.waitForFunction(
    () => /^(Done|Capture failed)/.test(document.getElementById('status').textContent),
    null, { timeout: 120000 }
  );
  const status = await result.evaluate(() => document.getElementById('status').textContent);
  if (!status.startsWith('Done')) throw new Error(status);
  return { page, result };
}

// Pixel probe, evaluated inside the result page (reads band canvases directly).
const PROBES = `
  const T = globalThis.__wpResultTest;
  const bands = T.state.bands;
  function px(x, y) {
    for (const b of bands) {
      if (y >= b.y && y < b.y + b.canvas.height) {
        return [...b.ctx.getImageData(Math.round(x), Math.round(y - b.y), 1, 1).data];
      }
    }
    return null;
  }
  function near(c, target, tol = 14) {
    return c && Math.abs(c[0]-target[0])<=tol && Math.abs(c[1]-target[1])<=tol && Math.abs(c[2]-target[2])<=tol;
  }
  function cssColor(spec) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d'); cx.fillStyle = spec; cx.fillRect(0,0,1,1);
    return [...cx.getImageData(0,0,1,1).data];
  }
  // Contiguous vertical runs of a color at column x, scanning every "step" rows.
  function runsOf(target, x, step = 3, tol = 14) {
    let runs = 0, inRun = false;
    for (let y = 0; y < T.state.totalH; y += step) {
      const hit = near(px(x, y), target, tol);
      if (hit && !inRun) { runs++; inRun = true; }
      if (!hit) inRun = false;
    }
    return runs;
  }
`;

// ---------- tests ----------
async function testRuler(context, dprLabel) {
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/ruler.html`);
  const r = await result.evaluate(`(() => { ${PROBES}
    const s = T.state.s;
    const out = { s, totalH: T.state.totalH, expectedH: Math.round(30000 * s), bad: [] };
    for (const i of [3, 50, 150, 290]) {
      const want = cssColor('hsl(' + ((i * 47) % 360) + ' 80% 60%)');
      const got = px(T.state.W * 0.7, (i * 100 + 50) * s);
      if (!near(got, want)) out.bad.push({ i, want, got });
    }
    return out;
  })()`);
  report(`ruler${dprLabel}: height exact`, Math.abs(r.totalH - r.expectedH) <= 3, `${r.totalH} vs ${r.expectedH} (s=${r.s.toFixed(3)})`);
  report(`ruler${dprLabel}: bands at exact rows (no seam drift)`, r.bad.length === 0, JSON.stringify(r.bad).slice(0, 200));
  if (r.bad.length && process.env.DUMP) {
    const log = await result.evaluate(() => JSON.stringify(globalThis.__wpResultTest.state.tileLog));
    console.log('    tileLog:', log);
    const dataUrl = await result.evaluate(() => globalThis.__wpResultTest.compose(0.08).toDataURL());
    const { writeFileSync: wf } = await import('node:fs');
    wf(join(root, 'test', `debug-ruler${dprLabel || ''}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('    dumped test/debug-ruler.png');
  }
  await result.close(); await page.close();
}

async function testFixed(context) {
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/fixed.html`);
  const r = await result.evaluate(`(() => { ${PROBES}
    const s = T.state.s;
    const vp = T.state.meta.viewportCss * s;
    const x = T.state.W / 2;
    let redBelowViewport = 0, magenta = 0;
    for (let y = 0; y < T.state.totalH; y += 2) {
      const c = px(x, y);
      if (near(c, [255,0,0]) && y > vp) redBelowViewport++;
      if (near(c, [255,0,255])) magenta++;
    }
    return {
      redAtTop: near(px(x, 20 * s), [255,0,0]),
      redBelowViewport, magenta,
      stickyRuns: runsOf([255,128,0], x),
    };
  })()`);
  report('fixed: header present at top', r.redAtTop);
  report('fixed: header NOT fenced down the page', r.redBelowViewport === 0, `${r.redBelowViewport} red rows below viewport`);
  report('fixed: bottom cookie bar fully suppressed', r.magenta === 0, `${r.magenta} magenta rows`);
  report('fixed: sticky bar appears exactly once', r.stickyRuns === 1, `${r.stickyRuns} runs`);
  await result.close(); await page.close();
}

async function testLazy(context) {
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/lazy.html`);
  const r = await result.evaluate(`(() => { ${PROBES}
    const s = T.state.s;
    let gray = 0, blue = 0;
    for (let i = 0; i < 36; i++) {
      const y = (20 + 150 + i * 320) * s;
      const c = px(T.state.W / 2, y);
      if (near(c, [128,128,128])) gray++;
      if (near(c, [0,80,255])) blue++;
    }
    return { gray, blue };
  })()`);
  report('lazy: zero blank placeholders', r.gray === 0, `${r.gray} gray boxes`);
  report('lazy: lazy content actually captured', r.blue === 36, `${r.blue}/36 loaded`);
  await result.close(); await page.close();
}

async function testInner(context) {
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/inner.html`);
  const r = await result.evaluate(`(() => { ${PROBES}
    const s = T.state.s;
    const expected = Math.round((60 + 8000 + 40) * s);
    return {
      totalH: T.state.totalH, expected,
      scroller: T.state.meta.scroller,
      tealRuns: runsOf([0,150,140], T.state.W / 2),
      footerPresent: near(px(T.state.W / 2, T.state.totalH - 20 * s), [255,140,0]),
    };
  })()`);
  report('inner: inner scroller elected', r.scroller === 'element', r.scroller);
  report('inner: full inner content height', Math.abs(r.totalH - r.expected) <= 8, `${r.totalH} vs ${r.expected}`);
  report('inner: app header appears exactly once', r.tealRuns === 1, `${r.tealRuns} runs`);
  report('inner: bottom chrome appended once at end', r.footerPresent);
  await result.close(); await page.close();
}

async function testInfinite(context) {
  const t0 = Date.now();
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/infinite.html`);
  const r = await result.evaluate(() => ({
    note: globalThis.__wpResultTest.state.meta.note || '',
    totalH: globalThis.__wpResultTest.state.totalH,
  }));
  report('infinite: capture terminates', true, `${Math.round((Date.now() - t0) / 1000)}s, ${r.totalH}px`);
  report('infinite: honest note shown', /keeps loading/i.test(r.note), r.note.slice(0, 80));
  await result.close(); await page.close();
}

async function testClipboardRoundtrip(context) {
  const { page, result } = await capture(context, `http://127.0.0.1:${PORT}/fixed.html`, 'visible');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const ok = await result.evaluate(async () => {
    document.getElementById('btn-copy').click();
    await new Promise((r) => setTimeout(r, 1200));
    const items = await navigator.clipboard.read();
    for (const it of items) if (it.types.includes('image/png')) {
      const blob = await it.getType('image/png');
      return blob.size > 1000;
    }
    return false;
  });
  report('clipboard: PNG round-trips through clipboard.read', ok);
  await result.close(); await page.close();
}

// ---------- main ----------
const server = await serve();
const buildDir = makeTestBuild();

async function launch(dsf) {
  const profile = mkdtempSync(join(tmpdir(), 'wp-test-'));
  return chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: dsf ? { width: 1280, height: 800 } : null,
    deviceScaleFactor: dsf || undefined,
    args: [
      `--disable-extensions-except=${buildDir}`,
      `--load-extension=${buildDir}`,
      '--window-size=1280,900',
      '--no-first-run',
    ],
  });
}

try {
  // REAL=<url>: one-off capture of a live site, dumps test/debug-real.png.
  // Used for the manual pre-release smoke list (ChatGPT, Wikipedia, Amazon…).
  if (process.env.REAL) {
    const ctx = await launch(0);
    const { page, result } = await capture(ctx, process.env.REAL);
    const info = await result.evaluate(() => ({
      s: globalThis.__wpResultTest.state.s,
      W: globalThis.__wpResultTest.state.W,
      H: globalThis.__wpResultTest.state.totalH,
      tiles: globalThis.__wpResultTest.state.received,
      note: globalThis.__wpResultTest.state.meta.note || '',
      scroller: globalThis.__wpResultTest.state.meta.scroller,
    }));
    console.log('REAL capture:', JSON.stringify(info));
    const dataUrl = await result.evaluate(() => globalThis.__wpResultTest.compose(Math.min(1, 1200 / globalThis.__wpResultTest.state.totalH)).toDataURL());
    writeFileSync(join(root, 'test', 'debug-real.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('dumped test/debug-real.png');
    await result.close(); await page.close(); await ctx.close();
    server.close();
    process.exit(0);
  }

  const only = process.env.ONLY; // e.g. ONLY=ruler for fast iteration
  const want = (n) => !only || only === n;

  console.log('▶ corpus @ DPR 1');
  const ctx1 = await launch(0);
  if (want('ruler')) await testRuler(ctx1, '');
  if (want('fixed')) await testFixed(ctx1);
  if (want('lazy')) await testLazy(ctx1);
  if (want('inner')) await testInner(ctx1);
  if (want('infinite')) await testInfinite(ctx1);
  if (want('clipboard')) await testClipboardRoundtrip(ctx1);
  await ctx1.close();

  if (!only || only === 'ruler') {
    console.log('▶ ruler @ DPR 2 (retina seam math)');
    const ctx2 = await launch(2);
    await testRuler(ctx2, '@2x');
    await ctx2.close();
  }
} catch (err) {
  console.error('HARNESS ERROR:', err);
  failures++;
} finally {
  server.close();
}

console.log(failures === 0 ? '\nAll green.' : `\n${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
