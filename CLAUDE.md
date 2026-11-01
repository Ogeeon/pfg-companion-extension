# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## What this is

The browser-extension twin of the PfG Companion userscript (Chrome and Firefox, one Manifest V3 codebase): it collects an OGame account snapshot while the player browses the game and hands it to the ProxyForGame (PfG) site. The behaviour, the stored-data format and the site hand-off contract are owned by the userscript repository (`D:\Programming\JS\pfg-companion-script`); this repo must not drift from them. When a behavioural question arises, the userscript source is the source of truth.

## Commands

- `npm run check` — syntax-check every file in `src/` (`node --check` via `scripts/check.js`).
- `npm run build` — assemble `dist/chrome` and `dist/firefox` (each: `src/` + `icons/` + its manifest from `manifests/<browser>.json`) and pack store zips.
- `npm test` — jsdom tests for the shared core (wired when the code lands).
- Manual testing: load `dist/chrome` unpacked on `chrome://extensions`, `dist/firefox/manifest.json` via `about:debugging`.

## Architecture

- No bundler, no runtime dependencies: content scripts are an ordered list of plain files, like the userscript is one plain file.
- Two content-script entries by host: game mode on `*.ogame.gameforge.com`, site mode on `proxyforgame.com`.
- The logic runs in the isolated world, where `chrome.storage` is available. `chrome.storage.local` replaces GM storage under the same key `pfg-companion:snapshots:v1`; snapshots are loaded once into memory at start (GM storage was synchronous, extension storage is not) and written through on save. `GM_addValueChangeListener` becomes `chrome.storage.onChanged` in site mode.
- The two `unsafeWindow` spots of the userscript (`resourcesBar` in `readResourceBar()`, `changeTooltip()` in `setIconTooltip()`) are served by a tiny MAIN-world bridge injected as a `<script src>` from `web_accessible_resources` and talking over CustomEvents.
- No background service worker: everything happens in content scripts.
- `GM_addStyle` becomes a plain `<style>` element; the OGame menu entry, panel, i18n dictionary and all UI strings are ported verbatim.

## Contracts (shared with the userscript — must not drift)

- GM/storage key `pfg-companion:snapshots:v1`, site localStorage key `pfg_companion_pending_export`, site event `pfg-companion:sync`.
- The export stays compatible with the account-export format parsed by PfG's `profiles-core.js` (schema version 2); companion-specific data goes only under the optional `pfgCompanion` block.
- Behavioural constraints: never change the selected planet, never open game pages or run background polling; `accountInfo` is requested once per game session and only re-requested by the panel's Refresh; production factors are read only from the Resource Settings page the player opened.

## Conventions

Inherited from the userscript repository: commit messages in English; source files use CRLF line endings; `DEBUG = false` in commits; every new UI string goes into the `I18N` dictionary in every language (a test checks the key sets match); the README documents player-visible behaviour and is updated together with the code.
