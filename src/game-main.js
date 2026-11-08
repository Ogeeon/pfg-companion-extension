// Game-mode entry point (an OGame page). The userscript and the extension must not collect together
// (a second accountInfo request would mark the player active again): whoever starts first marks the
// document with data-pfg-companion and the other one stands down entirely.
(function () {
  'use strict';
  if (document.documentElement.dataset.pfgCompanion) return;
  document.documentElement.dataset.pfgCompanion = 'extension';

  void (async () => {
    await initSnapshots();
    debug('game component:', GAME_COMPONENT, 'url:', location.href);
    // Read before the account request, so the reading is dated by the page the player loaded.
    const barReading = readResourceBar();
    installGameUi();
    // The panel opens only on click; if the player opened it while collection was running, show fresh data.
    const updateOpenPanel = () => {
      if (!document.getElementById('pfg-companion-panel')?.classList.contains('pfg-open')) return;
      const current = activeEntry();
      showPanel(current);
    };
    try {
      await collectAccount();
      debug('collection flow: collectAccount resolved, saving resources and production factors and refreshing UI');
      saveBodyResources(await barReading);
      savePlanetOrder();
      saveProductionFactors();
      refreshGameUi();
      updateOpenPanel();
    } catch (error) {
      debug('collection flow: collectAccount FAILED:', error);
      recordError(error);
      saveBodyResources(await barReading);
      savePlanetOrder();
      refreshGameUi();
      updateOpenPanel();
    }
  })();
}());
