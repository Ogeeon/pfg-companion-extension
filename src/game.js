// Game mode (an OGame page): collection throttled by the tab's sessionStorage, the account fetch,
// production settings and resource-bar reading. Ported verbatim from the userscript, except that
// resourceFromBar()/readResourceBar() ask the MAIN world through the bridge instead of unsafeWindow.
const EXPORT_URL = '/game/index.php?page=componentOnly&component=externaldataexport';
const SESSION_COLLECTED_KEY = 'pfg-companion:collected';
const SESSION_SPECIES_RETRY_KEY = 'pfg-companion:species-retry';
const GAME_COMPONENT = new URLSearchParams(location.search).get('component');
let CURRENT_PLAYER_ID = null;

/** @param {string} url */
async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  // Parsed from text: in Firefox response.json() can hand back an Xray wrapper of the page's object, and later
  // code writes into this data (mergeBodyDetails), which that wrapper rejects. JSON.parse yields a native object.
  return JSON.parse(await response.text());
}

function currentPagePlayerId() {
  return document.querySelector('meta[name="ogame-player-id"]')?.content || null;
}

function currentPlanetId() {
  const query = new URLSearchParams(location.search).get('cp');
  if (query && /^\d+$/.test(query)) return query;
  const selected = document.querySelector('#planetList .smallplanet.selected, #planetList .smallplanet.active');
  const fromList = (selected?.id || '').match(/^planet-(\d+)$/)?.[1];
  if (fromList) return fromList;
  const fromMeta = document.querySelector('meta[name="ogame-planet-id"]')?.content;
  return fromMeta && /^\d+$/.test(fromMeta) ? fromMeta : null;
}

function activeEntry() {
  const uni = universe();
  const planetId = currentPlanetId();
  const pid = currentPagePlayerId();
  return Object.values(snapshots()).find((entry) => {
    if (!entry?.export || entry.export.universe?.host !== uni?.host) return false;
    if (pid && String(entry.export.playerId) !== String(pid)) return false;
    return !planetId || Boolean(entry.export.planets?.[planetId] || entry.export.moons?.[planetId]);
  }) || null;
}

// OGame tool rules: every accountInfo request marks the player active and refreshes the highscore of all planets,
// so the account is fetched once per game session (the browser tab's sessionStorage) and then only by Refresh.
function collectedThisSession() {
  try {
    return sessionStorage.getItem(SESSION_COLLECTED_KEY) === String(currentPagePlayerId());
  } catch {
    return Boolean(activeEntry());
  }
}

function markCollectedThisSession() {
  try {
    sessionStorage.setItem(SESSION_COLLECTED_KEY, String(currentPagePlayerId()));
  } catch {
    // Without sessionStorage collectedThisSession() falls back to the stored entry.
  }
}

// On the first page after login the game answers speciesBonuses without data, so only speciesBonuses is requested
// once more, on the next page the player loads; accountInfo is not repeated.
function speciesRetryPending() {
  try {
    return sessionStorage.getItem(SESSION_SPECIES_RETRY_KEY) === String(currentPagePlayerId());
  } catch {
    return false;
  }
}

/** @param {boolean} pending */
function setSpeciesRetry(pending) {
  try {
    if (pending) sessionStorage.setItem(SESSION_SPECIES_RETRY_KEY, String(currentPagePlayerId()));
    else sessionStorage.removeItem(SESSION_SPECIES_RETRY_KEY);
  } catch {
    // Without sessionStorage there is no retry; the panel's Refresh still works.
  }
}

async function collectAccount(force = false) {
  const uni = universe();
  if (!uni) {
    debug('collectAccount: universe not detected, aborting');
    return null;
  }
  debug('collectAccount: start, force=', force);
  if (!force && collectedThisSession()) {
    if (speciesRetryPending()) return retrySpeciesBonuses();
    debug('collectAccount: skipped, already collected in this session');
    return activeEntry()?.export || null;
  }
  // Marked before the request, so a failed collection is not retried on every page load either.
  markCollectedThisSession();
  debug('collectAccount: fetching accountInfo and speciesBonuses');
  const [accountInfo, speciesBonuses] = await Promise.all([
    fetchJson(`${EXPORT_URL}&action=accountInfo&asJson=1`),
    fetchJson(`${EXPORT_URL}&action=speciesBonuses&asJson=1`),
  ]);
  setSpeciesRetry(!speciesBonuses?.data);
  debug('collectAccount: fetch resolved, accountInfo keys=', accountInfo && typeof accountInfo === 'object' ? Object.keys(accountInfo).join(',') : 'invalid', 'playerId=', accountInfo?.playerId, 'planets=', accountInfo?.planets && typeof accountInfo.planets === 'object' ? Object.keys(accountInfo.planets).length : 0, 'speciesBonuses=', !!speciesBonuses);
  const saved = persistExport(buildExport(accountInfo, speciesBonuses, uni));
  debug('collectAccount: persistExport finished, saved=', saved ? 'yes' : 'no');
  if (saved?.playerId) CURRENT_PLAYER_ID = String(saved.playerId);
  return saved;
}

async function retrySpeciesBonuses() {
  // Cleared before the request: one retry per collection, whatever the answer.
  setSpeciesRetry(false);
  const entry = activeEntry();
  if (!entry?.export) return null;
  debug('retrySpeciesBonuses: fetching speciesBonuses only');
  const response = await fetchJson(`${EXPORT_URL}&action=speciesBonuses&asJson=1`);
  if (!response?.data) {
    debug('retrySpeciesBonuses: still no data');
    return entry.export;
  }
  const next = structuredClone(entry.export);
  next.speciesBonuses = stripDetails(response.data);
  next.exportedAt = new Date().toISOString();
  return persistExport(next, entry.collectedAt);
}

function readProductionFactors() {
  if (String(GAME_COMPONENT || '').toLowerCase() !== 'resourcesettings') {
    debug('readProductionFactors: current component is not resourcesettings, skipping production factor lookup');
    return null;
  }
  const planetId = currentPlanetId();
  if (!planetId) return null;
  const factors = {};
  const desired = [1, 2, 3, 4, 12, 212, 217];
  const availableSelects = [...document.querySelectorAll('select[name^="productionFactor["]'), ...document.querySelectorAll('[data-ipi-hint*="Resourcesetting"] select')];
  debug('production factor selects found:', availableSelects.map((select) => `${select.name || select.closest('[data-ipi-hint]')?.getAttribute('data-ipi-hint') || '?'}=${select.value}`));
  desired.forEach((techId) => {
    const select =
      document.querySelector(`select[name="productionFactor[${techId}]"]`) ||
      document.querySelector(`[data-ipi-hint="ipiResourcesetting${techId}"] select`);
    if (!select) {
      debug('no selector for production factor', techId);
      return;
    }
    const value = Number.parseInt(select.value, 10);
    if (Number.isFinite(value)) factors[techId] = value;
    else debug('non-numeric value for production factor', techId, select.value);
  });
  return Object.keys(factors).length ? { planetId, factors } : null;
}

function saveProductionFactors() {
  debug('saveProductionFactors: component=', GAME_COMPONENT, 'planetId=', currentPlanetId());
  const production = readProductionFactors();
  if (!production) {
    debug('saveProductionFactors: no production factors available for current component/planet');
    return;
  }
  debug('saveProductionFactors: read', production);
  const uni = universe();
  if (!uni) return;
  const entry = activeEntry();
  if (!entry?.export) return;
  const next = structuredClone(entry.export);
  next.exportedAt = new Date().toISOString();
  next.pfgCompanion ??= {};
  next.pfgCompanion.productionFactors ??= {};
  next.pfgCompanion.productionFactors[production.planetId] = production.factors;
  const saved = persistExport(next, entry.collectedAt);
  if (saved) debug('production factors saved', saved.pfgCompanion.productionFactors, 'status', saved.pfgCompanion.status);
}

/**
 * One resource from the game's resource bar. The bar's `#resources_<name>` element carries the exact amount in
 * `data-raw`; the page's `resourcesBar` object (read in the MAIN world) holds the amount the page was rendered
 * with; the element's text is the last resort, accepted only as plain digits with `.`/`,`/space thousands
 * separators (never an abbreviated "1,2M").
 * @param {string} key
 */
async function resourceFromBar(key) {
  const element = document.getElementById(`resources_${key}`);
  const raw = Number.parseFloat(element?.getAttribute('data-raw') ?? '');
  if (Number.isFinite(raw)) return Math.floor(raw);
  let amount = Number.NaN;
  const value = await bridgeCall({ type: 'resourcesBar', key });
  if (typeof value === 'number' || typeof value === 'string') amount = Number(value);
  if (Number.isFinite(amount)) return Math.floor(amount);
  // \u00a0 and \u202f are the nbsp and narrow nbsp the game formats thousands with.
  const text = (element?.textContent || '').trim().replace(/[.,\s\u00a0\u202f]/g, '');
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** Metal, crystal and deuterium of the current body as the page shows them, with the time of the read. */
async function readResourceBar() {
  const bodyId = document.querySelector('meta[name="ogame-planet-id"]')?.content;
  if (!bodyId || !/^\d+$/.test(bodyId)) return null;
  const reading = {};
  for (const key of RESOURCE_KEYS) {
    const value = await resourceFromBar(key);
    if (value === null) {
      debug('readResourceBar: no value for', key);
      return null;
    }
    reading[key] = value;
  }
  reading.at = new Date().toISOString();
  return { bodyId, reading };
}

/**
 * Stores a resource-bar reading on the account entry. Without an entry (the account was never collected) it is
 * dropped: the first account collection brings every body's resources anyway. Nothing is written when the stored
 * reading is as new, or holds the same amounts and is at most SAME_RESOURCES_REFRESH_MS older, so a page load does
 * not trigger a hand-off for nothing; past that, the same amounts are written again to refresh `at`, so the site does
 * not show the exact reading of a body whose amounts stand still (a moon, a full storage) as stale.
 * @param {Awaited<ReturnType<typeof readResourceBar>>} read
 */
function saveBodyResources(read) {
  if (!read) return;
  const entry = activeEntry();
  if (!entry?.export || !bodyIds(entry.export).has(read.bodyId)) {
    debug('saveBodyResources: no stored account with body', read.bodyId);
    return;
  }
  const current = entry.export.pfgCompanion?.resources?.[read.bodyId];
  const age = current ? timeMs(read.reading.at) - timeMs(current.at) : Infinity;
  const sameAmounts = current && RESOURCE_KEYS.every((key) => current[key] === read.reading[key]);
  if (current && (age <= 0 || (sameAmounts && age <= SAME_RESOURCES_REFRESH_MS))) {
    debug('saveBodyResources: nothing new for body', read.bodyId);
    return;
  }
  const next = structuredClone(entry.export);
  next.pfgCompanion ??= {};
  next.pfgCompanion.resources = { ...(next.pfgCompanion.resources || {}), [read.bodyId]: read.reading };
  // exportedAt is left alone: it dates the bodies' own resources, which a bar reading does not touch.
  persistExport(next, entry.collectedAt, entry.error);
}

/** @param {unknown} error */
function recordError(error) {
  debug('recordError:', error);
  const entry = activeEntry();
  if (!entry?.export) return;
  const uni = universe();
  if (!uni) return;
  const all = snapshots();
  all[accountKey(entry.export.playerId, uni)] = {
    ...entry,
    error: { at: new Date().toISOString(), message: error instanceof Error ? error.message : 'Collection failed' },
  };
  saveSnapshots(all);
}
