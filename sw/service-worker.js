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
  const entry = resultPorts.get(id) || { port: null, buffered: [] };
  entry.port = port;
  resultPorts.set(id, entry);
  for (const msg of entry.buffered) port.postMessage(msg);
  entry.buffered = [];
  port.onDisconnect.addListener(() => {
    const cur = resultPorts.get(id);
    if (cur && cur.port === port) cur.port = null;
  });
});

function sendToResult(id, msg) {
  const entry = resultPorts.get(id) || { port: null, buffered: [] };
  resultPorts.set(id, entry);
  if (entry.port) {
    try { entry.port.postMessage(msg); return; } catch (_) { entry.port = null; }
  }
  entry.buffered.push(msg);
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
      const tab = await activeTab();
      sendResponse({ started: true });
      await runCapture(tab, msg.mode);
    })();
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await activeTab();
  if (command === 'capture-full-page') await runCapture(tab, 'full');
  if (command === 'capture-visible') await runCapture(tab, 'visible');
});

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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
    } catch (err) {
      const info = explainInjectionFailure(tab.url || '', String(err && err.message));
      if (info.canVisible) {
        // Honest fallback: capture what we can and say why.
        const dataUrl = await captureTile(tab.windowId);
        resultTab = await openResult(captureId, tab);
        sendToResult(captureId, { type: 'meta', mode: 'visible', title: tab.title || 'page', url: tab.url, tiles: 1, note: `${info.reason} ${info.hint}` });
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
      const rect = await sendToTab(tab.id, { wp: 'area-select' });
      if (!rect || rect.cancelled) return;
      const dataUrl = await captureTile(tab.windowId);
      resultTab = await openResult(captureId, tab);
      sendToResult(captureId, { type: 'meta', mode, title: tab.title || 'page', url: tab.url, tiles: 1, cropCss: rect, innerWidthCss: rect.innerWidth });
      sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
      sendToResult(captureId, { type: 'finalize' });
      await chrome.tabs.update(resultTab.id, { active: true });
      return;
    }

    // ---- Full page.
    const m = await sendToTab(tab.id, { wp: 'measure' });
    prepped = true; // from here on, always restore
    await sendToTab(tab.id, { wp: 'freeze' }); // animations/transitions/videos off
    const prime = await sendToTab(tab.id, { wp: 'prime' }); // lazy-load pass; returns final height + growth flag
    await sendToTab(tab.id, { wp: 'mark-fixed' }); // walk AFTER priming: catches scroll-swapped sticky headers

    const totalCss = prime.totalCss;
    const stepCss = m.viewportCss;
    const positions = [];
    for (let y = 0; y + stepCss < totalCss; y += stepCss) positions.push(y);
    positions.push(Math.max(0, totalCss - stepCss));
    if (positions.length > 1 && positions[positions.length - 1] === positions[positions.length - 2]) positions.pop();

    resultTab = await openResult(captureId, tab);
    sendToResult(captureId, {
      type: 'meta', mode, title: m.title, url: m.url, tiles: positions.length,
      widthCss: m.clientWidthCss, totalCss, viewportCss: m.viewportCss,
      innerWidthCss: m.innerWidthCss, pageViewportCss: m.pageViewportCss,
      scroller: m.scroller, scrollerRect: m.scrollerRect,
      note: prime.infinite ? 'This page keeps loading more content as it scrolls. WholePage captured everything that was loaded (' + Math.round(totalCss) + 'px). Need more? Scroll further down first, then capture again.' : null,
    });

    for (let i = 0; i < positions.length; i++) {
      const res = await sendToTab(tab.id, { wp: 'scroll-to', y: positions[i], settle: true });
      if (i === 1) await sendToTab(tab.id, { wp: 'hide-fixed' }); // visible in tile 1 only (pain #4)
      const dataUrl = await captureTile(tab.windowId);
      sendToResult(captureId, { type: 'tile', index: i, actualY: res.actualY, dataUrl });
      await setBadge(tab.id, `${i + 1}/${positions.length}`);
      notifyPopup({ type: 'progress', done: i + 1, total: positions.length });
    }

    await sendToTab(tab.id, { wp: 'restore' });
    prepped = false;
    sendToResult(captureId, { type: 'finalize' });
    await setBadge(tab.id, '');
    await chrome.tabs.update(resultTab.id, { active: true });
  } catch (err) {
    const reason = String((err && err.message) || err);
    // Fallback chain: if full-page failed mid-way, deliver the visible area with the reason.
    try {
      if (prepped) { await sendToTab(tab.id, { wp: 'restore' }); prepped = false; }
    } catch (_) { /* page may have navigated */ }
    try {
      if (!resultTab) resultTab = await openResult(captureId, tab);
      const dataUrl = await captureTile(tab.windowId).catch(() => null);
      if (dataUrl) {
        sendToResult(captureId, { type: 'meta', mode: 'visible', title: tab.title || 'page', url: tab.url, tiles: 1, note: `Full-page capture failed (${reason}), so WholePage captured the visible area instead.` });
        sendToResult(captureId, { type: 'tile', index: 0, actualY: 0, dataUrl });
        sendToResult(captureId, { type: 'finalize' });
        await chrome.tabs.update(resultTab.id, { active: true });
      } else {
        sendToResult(captureId, { type: 'fatal', reason });
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
