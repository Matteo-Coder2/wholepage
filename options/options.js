'use strict';

const DEFAULTS = { filenameTemplate: '{title} {date}', jpegQuality: 0.92 };

// storage.LOCAL, never sync — sync would upload settings to the user's Google
// account, contradicting "nothing leaves your device".
async function load() {
  const s = await chrome.storage.local.get(DEFAULTS);
  document.getElementById('filenameTemplate').value = s.filenameTemplate;
  document.getElementById('jpegQuality').value = String(s.jpegQuality);
}

document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({
    // trim() first: a whitespace-only template is truthy but produces
    // an unusable empty filename downstream.
    filenameTemplate: document.getElementById('filenameTemplate').value.trim() || DEFAULTS.filenameTemplate,
    jpegQuality: Number(document.getElementById('jpegQuality').value) || DEFAULTS.jpegQuality,
  });
  const saved = document.getElementById('saved');
  saved.style.opacity = '1';
  setTimeout(() => { saved.style.opacity = '0'; }, 1500);
};

document.getElementById('shortcuts').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
};

load();
