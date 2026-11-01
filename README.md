# PfG Companion Extension

PfG Companion as a browser extension: Chrome and Firefox, one Manifest V3 codebase. It implements the same functionality as the [PfG Companion userscript](https://proxyforgame.com/companion/pfg-companion.user.js) — collects an OGame account snapshot while the player browses the game, keeps it in extension storage, and hands it to the ProxyForGame site — for players who do not use a userscript manager.

Status: bootstrap. The port of the userscript code is in progress; behaviour, stored data and the site hand-off contract are defined by the userscript repository and must not drift from it.

## Structure

- `src/` — the code: a shared core plus per-mode entry points, loaded as ordered content scripts (no bundler, no dependencies at runtime).
- `manifests/chrome.json`, `manifests/firefox.json` — the only per-browser difference.
- `icons/` — extension icons.
- `scripts/check.js` — syntax-checks every file in `src/`.
- `scripts/build.js` — assembles `dist/chrome` and `dist/firefox` and packs each into a store zip.
- `test/` — jsdom tests for the shared core.

## Contract keys shared with the userscript

`pfg-companion:snapshots:v1` (storage), `pfg_companion_pending_export` (site localStorage), `pfg-companion:sync` (site event). Changing them breaks the site hand-off; see the userscript repository's README.

## Local development

```
npm install
npm run build
```

Then load `dist/chrome` unpacked on `chrome://extensions`, or `dist/firefox/manifest.json` via `about:debugging` → This Firefox → Load Temporary Add-on. `npm run check` syntax-checks the sources.

## Releasing

1. Raise `version` in both manifests.
2. `npm run build` — produces `dist/pfg-companion-chrome-<version>.zip` and `dist/pfg-companion-firefox-<version>.zip`.
3. Upload the zips to the Chrome Web Store and addons.mozilla.org. Publishing is a manual step, not tied to `git push`.
