# WholePage – Full Page Screenshot & Screen Capture

Full-page screenshots that actually work. 100% local, no account, no watermark,
no tracking. Open source, `activeTab`-only.

## Why another screenshot extension

Every popular full-page screenshot extension earns the same 1-star reviews:
captures that only grab the viewport, sticky headers stamped down the page like
a fence, lazy-loaded images captured as blank boxes, long pages silently cut
off, paywalled editors, forced accounts, nag popups — and, lately, extensions
disappearing from the store or turning into malware after quiet ownership
changes. WholePage is engineered failure-mode-by-failure-mode against that
list, and its trust properties are structural, not promised:

- **`activeTab` only.** No "read and change all your data on all websites."
  WholePage cannot see any page you didn't explicitly capture.
- **Zero network requests.** Verifiable in DevTools and in this source.
- **No account, ever.** For anything.
- **Free forever core** — contractually, in [FREE-FOREVER.md](FREE-FOREVER.md).
- **Open source (MIT).** The shipped package is built from this repository.

## What it does

- **Full page** — scroll-and-stitch with a lazy-load priming pass, sticky/fixed
  element neutralization (headers appear once, at the top), animation freeze,
  high-DPI-exact seams, and app-shell inner-scroller detection (ChatGPT-style
  pages capture their real content, not a frozen frame).
- **Visible area** and **drag-select area** capture.
- **Copy to clipboard, save PNG, save multi-page PDF** (automatic clean
  splitting for very long pages — never a silent truncation), crop, filename
  templates, `Alt+Shift+P` shortcut (remappable).
- Restricted pages (`chrome://`, Web Store, local files) get a plain-language
  explanation and a fallback, never a silent failure.

## Architecture

Manifest V3. Three components:

| Component | Role |
|---|---|
| `sw/` | Orchestrator: pre-flight, capture state machine, quota-aware `captureVisibleTab` scheduler (Chrome caps it at 2/sec — a quota error here is a scheduling event, never a failure) |
| `content/` | Injected per capture (never persistent): measurement, scroller election, fixed/sticky walk incl. shadow DOM, lazy-load priming, scroll driving, full page-state restore |
| `result/` | Extension page where tiles stream in and stitch progressively into banded canvases (bounded memory on 100,000px pages); export PNG / multi-page PDF / ZIP slices / clipboard — PDF and ZIP writers are dependency-free, in-house, unbranded |

No third-party code ships in the package. No build step — what you read is what
runs.

## Development

```bash
# load unpacked: chrome://extensions → Developer mode → Load unpacked → this folder
npm install        # test harness only (playwright-core; uses your installed Chrome)
npm test           # regression corpus: ruler seams, sticky fence, lazy grids,
                   # inner scroller, infinite feed
```

## License

MIT — see [LICENSE](LICENSE).
