// Pre-flight detection of pages Chrome forbids extensions from touching.
// Every restricted case must produce a specific human explanation + a fallback,
// never a raw runtime error (category pain #17).

const OS_SHORTCUT_HINT = navigatorHint();

function navigatorHint() {
  // Service workers can't sniff the OS from the DOM; use userAgentData when present.
  try {
    const plat = (self.navigator.userAgentData && self.navigator.userAgentData.platform) || '';
    if (/mac/i.test(plat)) return 'You can still use macOS: press Cmd+Shift+4 to capture the visible part.';
    if (/win/i.test(plat)) return 'You can still use Windows: press Win+Shift+S to capture the visible part.';
  } catch (_) { /* fall through */ }
  return 'You can still use your OS screenshot shortcut to capture the visible part.';
}

const RULES = [
  {
    test: (u) => /^(chrome|edge|brave|opera|vivaldi|about|devtools|view-source):/i.test(u),
    reason: 'This is a browser system page. Chrome blocks ALL extensions from seeing it — this is not a bug in WholePage.',
    hint: OS_SHORTCUT_HINT,
  },
  {
    test: (u) => /^chrome-extension:/i.test(u),
    reason: "This is another extension's page. Chrome blocks extensions from capturing each other.",
    hint: OS_SHORTCUT_HINT,
  },
  {
    test: (u) => /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(u),
    reason: 'Chrome blocks all extensions from running on the Chrome Web Store.',
    hint: OS_SHORTCUT_HINT,
  },
  {
    test: (u) => /^(data|blob):/i.test(u),
    reason: 'This page is a raw data document; extensions cannot scroll it.',
    hint: OS_SHORTCUT_HINT,
  },
];

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<{restricted: boolean, reason?: string, hint?: string, fileAccess?: boolean}>}
 */
export async function checkRestricted(tab) {
  const url = tab.pendingUrl || tab.url || '';
  // With activeTab granted, tab.url is populated. An empty URL means we were
  // invoked without a grant somehow — treat as restricted rather than crash.
  if (!url) {
    return { restricted: true, reason: 'WholePage could not read this tab. Click the WholePage icon on the page you want to capture.', hint: '' };
  }
  for (const rule of RULES) {
    if (rule.test(url)) return { restricted: true, reason: rule.reason, hint: rule.hint };
  }
  if (/^file:/i.test(url)) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      return {
        restricted: true,
        fileAccess: true,
        reason: 'This is a local file. Chrome requires you to switch on "Allow access to file URLs" for WholePage first.',
        hint: 'Open the WholePage entry in chrome://extensions, enable "Allow access to file URLs", then try again.',
      };
    }
  }
  return { restricted: false };
}

/**
 * Chrome's built-in PDF viewer swallows content scripts. We detect it after an
 * injection failure rather than by URL sniffing (a .pdf URL can be an HTML page).
 */
export function explainInjectionFailure(url, errMessage) {
  if (/\.pdf(\?|#|$)/i.test(url) || /cannot be scripted|showing error page|chrome error/i.test(errMessage || '')) {
    return {
      reason: "Chrome's built-in PDF viewer blocks page scrolling for every extension, so a full-length capture isn't possible here yet.",
      hint: 'The visible area can still be captured. A full-length PDF capture mode is on the roadmap.',
      canVisible: true,
    };
  }
  return {
    reason: 'WholePage could not run on this page (' + (errMessage || 'unknown reason') + ').',
    hint: 'Try reloading the page first — extensions cannot see tabs that were open before installation.',
    canVisible: true,
  };
}
