// WholePage service worker — capture orchestrator.
// State machine: preflight → inject → measure → prime → plan → tile loop → restore → finalize.
// Every failure path ends in a specific human sentence, never a raw error (pain #17),
// and the page is always restored (pain: "it refreshed the page I'd loaded for an hour").

import { checkRestricted, explainInjectionFailure } from './restricted-urls.js';
import { captureTile, decodeTile } from './capture-scheduler.js';

const CONTENT_FILES = [
  'content/client.js',
  'content/measure.js',
  'content/dom-prep.js',
  'content/prime.js',
  'content/scroller.js',
  'content/area-select.js',
];

/** captureId → { port, buffered: [] } — result tabs connect here. */
const resultPorts = new Map();
let captureBusy = false;

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('wp-result:')) return;
  const id = port.name.slice('wp-result:'.length);
  const entry = resultPorts.get(id) || { port: null, buffered: [], done: false };
  entry.port = port;
  resultPorts.set(id, entry);
  for (const msg of entry.buffered) port.postMessage(msg);
  entry.buffered = [];
  port.onDisconnect.addListener(() => {
    const cur = resultPorts.get(id);
    if (cur && cur.port === port) {
      cur.port = null;
      if (cur.done) resultPorts.delete(id); // tab closed after finalize: free the entry
    }
  });
});

function sendToResult(id, msg) {
  const entry = resultPorts.get(id) || { port: null, buffered: [], done: false };
  resultPorts.set(id, entry);
  if (msg.type === 'finalize' || msg.type === 'fatal') {
    entry.done = true;
    // Backstop: a result tab that never connects must not pin buffered PNG
    // dataURLs in SW memory forever.
    setTimeout(() => { const e = resultPorts.get(id); if (e && !e.port) resultPorts.delete(id); }, 120000);
  }
  if (entry.port) {
    try { entry.port.postMessage(msg); return; } catch (_) { entry.port = null; }
  }
  entry.buffered.push(msg);
}

/** The critical guard: captureVisibleTab shoots the window's ACTIVE tab. If the
 * user switches tabs mid-capture we must stop — silently stitching (and
 * potentially saving) another tab's content is a correctness AND privacy bug. */
async function assertStillActive(tab) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!active || active.id !== tab.id) {
    throw new Error('you switched to another tab, so the capture was stopped to avoid photographing the wrong page');
  }
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {}); // popup may be closed; fine
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f5a' });
    await chrome.action.setBadgeText({ tabId, text });
  } catch (_) { /* tab may be gone */ }
}

function sendToTab(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'preflight') {
    (async () => {
      const tab = await activeTab();
      const res = await checkRestricted(tab);
      sendResponse({ ...res, tabId: tab && tab.id });
    })();
    return true;
  }
  if (msg && msg.type === 'start-capture') {
    (async () => {
      try {
        // The popup names its own tab explicitly — never re-derive it here.
        const tab = msg.tabId != null ? await chrome.tabs.get(msg.tabId) : await activeTab();
        sendResponse({ started: true });
        await runCapture(tab, msg.mode);
      } catch (err) {
        // Nothing may fail silently: the popup shows this instead of hanging.
        try { sendResponse({ started: false }); } catch (_) {}
        notifyPopup({ type: 'error', reason: 'Could not start the capture: ' + String((err && err.message) || err) });
      }
    })();
    return true;
  }
  return false;
});

// NOTE: no custom chrome.commands. Chrome grants activeTab ONLY for
// _execute_action (which opens the popup) — a custom command shortcut would
// run without page access and silently degrade to a viewport capture.

/** Open the result tab (in the background — the captured tab must stay focused). */
async function openResult(captureId, tab) {
  const url = chrome.runtime.getURL(`result/result.html#${captureId}`);
  return chrome.tabs.create({ url, active: false, index: tab.index + 1, windowId: tab.windowId });
}

async function runCapture(tab, mode) {
  if (!tab || tab.id == null) return;
  if (captureBusy) { notifyPopup({ type: 'error', reason: 'A capture is already running.' }); return; }
  captureBusy = true;
  const captureId = `${tab.id}-${Date.now().toString(36)}`;
  let resultTab = null;
  let prepped = false;
  let stage = 'starting';
  let tilesSent = 0;
  try {
    const restricted = await checkRestricted(tab);
    if (restricted.restricted) {
      notifyPopup({ type: 'error', reason: restricted.reason, hint: restricted.hint });
      return;
    }

    // ---- Visible-area: one shot, no scripting needed at all.
    if (mode === 'visible') {
      const dataUrl = await captureTile(tab.windowId);
      resultTab = await openResult(captureId, tab);
      sendToResult(captureId, { type: 'meta', mode, title: tab.title || 'page', url: tab.url, tiles: 1 });
      sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
      sendToResult(captureId, { type: 'finalize' });
      await chrome.tabs.update(resultTab.id, { active: true });
      return;
    }

    // ---- Everything else needs the content scripts.
    try {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      } catch (first) {
        await new Promise((r) => setTimeout(r, 300)); // transient tab states: one retry
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      }
    } catch (err) {
      console.error('[WholePage] inject failed:', err);
      const info = explainInjectionFailure(tab.url || '', String(err && err.message));
      if (info.canVisible) {
        // Honest fallback: capture what we can and say why — loudly.
        const dataUrl = await captureTile(tab.windowId);
        resultTab = await openResult(captureId, tab);
        sendToResult(captureId, { type: 'meta', mode: 'visible', title: tab.title || 'page', url: tab.url, tiles: 1, noteLevel: 'warn', note: `${info.reason} ${info.hint} [detail: ${String(err && err.message).slice(0, 200)}]` });
        sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
        sendToResult(captureId, { type: 'finalize' });
        await chrome.tabs.update(resultTab.id, { active: true });
      } else {
        notifyPopup({ type: 'error', reason: info.reason, hint: info.hint });
      }
      return;
    }

    // ---- Area select: overlay, then one shot cropped in the result page.
    if (mode === 'area') {
      // Keepalive: the user may take >30s to drag; without activity the MV3
      // idle timer would kill this worker mid-wait and the drag would go dead.
      const keepalive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
      let rect;
      try {
        rect = await sendToTab(tab.id, { wp: 'area-select' });
      } finally {
        clearInterval(keepalive);
      }
      if (!rect || rect.cancelled) return;
      await assertStillActive(tab);
      const dataUrl = await captureTile(tab.windowId);
      resultTab = await openResult(captureId, tab);
      sendToResult(captureId, { type: 'meta', mode, title: tab.title || 'page', url: tab.url, tiles: 1, cropCss: rect, innerWidthCss: rect.innerWidth });
      sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
      sendToResult(captureId, { type: 'finalize' });
      await chrome.tabs.update(resultTab.id, { active: true });
      return;
    }

    // ---- Full page. Stage names feed the failure note — a fallback must say
    // exactly which stage died, never just shrug (pain #17).
    stage = 'measure';
    const m = await sendToTab(tab.id, { wp: 'measure' });
    if (m && m.error) throw new Error('measure: ' + m.error);
    prepped = true; // from here on, always restore
    stage = 'freeze';
    await sendToTab(tab.id, { wp: 'freeze' }); // animations/transitions/videos off
    stage = 'lazy-load priming';
    const prime = await sendToTab(tab.id, { wp: 'prime' }); // lazy-load pass; returns final height + growth flag
    if (!prime || prime.error || !prime.totalCss) throw new Error('priming: ' + ((prime && prime.error) || 'no result'));
    if (prime.scrollLocked) throw new Error('the page refused to scroll — a dialog or scroll lock is probably active. Close any popup on the page and try again');
    stage = 'fixed-element scan';
    await sendToTab(tab.id, { wp: 'mark-fixed' }); // walk AFTER priming: catches scroll-swapped sticky headers

    const MAX_TILES = 300; // ≥600ms each — beyond this the wait stops being honest
    const totalCss = prime.totalCss;
    const stepCss = m.viewportCss;
    const positions = [];
    for (let y = 0; y + stepCss < totalCss; y += stepCss) positions.push(y);
    positions.push(Math.max(0, totalCss - stepCss));
    if (positions.length > 1 && positions[positions.length - 1] === positions[positions.length - 2]) positions.pop();
    const capped = positions.length > MAX_TILES;
    if (capped) positions.length = MAX_TILES;

    const notes = [];
    if (prime.infinite) notes.push('This page keeps loading more content as it scrolls. WholePage captured everything that was loaded (' + Math.round(totalCss) + 'px). Need more? Scroll further down first, then capture again.');
    if (capped) notes.push(`This page is extremely long — WholePage captured the first ${MAX_TILES} screens rather than freeze your browser for minutes.`);
    if (m.scrollWidthCss > m.clientWidthCss + 50) notes.push('This page is wider than the window; WholePage captured the visible width.');

    resultTab = await openResult(captureId, tab);
    sendToResult(captureId, {
      type: 'meta', mode, title: m.title, url: m.url, tiles: positions.length,
      widthCss: m.clientWidthCss, totalCss, viewportCss: m.viewportCss,
      innerWidthCss: m.innerWidthCss, pageViewportCss: m.pageViewportCss,
      scroller: m.scroller, scrollerRect: m.scrollerRect,
      note: notes.length ? notes.join(' ') : null,
    });

    for (let i = 0; i < positions.length; i++) {
      stage = `tile ${i + 1}/${positions.length}`;
      const res = await sendToTab(tab.id, { wp: 'scroll-to', y: positions[i], settle: true });
      if (i === 1) await sendToTab(tab.id, { wp: 'hide-fixed' }); // visible in tile 1 only (pain #4)
      await assertStillActive(tab); // never photograph a tab the user switched to
      const dataUrl = await captureTile(tab.windowId);
      sendToResult(captureId, { type: 'tile', index: i, actualY: res.actualY, dataUrl });
      tilesSent++;
      await setBadge(tab.id, `${i + 1}/${positions.length}`);
      notifyPopup({ type: 'progress', done: i + 1, total: positions.length });
    }

    await sendToTab(tab.id, { wp: 'restore' });
    prepped = false;
    sendToResult(captureId, { type: 'finalize' });
    await setBadge(tab.id, '');
    await chrome.tabs.update(resultTab.id, { active: true });
  } catch (err) {
    const reason = `at stage "${stage}": ` + String((err && err.message) || err);
    console.error('[WholePage] capture failed', reason, err);
    // Fallback chain, hardened by review:
    // - tiles already streamed → finalize the PARTIAL capture with a warning;
    //   never send a second meta that would corrupt the assembled result.
    // - nothing streamed → visible-area fallback, but ONLY if the target tab is
    //   still the active one (never photograph an unrelated tab).
    try {
      if (prepped) { await sendToTab(tab.id, { wp: 'restore' }); prepped = false; }
    } catch (_) { /* page may have navigated */ }
    try {
      if (tilesSent > 0) {
        sendToResult(captureId, { type: 'abort-note', note: `Capture stopped ${reason}. Everything captured up to that point is below.` });
        sendToResult(captureId, { type: 'finalize' });
        if (resultTab) await chrome.tabs.update(resultTab.id, { active: true });
      } else {
        if (!resultTab) resultTab = await openResult(captureId, tab);
        const stillActive = await chrome.tabs.query({ active: true, windowId: tab.windowId }).then(([a]) => a && a.id === tab.id).catch(() => false);
        const dataUrl = stillActive ? await captureTile(tab.windowId).catch(() => null) : null;
        if (dataUrl) {
          sendToResult(captureId, { type: 'meta', mode: 'visible', title: tab.title || 'page', url: tab.url, tiles: 1, noteLevel: 'warn', note: `Full-page capture failed ${reason} — WholePage captured the visible area instead. Please report this at the project page; the quoted stage pinpoints the bug.` });
          sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
          sendToResult(captureId, { type: 'finalize' });
        } else {
          sendToResult(captureId, { type: 'fatal', reason });
        }
        await chrome.tabs.update(resultTab.id, { active: true });
      }
    } catch (_) {
      notifyPopup({ type: 'error', reason: 'Capture failed: ' + reason });
    }
    await setBadge(tab.id, '');
  } finally {
    captureBusy = false;
  }
}

// Test hook: the Playwright harness drives captures by evaluating in this
// worker (the toolbar can't be clicked programmatically). Unreachable from web
// pages; ships inert.
globalThis.__wpTest = { runCapture };

// decodeTile is re-exported for the test harness (drives the SW directly).
export { decodeTile };
