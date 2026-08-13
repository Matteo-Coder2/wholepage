# Launch runbook — the human steps, in order

Everything the machine could prepare is prepared: the package
(`dist/wholepage-1.0.0.zip`), five screenshots (`store-assets/out/store-*.png`),
listing copy (`store-listing.md`), privacy answers, and the public repo
(https://github.com/Matteo-Coder2/wholepage). What follows requires a human
with a credit card and 2FA. Total: ~45 minutes of clicking, then waiting.

## 1. Chrome Web Store developer account (~10 min)

1. Create/choose the publisher email. **Not a stale personal address** — a dead
   email caused GoFullPage's 2021 takedown. A dedicated Gmail
   (e.g. wholepage.dev@gmail.com) you check daily is fine.
2. Go to https://chrome.google.com/webstore/devconsole → sign in with that
   account → pay the one-time **$5** registration fee.
3. Turn on **2FA with a passkey or hardware key** on that Google account.
   No SMS-only 2FA, no forwarding rules.
4. In the dashboard's Account tab: fill publisher name ("Matteo Martignago"),
   contact email, and verify the email when prompted.
   "Non-trader" status is fine (FireShot and GoFullPage both use it).

### Homepage vs. website verification (verified 2026-08-13)

The **Homepage URL** on the listing is just a displayed link — a GitHub repo is
fine and has no effect on review. **Website verification** (Search Console) is a
separate optional step that only adds the "By <site>" attribution; it cannot be
done for github.com and is safely skipped at launch. Review speed is determined
by the permission profile — MV3 + activeTab-only is the fastest review class
(reports of minutes-to-hours; 90% of all submissions within 3 days).

## 2. Chrome submission (~20 min)

1. Dashboard → **+ New item** → upload `dist/wholepage-1.0.0.zip`
   (rebuild anytime with `./scripts/build-zip.sh`).
2. **Store listing tab** — paste from `docs/store-listing.md`:
   name, short description, category **Tools**, the full description,
   and the five screenshots from `store-assets/out/` in order (store-1 … store-5).
   Homepage URL: `https://github.com/Matteo-Coder2/wholepage`.
3. **Privacy tab** — from the same doc: single-purpose sentence, per-permission
   justifications, remote code: **No**, data collected: **None** (certify).
4. **Distribution tab** — Public, all regions, free.
5. Submit for review. **Do not** promise anyone a launch date — the 2026 review
   queue runs days to ~3 weeks for new publishers. Updates after approval are
   much faster.

## 3. Edge Add-ons, same day (~10 min)

Same zip, second jurisdiction — this kept GoFullPage alive through two Chrome
takedowns.

1. https://partner.microsoft.com/dashboard/microsoftedge → register (free).
2. New extension → upload the same zip → paste the same listing + screenshots.
3. Microsoft's review is typically fast (GoFullPage's update cleared overnight).

## 4. The moment it goes live

- Add the store link to the GitHub README (replace the load-unpacked line).
- Tag the release: `git tag v1.0.0 && git push --tags`, and attach the zip to a
  GitHub Release (fallback distribution — part of the incident kit).
- Record the 2-minute functionality screencast (any screen recorder, no audio
  needed: install → full-page capture → sticky demo → PDF export) and keep the
  file with the incident kit. It is the single highest-value appeal asset.
- Reply to **every** review from day one, especially 1-stars.

## 5. Standing rules (from the removal forensics — do not skip)

- Real takedown notices appear **only** in the CWS Developer Dashboard.
  Any emailed "copyright violation" with a link or OAuth prompt is the 2026
  phishing campaign that turned 16 extensions into malware. Never click.
- Never sell or transfer the extension, the listing, or the account.
  Acquisition offers are threat signals — the category's malware events all
  started with a change of control.
- Never move a free feature behind a paywall (`FREE-FOREVER.md` is the contract).
- Updates never open tabs, never badge the icon.
- Before every future release: `npm test` green, then `./scripts/build-zip.sh`.

## Optional, soon after launch

- USPTO knockout search on "WholePage" (https://tmsearch.uspto.gov, class 9);
  a defensive word-mark filing is ~$350 and is the cheapest insurance this
  category offers.
- Buy a domain (wholepage.app or similar) → add to the listing, verify as
  publisher site, and host the comparison pages ("GoFullPage alternative" etc.)
  that the research showed are barely contested.
- v1.1: the free annotation editor (promised in the listing and FREE-FOREVER.md).
