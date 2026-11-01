# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## What this is

The browser-extension twin of the PfG Companion userscript (Chrome and Firefox, one Manifest V3 codebase): it collects an OGame account snapshot while the player browses the game and hands it to the ProxyForGame (PfG) site. The behaviour, the stored-data format and the site hand-off contract are owned by the userscript repository (`D:\Programming\JS\pfg-companion-script`); this repo must not drift from them. When a behavioural question arises, the userscript source is the source of truth — most functions here are verbatim ports.

## Commands

- `npm run check` — syntax-check every file in `src/` (`node --check` via `scripts/check.js`).
- `npm test` — jsdom suite in `test/`: runs the content scripts in manifest order on a minimal game page with a stubbed `chrome.storage` (in-memory, clone-on-read/write, `onChanged`) and stubbed `fetch`, then asserts on storage.
- `npm run build` — assemble `dist/chrome` and `dist/firefox` (each: `src/` + `icons/` + its manifest from `manifests/<browser>.json`) and pack store zips.
- `npm run icon` — regenerate the battery-glyph fallback icons (`scripts/gen-icon.js`, a dependency-free PNG writer). The committed icons are the PfG site favicon (`pfg.wmp/www/favicon64.png`): 128 = bicubic 2× upscale, 48 = area-average downscale, produced by a one-off script; regenerate the same way if the favicon changes.
- Manual testing: load `dist/chrome` unpacked on `chrome://extensions`, `dist/firefox/manifest.json` via `about:debugging`. Debug logs: `localStorage['pfg-companion:debug'] = '1'` on a game page, then reload.

## Architecture

- No bundler, no runtime dependencies: content scripts are an ordered list of plain files sharing one global lexical scope, like the userscript is one plain file. Top-level `const`s must stay unique across files; `npm run check` does not catch collisions, so mind new names.
- Three content-script entries: `src/main-world.js` on OGame with `"world": "MAIN"` at `document_start`; the game scripts on OGame at `document_idle`; the site scripts on proxyforgame.com at `document_idle`. Minimum versions Chrome 111 / Firefox 128 (the floor for static `world: "MAIN"`).
- The two `unsafeWindow` spots of the userscript became the bridge: `src/bridge.js` (isolated world) sends `pfg-companion-bridge` CustomEvents with a requestId; `src/main-world.js` answers `resourcesBar` amounts and OGame's `changeTooltip()` via `pfg-companion-bridge-reply`. Timeouts (200 ms read / 500 ms tooltip) degrade to the userscript's own fallbacks (bar text, plain `title`), so a missing MAIN world never breaks collection.
- `chrome.storage.local` replaces GM storage under the same key `pfg-companion:snapshots:v1`: `initSnapshots()` loads it once into a cache (GM storage was synchronous, extension storage is not) and every save writes through. `chrome.storage.onChanged` keeps the cache fresh across tabs and, in site mode, re-runs the hand-off (the userscript's `GM_addValueChangeListener`).
- No background service worker: everything happens in content scripts.
- The userscript and the extension never collect together: game-main/site-main stand down when `document.documentElement.dataset.pfgCompanion` is already set and set it to `'extension'` themselves (the userscript sets `'userscript'` from 0.3.1). Without the marker both run once — accepted.
- `GM_addStyle` became a plain `<style>` element; the OGame menu entry, panel and all UI strings are ported verbatim.

## Contracts (shared with the userscript — must not drift)

- Storage key `pfg-companion:snapshots:v1`, site localStorage key `pfg_companion_pending_export`, site event `pfg-companion:sync`.
- The export stays compatible with the account-export format parsed by PfG's `profiles-core.js` (schema version 2); companion-specific data goes only under the optional `pfgCompanion` block.
- Behavioural constraints: never change the selected planet, never open game pages or run background polling; `accountInfo` is requested once per game session and only re-requested by the panel's Refresh; production factors are read only from the Resource Settings page the player opened.

## Conventions

Inherited from the userscript repository: commit messages in English; source files use CRLF line endings; debug logging off by default (the localStorage flag above is the player-facing switch); every new UI string goes into the `I18N` dictionary in every language (a test checks the key sets match); the README documents player-visible behaviour and is updated together with the code.
