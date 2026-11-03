// The extension's shared core: contract keys, storage adapter and everything that builds and merges
// the account snapshot. Ported verbatim from the userscript (see the userscript repository); only the
// storage adapter differs: GM storage was synchronous, chrome.storage is not, so the snapshots are
// loaded once into a cache (initSnapshots) and every save writes the cache through to storage.
const SNAPSHOTS_KEY = 'pfg-companion:snapshots:v1';
const PENDING_EXPORT_KEY = 'pfg_companion_pending_export';
const EVENT_NAME = 'pfg-companion:sync';
const DEBUG_KEY = 'pfg-companion:debug';

// The players enable debug logging by setting localStorage['pfg-companion:debug'] = '1' on a game
// page and reloading it (the userscript manager's editor is not available to an extension).
let DEBUG = false;
try {
  DEBUG = localStorage.getItem(DEBUG_KEY) === '1';
} catch {
  DEBUG = false;
}

/** @param {string} message @param {...any} details */
function debug(message, ...details) {
  if (DEBUG) console.debug(`[PfG Companion] ${message}`, ...details);
}

// The in-memory copy of chrome.storage.local's SNAPSHOTS_KEY value; chrome.storage.onChanged keeps
// it fresh when another tab of this extension writes, mirroring the userscript's live GM_getValue.
let snapshotsCache = {};

/** Normalises a stored value into the cache: any non-object is treated as empty. @param {any} value */
function setSnapshotsCache(value) {
  snapshotsCache = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Loads the snapshots once per document and registers the cross-tab cache sync. */
async function initSnapshots() {
  try {
    const items = await chrome.storage.local.get(SNAPSHOTS_KEY);
    setSnapshotsCache(items?.[SNAPSHOTS_KEY]);
  } catch (error) {
    debug('initSnapshots: failed to read storage:', error);
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(SNAPSHOTS_KEY in changes)) return;
    setSnapshotsCache(changes[SNAPSHOTS_KEY].newValue);
  });
  return snapshotsCache;
}

/** @returns {Record<string, any>} */
function snapshots() {
  return snapshotsCache;
}

/** @param {Record<string, any>} value */
function saveSnapshots(value) {
  snapshotsCache = value;
  void chrome.storage.local.set({ [SNAPSHOTS_KEY]: value });
}

/** @returns {{number: number, language: string, host: string}|null} */
function universe() {
  const match = location.hostname.match(/^s(\d+)-([a-z]{2,3})\.ogame\.gameforge\.com$/i);
  if (!match) return null;
  return { number: Number.parseInt(match[1], 10), language: match[2].toLowerCase(), host: location.hostname };
}

/** @param {number|string} playerId @param {{number: number, language: string}} uni */
function accountKey(playerId, uni) {
  return `${uni.language}:${uni.number}:${playerId}`;
}

/** @param {any} response */
function stripResponse(response) {
  if (!response || typeof response !== 'object') return response;
  const result = Array.isArray(response) ? response.slice() : { ...response };
  ['components', 'newAjaxToken', 'spaceObjects', 'static', 'speciesInformation'].forEach((key) => delete result[key]);
  return result;
}

/** @param {any} value */
function stripDetails(value) {
  if (Array.isArray(value)) return value.map(stripDetails);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (key !== 'details') result[key] = stripDetails(entry);
  });
  return result;
}

/** @param {string} tooltip */
function tooltipBody(tooltip) {
  // A DOMParser document is inert: scripts do not run and images are not loaded, unlike innerHTML on a live element.
  const doc = new DOMParser().parseFromString(tooltip, 'text/html');
  return doc.body.textContent || '';
}

/** @param {string} tooltip */
function parseBodyTooltip(tooltip) {
  const text = tooltipBody(tooltip);
  const coords = text.match(/\[(\d+):(\d+):(\d+)\]/);
  const title = text.split('\n').find((line) => line.includes('[')) || '';
  const name = title.replace(/\s*\[\d+:\d+:\d+\].*$/, '').trim();
  const temperatures = [...text.matchAll(/(-?\d+)\s*°C/g)].map((match) => Number.parseInt(match[1], 10));
  const fields = text.match(/\((\d+)\s*\/\s*(\d+)\)/);
  const diameter = text.match(/([\d.,]+)\s*km/i);
  return {
    name,
    galaxy: coords ? Number.parseInt(coords[1], 10) : null,
    system: coords ? Number.parseInt(coords[2], 10) : null,
    position: coords ? Number.parseInt(coords[3], 10) : null,
    temperature: temperatures.length >= 2 ? { min: temperatures[0], max: temperatures[1] } : null,
    fields: fields ? { used: Number.parseInt(fields[1], 10), total: Number.parseInt(fields[2], 10) } : null,
    diameter: diameter ? Number.parseInt(diameter[1].replace(/[.,]/g, ''), 10) : null,
  };
}

function bodyDetailsFromMenu() {
  const planets = {};
  const moons = {};
  document.querySelectorAll('#planetList .smallplanet').forEach((node) => {
    const planetId = (node.id || '').match(/^planet-(\d+)$/)?.[1];
    const planetLink = node.querySelector('a.planetlink');
    if (planetId && planetLink) planets[planetId] = parseBodyTooltip(planetLink.getAttribute('data-tooltip-title') || '');
    const moonLink = node.querySelector('a.moonlink');
    const moonId = (moonLink?.getAttribute('href') || '').match(/[?&]cp=(\d+)/)?.[1];
    if (moonId && moonLink) moons[moonId] = { ...parseBodyTooltip(moonLink.getAttribute('data-tooltip-title') || ''), siblingId: Number(planetId) };
  });
  return { planets, moons };
}

/** @param {Record<string, any>} target @param {Record<string, any>} details */
function mergeBodyDetails(target, details) {
  Object.entries(details).forEach(([id, extra]) => {
    if (!target[id] || !extra) return;
    if (extra.name) target[id].name = extra.name;
    ['galaxy', 'system', 'position', 'diameter'].forEach((key) => {
      if (extra[key] !== null) target[id][key] = extra[key];
    });
    if (extra.fields) target[id].fields = extra.fields;
    if (extra.temperature) target[id].temperature = extra.temperature;
    if (extra.siblingId) target[id].siblingId = extra.siblingId;
  });
}

/** @param {any} accountInfo @param {any} speciesBonuses @param {{number: number, language: string, host: string}} uni */
function buildExport(accountInfo, speciesBonuses, uni) {
  const result = stripResponse(accountInfo);
  debug('buildExport: accountInfo keys=', result && typeof result === 'object' ? Object.keys(result).join(',') : 'invalid', 'playerId=', result?.playerId, 'planets=', result?.planets && typeof result.planets === 'object' ? Object.keys(result.planets).length : 0, 'speciesBonusesFetched=', !!speciesBonuses);
  const details = bodyDetailsFromMenu();
  if (result.planets && typeof result.planets === 'object') mergeBodyDetails(result.planets, details.planets);
  if (result.moons && typeof result.moons === 'object') mergeBodyDetails(result.moons, details.moons);
  const bonusResponse = stripResponse(speciesBonuses);
  if (bonusResponse?.data) result.speciesBonuses = stripDetails(bonusResponse.data);
  else debug('buildExport: speciesBonuses response has no data, keys=', bonusResponse && typeof bonusResponse === 'object' ? Object.keys(bonusResponse).join(',') : typeof bonusResponse);
  result.schemaVersion = 2;
  result.universe = uni;
  result.exportedAt = new Date().toISOString();
  return result;
}

/** @param {any} exportData */
function collectionStatus(exportData) {
  if (!exportData || typeof exportData !== 'object') return { level: 1, accountReady: false, bodiesReady: false, missingProduction: [] };
  // Planets are keyed by id (the same key activeEntry() and production factors use), so rely on the key, not on planet.id.
  const planets = exportData.planets && typeof exportData.planets === 'object' ? Object.entries(exportData.planets).filter(([, planet]) => planet && typeof planet === 'object') : [];
  const factors = exportData.pfgCompanion?.productionFactors || {};
  const missingProduction = planets.filter(([id]) => !(id in factors))
    .map(([id, planet]) => ({ id, name: String(planet.name || ''), coords: [planet.galaxy, planet.system, planet.position].every(Number.isFinite) ? `${planet.galaxy}:${planet.system}:${planet.position}` : '' }));
  const accountReady = Number.isFinite(Number(exportData.playerId)) && !!exportData.speciesBonuses;
  const bodiesReady = planets.length > 0 && planets.every(([id]) => /^\d+$/.test(id));
  const level = !accountReady || !bodiesReady ? 1 : missingProduction.length ? 2 : 3;
  return { level, accountReady, bodiesReady, missingProduction };
}

// Planet production boosters by item uuid (one uuid per duration). Bronze ones are not sold in the shop,
// so their uuids were taken from the item bar of a planet where they were active.
const PRODUCTION_ITEMS = {
    'de922af379061263a56d7204d1c395cefcfb7d75': { resource: 'metal', tier: 'bronze' }, // Bronze Metal Booster
    'ba85cc2b8a5d986bbfba6954e2164ef71af95d4a': { resource: 'metal', tier: 'silver' }, // Silver Metal Booster
    '742743b3b0ae1f0b8a1e01921042810b58f12f39': { resource: 'metal', tier: 'silver' }, // Silver Metal Booster
    '6f44dcd2bd84875527abba69158b4e976c308bbc': { resource: 'metal', tier: 'silver' }, // Silver Metal Booster
    '05294270032e5dc968672425ab5611998c409166': { resource: 'metal', tier: 'gold' }, // Gold Metal Booster
    '6fecb993169fe918d9c63cd37a2e541cc067664e': { resource: 'metal', tier: 'gold' }, // Gold Metal Booster
    '21c1a65ca6aecf54ffafb94c01d0c60d821b325d': { resource: 'metal', tier: 'gold' }, // Gold Metal Booster
    'a83cfdc15b8dba27c82962d57e50d8101d263cfb': { resource: 'metal', tier: 'platinum' }, // Platinum Metal Booster
    'c690f492cffe5f9f2952337e8eed307a8a62d6cf': { resource: 'metal', tier: 'platinum' }, // Platinum Metal Booster
    'ca7f903a65467b70411e513b0940d664c417aa3a2': { resource: 'metal', tier: 'platinum' }, // Platinum Metal Booster
    '3c9f85221807b8d593fa5276cdf7af9913c4a35d': { resource: 'crystal', tier: 'bronze' }, // Bronze Crystal Booster
    '422db99aac4ec594d483d8ef7faadc5d40d6f7d3': { resource: 'crystal', tier: 'silver' }, // Silver Crystal Booster
    '5b69663e3ba09a1fe77cf72c5094e246cfe954d6': { resource: 'crystal', tier: 'silver' }, // Silver Crystal Booster
    '04d8afd5936976e32ce894b765ea8bd168aa07ef': { resource: 'crystal', tier: 'silver' }, // Silver Crystal Booster
    '118d34e685b5d1472667696d1010a393a59aed03': { resource: 'crystal', tier: 'gold' }, // Gold Crystal Booster
    '36fb611e71d42014f5ebd0aa5a52fc0c81c0a1cb': { resource: 'crystal', tier: 'gold' }, // Gold Crystal Booster
    'd45f00e8b909f5293a83fb4f369737ea7d69c684': { resource: 'crystal', tier: 'gold' }, // Gold Crystal Booster
    '35d96e441c21ef112a84c6189349d0f026998fd': { resource: 'crystal', tier: 'platinum' }, // Platinum Crystal Booster
    '6bf45fcba6a6a68158273d049a24452eca75cf39': { resource: 'crystal', tier: 'platinum' }, // Platinum Crystal Booster
    '7c2edf40c5cd54ad11c6439398b83020a0a7a6be': { resource: 'crystal', tier: 'platinum' }, // Platinum Crystal Booster
    'd9fa5f359e80ff4f4c97545d07c66dbadab1d1be': { resource: 'deuterium', tier: 'bronze' }, // Bronze Deuterium Booster
    'e4b78acddfa6fd0234bcb814b676271898b0dbb3': { resource: 'deuterium', tier: 'silver' }, // Silver Deuterium Booster
    '26416a3cdb94613844b1d3ca78b9057fd6ae9b15': { resource: 'deuterium', tier: 'silver' }, // Silver Deuterium Booster
    '6f0952a919fd2ab9c009e9ccd83c1745f98f758f': { resource: 'deuterium', tier: 'silver' }, // Silver Deuterium Booster
    '55b0a1580a0330e8aadf05cb5bfe6bc3200406e2': { resource: 'deuterium', tier: 'gold' }, // Gold Deuterium Booster
    '300493ddc756869578cb2888a3a1bc0c3c66765f': { resource: 'deuterium', tier: 'gold' }, // Gold Deuterium Booster
    'dc5896bed3311434224d511fa7ced6fdbe41b4e8': { resource: 'deuterium', tier: 'gold' }, // Gold Deuterium Booster
    '4b51d903560edd102467b110586000bd64fdb954': { resource: 'deuterium', tier: 'platinum' }, // Platinum Deuterium Booster
    '620f779dbffa1011aded69b091239727910a3d03': { resource: 'deuterium', tier: 'platinum' }, // Platinum Deuterium Booster
    '831c3ea8d868eb3601538f4d5e768842988a1ba9': { resource: 'deuterium', tier: 'platinum' }, // Platinum Deuterium Booster
    'c2bad58fcec374d709099d11d0549e59ea7e233e': { resource: 'energy', tier: 'silver' }, // Energy Booster Silver
    'bedd248aaf288c27e9351cfacfa6be03f1dbb898': { resource: 'energy', tier: 'silver' }, // Energy Booster Silver
    'e05aa5b9e3df3be3857b43da8403eafbf5ad3b96': { resource: 'energy', tier: 'silver' }, // Energy Booster Silver
    '55b52cbfb148ec80cd4e5b0580f7bed01149d643': { resource: 'energy', tier: 'gold' }, // Energy Booster Gold
    '4fa9a2273ee446284d5177fd9d60a22be01e932b': { resource: 'energy', tier: 'gold' }, // Energy Booster Gold
    '5ad783dcfce3655ef97b36197425718a0dad6b66': { resource: 'energy', tier: 'gold' }, // Energy Booster Gold
    '77c36199102e074dca46f5f26ef57ce824d044dd': { resource: 'energy', tier: 'platinum' }, // Energy Booster Platinum
    'dfe86378f8c3d7f3ee0790ea64603bc44e83ca47': { resource: 'energy', tier: 'platinum' }, // Energy Booster Platinum
    'c39aa972a971e94b1d9b4d7a8f734b3d8be12534': { resource: 'energy', tier: 'platinum' }, // Energy Booster Platinum
    '302b246f44585109ca5b3ed94178707d7d4c32c0': { resource: 'all', tier: 'bronze', percent: 15 }, // Resource Booster (15%) Bronze
    '828c11637d6177cf7369dddeffa63521d9f05c8c': { resource: 'all', tier: 'bronze', percent: 15 }, // Resource Booster (15%) Bronze
    'bfc5896632e0d809947dac4d8ced39ad7974f686': { resource: 'all', tier: 'bronze', percent: 20 }, // Resource Booster (20%) Bronze
    'beff9da8ce9ed2a03f73fb412347ef02adf4e9f4': { resource: 'all', tier: 'bronze', percent: 20 }, // Resource Booster (20%) Bronze
    'f76a859138dab12d181590ff46bb11d0be5b79bd': { resource: 'all', tier: 'bronze', percent: 25 }, // Resource Booster (25%) Bronze
    '4fa71c28e076fd5a5f1fdba2d83b9537e7557295': { resource: 'all', tier: 'bronze', percent: 25 }, // Resource Booster (25%) Bronze
    'be06b5c24ec29aadfe9e348ec022e698a5367dd0': { resource: 'all', tier: 'bronze', percent: 30 }, // Resource Booster (30%) Bronze
    '98fb2c053a8bd860e9a307fe6f94e9b87754504': { resource: 'all', tier: 'bronze', percent: 30 }, // Resource Booster (30%) Bronze
    '370a7d4f976480fa054ef23068c442fc6e476301': { resource: 'all', tier: 'bronze', percent: 40 }, // Resource Booster (40%) Bronze
    '8cc0f382c3e6bb0751b42b8e9b9a0d3648313f25': { resource: 'all', tier: 'bronze', percent: 40 }, // Resource Booster (40%) Bronze
  };

// accountInfo lists the items active on every planet (planets[id].buffs); keep the known production boosters
// under pfgCompanion, since the planets themselves belong to the account-export format.
/** @param {any} planets */
function productionBoosters(planets) {
  const result = {};
  if (!planets || typeof planets !== 'object') return result;
  Object.entries(planets).forEach(([planetId, planet]) => {
    const buffs = Array.isArray(planet?.buffs) ? planet.buffs : [];
    result[planetId] = buffs.filter((buff) => PRODUCTION_ITEMS[buff?.itemUuid]).map((buff) => ({
      uuid: buff.itemUuid,
      name: String(buff.name || ''),
      ...PRODUCTION_ITEMS[buff.itemUuid],
      effectStart: Number.isFinite(buff.effectStart) ? buff.effectStart : null,
      effectEnd: Number.isFinite(buff.effectEnd) ? buff.effectEnd : null,
    }));
  });
  return result;
}

const RESOURCE_KEYS = ['metal', 'crystal', 'deuterium'];
/** A bar reading with the stored amounts still refreshes the stored `at` once that is this much older. */
const SAME_RESOURCES_REFRESH_MS = 5 * 60 * 1000;

/** @param {string|number|undefined} value @returns {number} */
function timeMs(value) {
  return typeof value === 'number' ? value : Date.parse(typeof value === 'string' ? value : '');
}

/** A resource reading `{ metal, crystal, deuterium, at }`, or null when any value or the time is unusable. @param {any} raw @param {any} at */
function resourceReading(raw, at) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(timeMs(at))) return null;
  const reading = {};
  for (const key of RESOURCE_KEYS) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) return null;
    reading[key] = raw[key];
  }
  reading.at = at;
  return reading;
}

/** Ids of the planets and moons of an export, as the keys the export uses for them. @param {any} exportData */
function bodyIds(exportData) {
  const ids = new Set();
  for (const group of ['planets', 'moons']) {
    const bodies = exportData?.[group];
    if (bodies && typeof bodies === 'object') Object.keys(bodies).forEach((id) => ids.add(String(id)));
  }
  return ids;
}

/**
 * The resources of every body: stored readings and new ones merged per body by `at` (a strictly newer reading
 * replaces an older one), seeded from the bodies' own `resources` as of `collectedAt`, limited to the bodies of the export.
 * @param {any} exportData @param {Record<string, any>[]} sources @param {string|undefined} collectedAt
 */
function mergedResources(exportData, sources, collectedAt) {
  const result = {};
  const offer = (id, reading) => {
    if (!reading) return;
    const current = result[id];
    if (!current || timeMs(reading.at) > timeMs(current.at)) result[id] = reading;
  };
  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    Object.entries(source).forEach(([id, entry]) => offer(String(id), resourceReading(entry, entry?.at)));
  });
  for (const group of ['planets', 'moons']) {
    const bodies = exportData?.[group];
    if (!bodies || typeof bodies !== 'object') continue;
    Object.entries(bodies).forEach(([id, body]) => offer(String(id), resourceReading(body?.resources, collectedAt)));
  }
  const known = bodyIds(exportData);
  Object.keys(result).forEach((id) => { if (!known.has(id)) delete result[id]; });
  return result;
}

/**
 * @param {any} exportData
 * @param {string} [collectedAt] time of the last account fetch, which drives the collection throttle
 * @param {{ at: string, message: string }} [error] an error to keep on the entry (a resource-bar save is no new collection)
 */
function persistExport(exportData, collectedAt = exportData?.exportedAt, error = undefined) {
  const uni = universe();
  debug('persistExport: playerId=', exportData?.playerId, 'playerIdValid=', Number.isFinite(Number(exportData?.playerId)), 'universe=', uni ? `${uni.language}:${uni.number}` : null, 'hasPlanets=', !!(exportData?.planets && typeof exportData.planets === 'object'));
  if (!uni || !Number.isFinite(Number(exportData.playerId))) return;
  const all = snapshots();
  const existing = all[accountKey(exportData.playerId, uni)]?.export || {};
  const productionFactors = { ...(existing.pfgCompanion?.productionFactors || {}), ...(exportData.pfgCompanion?.productionFactors || {}) };
  const next = { ...exportData, pfgCompanion: { productionFactors } };
  // A partial response must not erase data collected earlier.
  if (!next.speciesBonuses && existing.speciesBonuses) next.speciesBonuses = existing.speciesBonuses;
  const hasPlanets = (value) => value && typeof value === 'object' && Object.keys(value).length > 0;
  if (!hasPlanets(next.planets) && hasPlanets(existing.planets)) next.planets = existing.planets;
  next.pfgCompanion.productionBoosters = productionBoosters(next.planets);
  next.pfgCompanion.resources = mergedResources(next, [existing.pfgCompanion?.resources, exportData.pfgCompanion?.resources], collectedAt);
  next.pfgCompanion.status = collectionStatus(next);
  all[accountKey(next.playerId, uni)] = error ? { collectedAt, export: next, error } : { collectedAt, export: next };
  saveSnapshots(all);
  return next;
}

function handOffToSite() {
  const all = snapshots();
  const exports = Object.values(all).map((entry) => entry?.export).filter(Boolean);
  if (!exports.length) return;
  const payload = { version: 1, exports };
  localStorage.setItem(PENDING_EXPORT_KEY, JSON.stringify(payload));
  // Firefox: the page cannot read a detail object of the isolated world (an Xray wrapper: "Permission denied"),
  // so cloneInto copies it into the page, as in bridgeCall(). Chrome has no cloneInto and passes the object as is.
  const detail = typeof cloneInto === 'function' ? cloneInto(payload, window) : payload;
  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}
