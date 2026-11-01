// Site-mode entry point (a ProxyForGame page): hand the stored snapshots to the site and re-run the
// hand-off whenever they change (the userscript used GM_addValueChangeListener for the same effect).
// Stands down when the userscript has already marked the document, exactly like game mode.
(function () {
  'use strict';
  if (document.documentElement.dataset.pfgCompanion) return;
  document.documentElement.dataset.pfgCompanion = 'extension';

  void (async () => {
    await initSnapshots();
    handOffToSite();
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(SNAPSHOTS_KEY in changes)) return;
      handOffToSite();
    });
  })();
}());
