'use strict';

const DEFAULTS = { filenameTemplate: '{title} {date}', jpegQuality: 0.92 };

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById('filenameTemplate').value = s.filenameTemplate;
  document.getElementById('jpegQuality').value = String(s.jpegQuality);
}

document.getElementById('save').onclick = async () => {
  await chrome.storage.sync.set({
    filenameTemplate: document.getElementById('filenameTemplate').value || DEFAULTS.filenameTemplate,
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
