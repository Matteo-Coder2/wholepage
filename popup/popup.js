// Popup: pre-flight → mode buttons → live progress.
// Restricted pages get a designed explanation BEFORE any click fails (pain #17).
'use strict';

const $ = (id) => document.getElementById(id);

async function preflight() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'preflight' });
    if (res && res.restricted) {
      $('blocked-reason').textContent = res.reason;
      $('blocked-hint').textContent = res.hint || '';
      $('blocked').hidden = false;
      $('mode-full').disabled = true;
      $('mode-area').disabled = true;
      // Visible-area capture still works on file:// without access etc.? No —
      // restricted means no capture at all; disable everything.
      $('mode-visible').disabled = true;
    }
  } catch (_) { /* service worker waking up; buttons stay enabled */ }
}

async function start(mode) {
  $('modes').hidden = true;
  $('progress').hidden = false;
  $('progress-text').textContent = mode === 'full' ? 'Capturing full page…' : 'Capturing…';
  // Name our own tab explicitly — the SW must never have to guess which tab
  // the user meant.
  let tabId = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
  } catch (_) {}
  chrome.runtime.sendMessage({ type: 'start-capture', mode, tabId }).catch(() => {});
  if (mode !== 'full') setTimeout(() => window.close(), 150);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'progress') {
    $('progress-text').textContent = `Capturing tile ${msg.done} of ${msg.total}…`;
    $('progress-fill').style.width = Math.round((msg.done / msg.total) * 100) + '%';
    if (msg.done === msg.total) setTimeout(() => window.close(), 400);
  }
  if (msg && msg.type === 'error') {
    $('progress').hidden = true;
    $('modes').hidden = false;
    $('error').textContent = msg.reason + (msg.hint ? ' ' + msg.hint : '');
    $('error').hidden = false;
  }
});

$('mode-full').onclick = () => start('full');
$('mode-visible').onclick = () => start('visible');
$('mode-area').onclick = () => start('area');
$('shortcuts-link').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};
$('options-link').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

preflight();
