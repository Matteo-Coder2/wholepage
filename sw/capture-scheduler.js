// Quota-aware wrapper around chrome.tabs.captureVisibleTab.
//
// Chrome hard-limits captureVisibleTab to MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
// (2/sec since Chrome 92). Exceeding it throws — competitors crash here (pain #11).
// A quota error is a scheduling event, never a user-visible failure.

const MIN_SPACING_MS = 600; // ~1.66/sec, safely under the 2/sec cap
const MAX_RETRIES = 4;

let lastCaptureAt = 0;
let chain = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Capture the visible viewport of the focused tab in `windowId` as a PNG data URL.
 * Serialized + spaced; retries with exponential backoff on quota errors.
 * @returns {Promise<string>} data URL
 */
export function captureTile(windowId) {
  // Serialize all captures through one chain so parallel callers can't burst the quota.
  const run = chain.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCaptureAt + MIN_SPACING_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        lastCaptureAt = Date.now();
        if (!dataUrl) throw new Error('captureVisibleTab returned empty result');
        return dataUrl;
      } catch (err) {
        lastCaptureAt = Date.now();
        const msg = String((err && err.message) || err);
        const isQuota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|rate/i.test(msg);
        if (attempt < MAX_RETRIES && isQuota) {
          await sleep(MIN_SPACING_MS * Math.pow(2, attempt));
          continue;
        }
        if (attempt < 1 && !isQuota) {
          // One free retry for transient failures (tab busy, compositor hiccup).
          await sleep(400);
          continue;
        }
        throw new Error('capture failed: ' + msg);
      }
    }
  });
  // Keep the chain alive even when a capture ultimately fails.
  chain = run.catch(() => {});
  return run;
}

/** Decode a data URL into an ImageBitmap (works in MV3 service workers). */
export async function decodeTile(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}
