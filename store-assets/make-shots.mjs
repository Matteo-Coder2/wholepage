// Store-asset generator. Every marketing pixel is produced by this script from
// files in this repo (asset-provenance requirement — nothing third-party).
// Usage: node store-assets/make-shots.mjs raw     → raw UI screenshots
//        node store-assets/make-shots.mjs stages  → final 1280×800 store PNGs
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const f = (p) => 'file://' + join(root, p);

const mode = process.argv[2] || 'raw';
const browser = await chromium.launch();

async function shot(opts) {
  const page = await browser.newPage({
    viewport: { width: opts.w, height: opts.h },
    deviceScaleFactor: opts.dsf || 2,
  });
  await page.goto(opts.url);
  if (opts.prep) await page.evaluate(opts.prep);
  if (opts.scrollY) await page.evaluate((y) => window.scrollTo(0, y), opts.scrollY);
  await page.waitForTimeout(250);
  if (opts.el) {
    // Element screenshot: crops to actual content height — a fixed viewport
    // leaves dead bone space inside the card border (judge finding).
    await page.locator(opts.el).screenshot({ path: join(out, opts.name) });
  } else {
    await page.screenshot({ path: join(out, opts.name), fullPage: false });
  }
  await page.close();
  console.log('  ', opts.name);
}

if (mode === 'raw') {
  // Sticky-fence "before": three naive viewport strips of our demo article —
  // the pinned nav photographed in every strip, exactly what bad stitching does.
  for (const [i, y] of [[1, 640], [2, 1280], [3, 1920]]) {
    await shot({ url: f('store-assets/demo-page.html'), w: 860, h: 560, dsf: 2, scrollY: y, name: `fence-${i}.png` });
  }
  // Popup, resting state (focus ring on Full page comes from autofocus).
  await shot({ url: f('popup/popup.html'), w: 300, h: 424, el: 'body', name: 'popup-modes.png' });
  // Popup, mid-capture: the ruler filling tile by tile.
  await shot({
    url: f('popup/popup.html'), w: 300, h: 300, el: 'body', name: 'popup-progress.png',
    prep: () => {
      document.getElementById('modes').hidden = true;
      document.getElementById('progress').hidden = false;
      document.getElementById('progress-text').textContent = 'Capturing tile 14 of 23…';
      document.getElementById('progress-fill').style.width = '61%';
    },
  });
  // Result page with the real engine capture mounted, oversize choices shown.
  await shot({
    url: f('result/result.html'), w: 1180, h: 740, name: 'result-oversize.png',
    prep: () => {
      document.getElementById('status').textContent = 'Done — 2,560 × 96,676 px';
      document.getElementById('actions').hidden = false;
      document.getElementById('oversize').hidden = false;
      const img = document.createElement('img');
      img.src = '../store-assets/capture-demo.png';
      img.style.cssText = 'display:block;width:560px;height:auto;';
      document.getElementById('stage').appendChild(img);
    },
  });
} else {
  for (let i = 1; i <= 5; i++) {
    await shot({ url: f(`store-assets/stage-${i}.html`), w: 1280, h: 800, dsf: 2, name: `store-${i}.png` });
  }
}

await browser.close();
console.log('done:', mode);
