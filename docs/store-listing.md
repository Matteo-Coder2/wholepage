# Chrome Web Store submission package

## Listing

> **Paste-ready text lives in `copy-paste.md` — that file is the source of truth.**
> Rewritten 2026-08-13 to be deliberately light: the owner's previous extension
> was repeatedly rejected for a spammy feature list. One keyword phrase in the
> title, prose over bullets, no competitor references, no claim-chains.

**Name:** `WholePage – Full Page Screenshot`

**Short description (132 chars max):**
> Captures the whole page — top to bottom — as one image or PDF. Everything stays on your computer. Free and open source.

**Category:** Tools. **Language:** English.

**Description (keyword lint: each keyword ≤5×, no competitor names, no "best/#1" claims, prose not lists of keywords):**

> Capture an entire web page — everything above and below the fold — as one clean image or a multi-page PDF, with one click or Alt+Shift+P.
>
> WholePage is engineered against the failure modes screenshot extensions are notorious for:
>
> • Sticky headers appear once at the top — not stamped down the page like a fence
> • Lazy-loaded images are scrolled into existence before capture, so nothing comes out as a blank box
> • App-style pages that scroll inside a panel (chat apps, dashboards) record their full content, not one frozen frame
> • Very long pages are never silently cut off: you choose a multi-page PDF, numbered slices, or a downscaled image
> • Sharp at any display scale and zoom — no seams, no double edges
> • Pages that keep loading forever are detected and captured honestly, with a note
>
> Three modes: full page, visible area, or drag-select. Copy to clipboard, save as PNG, or save as an unbranded multi-page PDF. Crop before saving. Filename templates. Custom keyboard shortcuts.
>
> Private by architecture, not by promise: WholePage runs with the minimal activeTab permission — it cannot see any page you don't explicitly capture. It makes zero network requests: no analytics, no telemetry, no account, no cloud. Your captures never leave your device, and you can verify that in DevTools or in the public source code.
>
> Free forever for everything above, in writing, with no watermark and no usage caps: see the FREE-FOREVER contract in the repository. A reliable replacement if your full-page screenshot extension was removed or disabled.

**Screenshots (1280×800, in order):**
1. One-click full-page capture of a long real page, result tab assembling progressively
2. The install permission prompt (only the "Manage your downloads" warning — Chrome shows it for the save-file permission) side-by-side with a typical "Read and change all your data on all websites" prompt, caption "cannot see your browsing"
3. Sticky-header before/after (fence vs. once at top)
4. The oversize-page choice dialog (PDF / slices / downscale — "never cut off silently")
5. The FREE-FOREVER list as a graphic

## Privacy tab

- Single purpose: "Captures screenshots of the current page and exports them locally."
- Data collected: **None** (certify "No data collected").
- Permissions justifications:
  - `activeTab` — read the page the user explicitly captures, only at the moment they invoke the extension
  - `scripting` — inject the capture script (scrolling, measurement) into that page only
  - `downloads` — save the finished image/PDF where the user chooses
  - `storage` — remember settings (filename template, quality) locally
- Remote code: none. All code ships in the package; PDF and ZIP writers are in-house.

## Pre-submission checklist (from the removal-forensics gate)

- [ ] CWS dev account registered ($5), passkey/hardware-key 2FA, dedicated monitored email (NOT a personal stale address — that caused GoFullPage's 2021 removal)
- [ ] Publisher identity verification + website domain verified on the listing
- [ ] USPTO/Justia knockout search on "WholePage" (class 9); budget defensive word-mark filing (~$350) at launch
- [ ] Asset provenance dossier complete (docs/asset-provenance.md) — every pixel original
- [ ] Keyword lint on listing: each keyword ≤5 occurrences, no competitor names anywhere in metadata
- [ ] Public GitHub repo live; listing links to it; shipped zip is diffable against the repo
- [ ] `npm test` green + manual smoke on: a ChatGPT thread, Instagram, Wikipedia at 125% zoom, Amazon, a GIF-heavy page, a cookie-banner news site
- [ ] Incident kit ready BEFORE submitting (docs/incident-kit.md) — CWS appeals are one-shot
- [ ] Submit to Chrome Web Store AND Edge Add-ons the same day (same zip) — a second store is a second jurisdiction
- [ ] No marketing dates promised against the review queue (2026 backlog: days to 3 weeks)

## Standing rules

- Real takedown notices appear ONLY in the CWS Developer Dashboard. Any emailed "copyright violation" with a link is the 2026 phishing campaign that turned 16 extensions into malware — never click, never grant OAuth.
- Never sell or transfer the extension, the listing, or the account. Inbound acquisition offers are threat signals.
- Updates never open tabs, never badge the icon, never move a free feature behind a paywall (FREE-FOREVER.md is the contract).
- Reply to every review, especially 1-stars, with fixes shipped.
