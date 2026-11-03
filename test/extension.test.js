// Runs the extension's content scripts in jsdom on a minimal game page with a stubbed chrome.storage
// and fetch, and checks what lands in storage. Ported from the userscript repository's tests; the
// files are concatenated in manifest order, which is how ordered content scripts execute.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const GAME_SCRIPT = ['main-world.js', 'i18n.js', 'core.js', 'bridge.js', 'game.js', 'panel.js', 'game-main.js'].map(read).join('\n;\n');
const SITE_SCRIPT = ['i18n.js', 'core.js', 'site-main.js'].map(read).join('\n;\n');
const GAME_URL = 'https://s1-en.ogame.gameforge.com/game/index.php?page=ingame&component=overview';
const SETTINGS_URL = 'https://s1-en.ogame.gameforge.com/game/index.php?page=ingame&component=resourcesettings';
const SITE_URL = 'https://proxyforgame.com/en';
const SNAPSHOTS_KEY = 'pfg-companion:snapshots:v1';
const PENDING_EXPORT_KEY = 'pfg_companion_pending_export';
const PLAYER_ID = 337527;

/** @param {{ menu?: boolean, body?: string, planetId?: number }} [options] */
const gamePage = ({ menu = false, body = '', planetId = 4431812 } = {}) => `<!DOCTYPE html><html><head>
<meta name="ogame-universe" content="s1-en.ogame.gameforge.com"/>
<meta name="ogame-player-id" content="${PLAYER_ID}"/>
<meta name="ogame-planet-id" content="${planetId}"/>
</head><body>${menu ? '<ul id="menuTable"></ul>' : ''}${body}</body></html>`;

const sitePage = () => '<!DOCTYPE html><html><head></head><body></body></html>';

// The game's resource bar: each amount as data-raw (exact) and as formatted text.
const resourceBar = ({ metal, crystal, deuterium }, { raw = true } = {}) => ['metal', 'crystal', 'deuterium']
  .map((key) => {
    const value = { metal, crystal, deuterium }[key];
    const text = typeof value === 'number' ? value.toLocaleString('de-DE') : value;
    return `<span id="resources_${key}"${raw ? ` data-raw="${value}"` : ''}>${text}</span>`;
  }).join('');

// Shaped like a real accountInfo response (uuids and names from a live account).
const buff = (itemUuid, name) => ({ itemUuid, name, rarity: 'common', buffStart: 1792295400, buffEnd: 1792907400, effectStart: 1792295400, effectEnd: 1792907400 });
const ACCOUNT_INFO = {
  playerId: PLAYER_ID,
  planets: {
    4431812: {
      id: 4431812,
      buffs: [
        buff('422db99aac4ec594d483d8ef7faadc5d40d6f7d3', 'Silver Crystal Booster'),
        buff('de922af379061263a56d7204d1c395cefcfb7d75', 'Bronze Metal Booster'),
        buff('55b0a1580a0330e8aadf05cb5bfe6bc3200406e2', 'Gold Deuterium Booster'),
        buff('c2bad58fcec374d709099d11d0549e59ea7e233e', 'Energy Booster Silver'),
        buff('39bc9d493f9742a31c60ead18f57db9b81717845', 'Expedition Computer Bronze'),
      ],
      resources: { metal: 5628786, crystal: 5118889, deuterium: 4902319, energy: 1716 },
    },
    4431813: {
      id: 4431813,
      buffs: [
        buff('3c9f85221807b8d593fa5276cdf7af9913c4a35d', 'Bronze Crystal Booster'),
        buff('d9fa5f359e80ff4f4c97545d07c66dbadab1d1be', 'Bronze Deuterium Booster'),
      ],
      resources: { metal: 3411, crystal: 14201, deuterium: 16278, energy: 21 },
    },
    5171549: { id: 5171549, buffs: [], resources: { metal: 2961, crystal: 4451, deuterium: 600, energy: 0 } },
  },
  newAjaxToken: 'secret',
};
const PLANET_IDS = Object.keys(ACCOUNT_INFO.planets);

let store;
let writes;
let fetches;
let debugLines;
let accountInfo;
let tab;
let chromeHelpers;

// sessionStorage of one browser tab, shared by the pages loaded in it; a new tab is a new game session.
function newTab() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: (key) => { items.delete(key); },
  };
}

// The chrome.* the extension uses: chrome.storage.local (in-memory, clone-on-read like real storage)
// and chrome.storage.onChanged. notify() lets tests play another context writing to storage.
function installChrome(w) {
  const listeners = [];
  const notify = (items) => listeners.forEach((listener) => listener(
    Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { oldValue: null, newValue: structuredClone(value) }])),
    'local',
  ));
  w.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const key = Array.isArray(keys) ? keys[0] : keys;
          return key in store ? { [key]: structuredClone(store[key]) } : {};
        },
        set: async (items) => {
          writes++;
          Object.assign(store, structuredClone(items));
          notify(items);
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
  };
  return { notify };
}

beforeEach(() => {
  tab = newTab();
  store = {};
  writes = 0;
  fetches = 0;
  debugLines = [];
  accountInfo = structuredClone(ACCOUNT_INFO);
});

function fakeResponse(url) {
  if (String(url).includes('action=accountInfo')) return structuredClone(accountInfo);
  return { data: { bonus: 1 } };
}

/**
 * Loads a page, runs the extension's content scripts on it and reports what happened during that load.
 * @param {string} html
 * @param {{ url?: string, script?: string, failFetch?: boolean, setup?: (w: any) => void, afterLoad?: (w: any) => void }} [options]
 */
async function runPage(html, { url = GAME_URL, script = GAME_SCRIPT, failFetch = false, setup, afterLoad } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  chromeHelpers = installChrome(w);
  w.structuredClone = structuredClone;
  w.console = { debug: (...args) => debugLines.push(args), log: console.log, error: console.error };
  if (failFetch) w.fetch = async () => { fetches++; return { ok: false, status: 500 }; };
  else w.fetch = async (requestUrl) => { fetches++; return { ok: true, text: async () => JSON.stringify(fakeResponse(requestUrl)) }; };
  Object.defineProperty(w, 'sessionStorage', { value: tab, configurable: true });
  setup?.(w);
  const writesBefore = writes;
  const fetchesBefore = fetches;
  w.eval(script);
  // Let the collection promise chain settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (afterLoad) {
    afterLoad(w);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const icon = w.document.getElementById('pfg-companion-icon');
  const result = {
    entry: Object.values(store[SNAPSHOTS_KEY] || {})[0],
    writes: writes - writesBefore,
    fetches: fetches - fetchesBefore,
    panelOpen: Boolean(w.document.getElementById('pfg-companion-panel')?.classList.contains('pfg-open')),
    panelText: w.document.getElementById('pfg-companion-panel')?.textContent ?? '',
    pending: JSON.parse(w.localStorage.getItem(PENDING_EXPORT_KEY) || 'null'),
    icon,
    iconTitle: icon?.getAttribute('title') ?? null,
  };
  w.close();
  return result;
}

test('stores resources and active items of every planet from accountInfo', async () => {
  const { entry, fetches: fetched } = await runPage(gamePage());
  assert.strictEqual(fetched, 2);
  assert.deepStrictEqual(Object.keys(entry.export.planets), PLANET_IDS);
  assert.strictEqual(entry.export.planets[4431813].resources.crystal, 14201);
  assert.strictEqual(entry.export.planets[4431812].buffs.length, 5, 'raw buffs are kept as the game sent them');
  assert.ok(!('newAjaxToken' in entry.export), 'the ajax token is stripped');
});

test('derives production boosters per planet, including bronze ones', async () => {
  const { entry } = await runPage(gamePage());
  const boosters = entry.export.pfgCompanion.productionBoosters;
  const summary = (planetId) => boosters[planetId].map(({ resource, tier }) => `${resource}:${tier}`);
  assert.deepStrictEqual(summary(4431812), ['crystal:silver', 'metal:bronze', 'deuterium:gold', 'energy:silver'], 'non-production items are left out');
  assert.deepStrictEqual(summary(4431813), ['crystal:bronze', 'deuterium:bronze']);
  assert.deepStrictEqual(boosters[5171549], []);
  assert.deepStrictEqual(boosters[4431812][0], {
    uuid: '422db99aac4ec594d483d8ef7faadc5d40d6f7d3',
    name: 'Silver Crystal Booster',
    resource: 'crystal',
    tier: 'silver',
    effectStart: 1792295400,
    effectEnd: 1792907400,
  });
});

test('fetches the account once per game session', async () => {
  await runPage(gamePage());
  accountInfo.planets[4431812].buffs = [];
  const sameSession = await runPage(gamePage());
  assert.strictEqual(sameSession.fetches, 0, 'no fetch on later page loads of the session');
  assert.strictEqual(sameSession.writes, 0);
  tab = newTab();
  const { entry: refreshed, fetches: fetched } = await runPage(gamePage());
  assert.strictEqual(fetched, 2, 'a new session fetches again');
  assert.deepStrictEqual(refreshed.export.pfgCompanion.productionBoosters[4431812], []);
});

test('does not retry a failed collection in the same session', async () => {
  const first = await runPage(gamePage(), { failFetch: true });
  assert.strictEqual(first.fetches, 2);
  const second = await runPage(gamePage(), { failFetch: true });
  assert.strictEqual(second.fetches, 0);
});

// Right after login the game answers speciesBonuses without data.
const speciesWithoutData = {
  setup(w) {
    const fetchWithData = w.fetch;
    w.fetch = async (url) => {
      if (!String(url).includes('action=speciesBonuses')) return fetchWithData(url);
      fetches++;
      return { ok: true, text: async () => JSON.stringify({ components: [] }) };
    };
  },
};

test('requests only speciesBonuses once more on the next page load when it came without data', async () => {
  const first = await runPage(gamePage(), speciesWithoutData);
  assert.strictEqual(first.fetches, 2);
  assert.strictEqual(first.entry.export.pfgCompanion.status.accountReady, false);
  const retried = await runPage(gamePage());
  assert.strictEqual(retried.fetches, 1, 'accountInfo is not requested again');
  assert.deepStrictEqual(retried.entry.export.speciesBonuses, { bonus: 1 });
  assert.strictEqual(retried.entry.export.pfgCompanion.status.accountReady, true);
  assert.strictEqual(retried.entry.collectedAt, first.entry.collectedAt, 'collectedAt stays the time of the accountInfo request');
  const later = await runPage(gamePage());
  assert.strictEqual(later.fetches, 0);
});

test('retries speciesBonuses only once per collection', async () => {
  await runPage(gamePage(), speciesWithoutData);
  const retried = await runPage(gamePage(), speciesWithoutData);
  assert.strictEqual(retried.fetches, 1);
  const later = await runPage(gamePage());
  assert.strictEqual(later.fetches, 0);
});

test('Refresh fetches the account again in the same session', async () => {
  await runPage(gamePage({ menu: true }));
  const { fetches: fetched } = await runPage(gamePage({ menu: true }), {
    afterLoad(w) {
      w.document.getElementById('pfg-companion-menu-btn').click();
      w.document.getElementById('pfg-refresh').click();
    },
  });
  assert.strictEqual(fetched, 2);
});

test('saving production factors does not fetch the account again', async () => {
  const first = await runPage(gamePage());
  const select = '<select name="productionFactor[1]"><option value="80" selected>80%</option></select>';
  const { entry, fetches: fetched, writes: written } = await runPage(gamePage({ body: select }), { url: SETTINGS_URL });
  assert.strictEqual(fetched, 0);
  assert.strictEqual(written, 1);
  assert.deepStrictEqual(entry.export.pfgCompanion.productionFactors[4431812], { 1: 80 });
  assert.strictEqual(entry.collectedAt, first.entry.collectedAt, 'collectedAt is not reset');
  assert.strictEqual(entry.export.pfgCompanion.productionBoosters[4431813].length, 2, 'boosters survive the update');
});

test('the panel shows the time of the last account request, not of the last change', async () => {
  await runPage(gamePage({ menu: true }));
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].collectedAt = '2020-01-02T12:00:00.000Z';
  const select = '<select name="productionFactor[1]"><option value="80" selected>80%</option></select>';
  const { panelText, entry } = await runPage(gamePage({ menu: true, body: select }), {
    url: SETTINGS_URL,
    afterLoad(w) { w.document.getElementById('pfg-companion-menu-btn').click(); },
  });
  assert.notStrictEqual(entry.export.exportedAt.slice(0, 4), '2020', 'saving production factors changed the snapshot');
  assert.match(panelText, /Last collection: [^\n]*2020/);
});

test('does not open the panel or log debug output by itself', async () => {
  const { panelOpen } = await runPage(gamePage({ menu: true }));
  assert.strictEqual(panelOpen, false);
  assert.deepStrictEqual(debugLines, []);
});

test('stands down when the userscript has marked the page', async () => {
  const html = gamePage({ menu: true }).replace('<html>', '<html data-pfg-companion="userscript">');
  const result = await runPage(html);
  assert.strictEqual(result.fetches, 0);
  assert.strictEqual(result.writes, 0);
  assert.strictEqual(result.icon, null, 'no menu entry is added');
  assert.strictEqual(store[SNAPSHOTS_KEY], undefined);
});

test('explains the battery level in the icon tooltip', async () => {
  const first = await runPage(gamePage({ menu: true }));
  assert.match(first.iconTitle, /^Account and planets are collected; .*missing for 3 planets\./);
  const entry = Object.values(store[SNAPSHOTS_KEY])[0];
  entry.export.pfgCompanion.productionFactors = Object.fromEntries(PLANET_IDS.map((id) => [id, { 1: 100 }]));
  const second = await runPage(gamePage({ menu: true }));
  assert.strictEqual(second.iconTitle, 'All profile data is collected.');
});

test('uses the game tooltip when OGame provides changeTooltip', async () => {
  const calls = [];
  const { icon, iconTitle } = await runPage(gamePage({ menu: true }), {
    failFetch: true,
    setup(w) {
      // Mimics OGame: the title moves to data-tooltip-title once the tooltip is created.
      // main-world.js runs in the same window here, so the bridge reaches it directly.
      w.changeTooltip = (element, title) => {
        calls.push(title);
        element.removeAttribute('title');
        element.setAttribute('data-tooltip-title', title);
      };
    },
  });
  assert.ok(icon.classList.contains('tooltipRight'));
  assert.strictEqual(iconTitle, null);
  assert.deepStrictEqual(calls, ['Nothing collected yet.'], 'the tooltip is not re-created when the text does not change');
});

test('localizes the interface by the universe language and falls back to English', async () => {
  const ru = await runPage(gamePage({ menu: true }), { url: GAME_URL.replace('s1-en', 's1-ru'), failFetch: true });
  assert.strictEqual(ru.iconTitle, 'Данные ещё не собраны.');
  const ba = await runPage(gamePage({ menu: true }), { url: GAME_URL.replace('s1-en', 's1-ba'), failFetch: true });
  assert.strictEqual(ba.iconTitle, 'Još ništa nije prikupljeno.');
  const hu = await runPage(gamePage({ menu: true }), { url: GAME_URL.replace('s1-en', 's1-hu'), failFetch: true });
  assert.strictEqual(hu.iconTitle, 'Nothing collected yet.');
});

test('every interface language has the same strings as English', async () => {
  let dictionaries;
  await runPage(gamePage(), {
    script: GAME_SCRIPT.replace('const LANGUAGE = interfaceLanguage();', 'const LANGUAGE = interfaceLanguage(); globalThis.__I18N = I18N;'),
    afterLoad(w) { dictionaries = w.__I18N; },
  });
  assert.ok(dictionaries, 'the dictionary must be exposed');
  assert.deepStrictEqual(Object.keys(dictionaries).sort(), ['bs', 'de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'sk', 'tr']);
  for (const [language, strings] of Object.entries(dictionaries)) {
    assert.deepStrictEqual(Object.keys(strings).sort(), Object.keys(dictionaries.en).sort(), language);
  }
});

test('logs debug output when localStorage has the debug flag', async () => {
  const { entry } = await runPage(gamePage(), {
    setup(w) { w.localStorage.setItem('pfg-companion:debug', '1'); },
  });
  assert.ok(entry, 'collection still works with debug on');
  assert.ok(debugLines.length > 0);
  assert.ok(debugLines.every((args) => String(args[0]).startsWith('[PfG Companion] ')));
});

const storedResources = () => store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].export.pfgCompanion.resources;

test('seeds the resources of every body from accountInfo, dated by the collection', async () => {
  const { entry } = await runPage(gamePage());
  assert.deepStrictEqual(entry.export.pfgCompanion.resources, {
    4431812: { metal: 5628786, crystal: 5118889, deuterium: 4902319, at: entry.collectedAt },
    4431813: { metal: 3411, crystal: 14201, deuterium: 16278, at: entry.collectedAt },
    5171549: { metal: 2961, crystal: 4451, deuterium: 600, at: entry.collectedAt },
  });
});

test('reads the current body off the resource bar on a later page load, without a request', async () => {
  const first = await runPage(gamePage());
  const bar = '<span id="resources_metal" data-raw="7000000.75">7.000.000</span><span id="resources_crystal" data-raw="6000000">6.000.000</span><span id="resources_deuterium" data-raw="5000000">5.000.000</span>';
  const { entry, fetches: fetched, writes: written } = await runPage(gamePage({ body: bar }));
  assert.strictEqual(fetched, 0);
  assert.strictEqual(written, 1);
  const reading = entry.export.pfgCompanion.resources[4431812];
  assert.deepStrictEqual({ ...reading, at: undefined }, { metal: 7000000, crystal: 6000000, deuterium: 5000000, at: undefined });
  assert.ok(Date.parse(reading.at) > Date.parse(first.entry.collectedAt), 'dated by the page load');
  assert.strictEqual(entry.export.exportedAt, first.entry.export.exportedAt, 'exportedAt still dates the bodies\' own resources');
  assert.strictEqual(entry.collectedAt, first.entry.collectedAt);
  assert.strictEqual(entry.export.planets[4431812].resources.metal, 5628786, 'the account data is untouched');
});

test('falls back to the page resourcesBar object, then to the bar text in either separator style', async () => {
  await runPage(gamePage());
  const fromObject = await runPage(gamePage({ body: resourceBar({ metal: 1, crystal: 2, deuterium: 3 }, { raw: false }) }), {
    setup(w) { w.resourcesBar = { resources: { metal: { amount: 11.9 }, crystal: { amount: 22 }, deuterium: { amount: 33 } } }; },
  });
  assert.deepStrictEqual(resourceValues(fromObject.entry, 4431812), [11, 22, 33]);
  const text = '<span id="resources_metal">1.234.567</span><span id="resources_crystal">2,345,678</span><span id="resources_deuterium">345 678</span>';
  const fromText = await runPage(gamePage({ body: text }));
  assert.deepStrictEqual(resourceValues(fromText.entry, 4431812), [1234567, 2345678, 345678]);
  const abbreviated = '<span id="resources_metal">1,2M</span><span id="resources_crystal">1</span><span id="resources_deuterium">1</span>';
  const skipped = await runPage(gamePage({ body: abbreviated }));
  assert.strictEqual(skipped.writes, 0, 'an abbreviated amount is not guessed at');
});

function resourceValues(entry, bodyId) {
  const reading = entry.export.pfgCompanion.resources[bodyId];
  return [reading.metal, reading.crystal, reading.deuterium];
}

test('accumulates readings of different bodies across pages', async () => {
  await runPage(gamePage());
  await runPage(gamePage({ body: resourceBar({ metal: 100, crystal: 200, deuterium: 300 }) }));
  await runPage(gamePage({ planetId: 4431813, body: resourceBar({ metal: 400, crystal: 500, deuterium: 600 }) }));
  const resources = storedResources();
  assert.deepStrictEqual(resourceValues({ export: { pfgCompanion: { resources } } }, 4431812), [100, 200, 300]);
  assert.deepStrictEqual(resourceValues({ export: { pfgCompanion: { resources } } }, 4431813), [400, 500, 600]);
  assert.strictEqual(resources[5171549].metal, 2961, 'an unvisited body keeps the accountInfo reading');
});

test('per body the newer reading wins between the bar and accountInfo', async () => {
  await runPage(gamePage());
  await runPage(gamePage({ body: resourceBar({ metal: 100, crystal: 200, deuterium: 300 }) }));
  const select = '<select name="productionFactor[1]"><option value="80" selected>80%</option></select>';
  await runPage(gamePage({ body: select }), { url: SETTINGS_URL });
  assert.strictEqual(storedResources()[4431812].metal, 100, 'a save with the older collection time keeps the newer bar reading');
  tab = newTab();
  const { entry } = await runPage(gamePage());
  assert.strictEqual(storedResources()[4431812].metal, 5628786, 'a later accountInfo replaces the older bar reading');
  assert.strictEqual(storedResources()[4431812].at, entry.collectedAt);
});

test('drops readings of bodies the export does not list', async () => {
  await runPage(gamePage());
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].export.pfgCompanion.resources[999] = { metal: 1, crystal: 1, deuterium: 1, at: new Date().toISOString() };
  tab = newTab();
  await runPage(gamePage());
  assert.ok(!(999 in storedResources()));
  const foreign = await runPage(gamePage({ planetId: 999, body: resourceBar({ metal: 1, crystal: 2, deuterium: 3 }) }));
  assert.strictEqual(foreign.writes, 0, 'a body outside the export is not stored');
  assert.ok(!(999 in storedResources()));
});

test('does not store a bar reading before the account was ever collected', async () => {
  const { writes: written } = await runPage(gamePage({ body: resourceBar({ metal: 1, crystal: 2, deuterium: 3 }) }), { failFetch: true });
  assert.strictEqual(written, 0);
  assert.strictEqual(store[SNAPSHOTS_KEY], undefined);
});

test('does not write when the bar shows the stored amounts', async () => {
  await runPage(gamePage());
  const bar = resourceBar({ metal: 100, crystal: 200, deuterium: 300 });
  const first = await runPage(gamePage({ body: bar }));
  assert.strictEqual(first.writes, 1);
  const again = await runPage(gamePage({ body: bar }));
  assert.strictEqual(again.writes, 0);
});

test('the stored amounts keep a reading less than 5 minutes old as it is', async () => {
  await runPage(gamePage());
  const bar = resourceBar({ metal: 100, crystal: 200, deuterium: 300 });
  await runPage(gamePage({ body: bar }));
  const at = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  storedResources()[4431812].at = at;
  const again = await runPage(gamePage({ body: bar }));
  assert.strictEqual(again.writes, 0);
  assert.strictEqual(storedResources()[4431812].at, at);
});

test('the stored amounts refresh the time of a reading more than 5 minutes old', async () => {
  await runPage(gamePage());
  const bar = resourceBar({ metal: 100, crystal: 200, deuterium: 300 });
  await runPage(gamePage({ body: bar }));
  const at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  storedResources()[4431812].at = at;
  const again = await runPage(gamePage({ body: bar }));
  assert.strictEqual(again.writes, 1);
  assert.ok(Date.parse(storedResources()[4431812].at) > Date.parse(at), 'at is refreshed');
  assert.deepStrictEqual(resourceValues({ export: { pfgCompanion: { resources: storedResources() } } }, 4431812), [100, 200, 300]);
});

test('a bar reading keeps the error of a failed collection', async () => {
  await runPage(gamePage());
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].error = { at: '2020-01-01T00:00:00.000Z', message: 'boom' };
  const { entry } = await runPage(gamePage({ body: resourceBar({ metal: 100, crystal: 200, deuterium: 300 }) }));
  assert.strictEqual(entry.export.pfgCompanion.resources[4431812].metal, 100);
  assert.deepStrictEqual(entry.error, { at: '2020-01-01T00:00:00.000Z', message: 'boom' });
});

// The copy/save buttons of the panel: the trimmed current-universe export (the default) or everything stored.
async function exportFrom(button, { minified = true } = {}) {
  let copied = null;
  let saved = null;
  await runPage(gamePage({ menu: true }));
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].export.speciesBonuses = { ships: { 202: { totalBonus: { speed: 0.002, fuel: 0 }, spaceObjectBonus: { 4431812: { speed: 0.002 } }, technologyBonus: {}, maximumBonusFuel: null } }, resources: {} };
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].export.planets[4431812].baseProduction = { metal: 30 };
  store[SNAPSHOTS_KEY][`en:1:${PLAYER_ID}`].export.planets[4431812].defenses = { 401: 5 };
  store[SNAPSHOTS_KEY]['en:2:1'] = { collectedAt: 'x', export: { playerId: 1, universe: { number: 2, language: 'en', host: 's2-en.ogame.gameforge.com' } } };
  await runPage(gamePage({ menu: true }), {
    setup(w) {
      w.navigator.clipboard = { writeText: async (text) => { copied = text; } };
      w.URL.createObjectURL = (blob) => { saved = blob; return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      const click = w.HTMLAnchorElement.prototype.click;
      w.HTMLAnchorElement.prototype.click = function () { if (this.download) saved = { blob: saved, name: this.download }; else click.call(this); };
    },
    afterLoad(w) {
      w.document.getElementById('pfg-companion-menu-btn').click();
      if (!minified) w.document.getElementById('pfg-minified').click();
      w.document.getElementById(button).click();
    },
  });
  return { copied, saved };
}

test('Copy puts the trimmed minified export of the current universe on the clipboard', async () => {
  const { copied } = await exportFrom('pfg-copy');
  assert.ok(!copied.includes('\n'), 'minified');
  const data = JSON.parse(copied);
  assert.strictEqual(data.schemaVersion, 2);
  assert.strictEqual(data.playerId, PLAYER_ID);
  for (const planet of Object.values(data.planets)) {
    for (const key of ['resources', 'defenses', 'baseProduction']) assert.ok(!(key in planet), key);
  }
  assert.strictEqual(data.planets[4431812].buffs.length, 5, 'buffs are kept');
  assert.deepStrictEqual(data.speciesBonuses, { ships: { 202: { totalBonus: { speed: 0.002, fuel: 0 } } }, resources: {} });
  assert.ok(data.pfgCompanion.productionBoosters);
  assert.ok(!('resources' in data.pfgCompanion), 'the resource readings are stripped');
  assert.ok(data.pfgCompanion.status, 'the rest of pfgCompanion is kept');
});

test('with Minified unchecked, Copy exports everything stored', async () => {
  const { copied } = await exportFrom('pfg-copy', { minified: false });
  const all = JSON.parse(copied);
  assert.deepStrictEqual(Object.keys(all).sort(), [`en:1:${PLAYER_ID}`, 'en:2:1']);
  assert.strictEqual(all[`en:1:${PLAYER_ID}`].export.planets[4431812].resources.metal, 5628786);
  assert.ok(copied.includes('\n'), 'indented');
});

test('Save downloads the same document as a file', async () => {
  const { saved } = await exportFrom('pfg-save');
  assert.strictEqual(saved.name, `pfg-companion-en-1-${PLAYER_ID}.json`);
  const full = await exportFrom('pfg-save', { minified: false });
  assert.strictEqual(full.saved.name, 'pfg-companion-all.json');
});

test('site mode writes all stored snapshots to localStorage and emits the sync event', async () => {
  await runPage(gamePage());
  let sync = null;
  const result = await runPage(sitePage(), {
    url: SITE_URL,
    script: SITE_SCRIPT,
    setup(w) { w.document.addEventListener('pfg-companion:sync', (event) => { sync = event.detail; }); },
  });
  assert.strictEqual(result.pending.version, 1);
  assert.strictEqual(result.pending.exports.length, 1);
  assert.strictEqual(result.pending.exports[0].playerId, PLAYER_ID);
  // The event carries the in-memory payload, localStorage the serialized one: compare modulo JSON.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sync)), result.pending);
});

test('site mode hands off again when the snapshots change', async () => {
  await runPage(gamePage());
  const events = [];
  await runPage(sitePage(), {
    url: SITE_URL,
    script: SITE_SCRIPT,
    setup(w) { w.document.addEventListener('pfg-companion:sync', (event) => events.push(event.detail)); },
    afterLoad() {
      assert.strictEqual(events.length, 1);
      store[SNAPSHOTS_KEY]['en:1:999'] = { collectedAt: '2026-01-01T00:00:00.000Z', export: { playerId: 999 } };
      chromeHelpers.notify({ [SNAPSHOTS_KEY]: store[SNAPSHOTS_KEY] });
    },
  });
  assert.strictEqual(events.length, 2, 'the storage change re-runs the hand-off');
  assert.strictEqual(events[1].exports.length, 2);
});

test('site mode clones the sync event detail into the page where cloneInto exists (Firefox)', async () => {
  await runPage(gamePage());
  const cloned = [];
  let sync = null;
  await runPage(sitePage(), {
    url: SITE_URL,
    script: SITE_SCRIPT,
    setup(w) {
      w.cloneInto = (value, target) => {
        assert.strictEqual(target, w);
        const copy = structuredClone(value);
        cloned.push(copy);
        return copy;
      };
      w.document.addEventListener('pfg-companion:sync', (event) => { sync = event.detail; });
    },
  });
  assert.strictEqual(cloned.length, 1);
  assert.strictEqual(sync, cloned[0], 'the event carries the clone, not the isolated-world object');
});

test('site mode stands down when the userscript has marked the page', async () => {
  await runPage(gamePage());
  const html = sitePage().replace('<html>', '<html data-pfg-companion="userscript">');
  const result = await runPage(html, { url: SITE_URL, script: SITE_SCRIPT });
  assert.strictEqual(result.pending, null, 'the userscript owns the hand-off');
});
