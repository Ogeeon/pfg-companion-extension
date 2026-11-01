// The in-game UI: the PfG Companion menu entry with the battery-level icon and the slide-out panel.
// Ported verbatim from the userscript; GM_addStyle became a plain <style> element and the icon tooltip
// is applied through the MAIN-world bridge (OGame's changeTooltip()) instead of unsafeWindow.
const LEVEL_ICONS = {
    1: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAbCAYAAACN1PRVAAAAAXNSR0IB2cksfwAAAARnQU1BAACxjwv8YQUAAAAgY0hSTQAAeiYAAICEAAD6AAAAgOgAAHUwAADqYAAAOpgAABdwnLpRPAAAAAZiS0dEAP4AxQCIekAK+gAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+oKEBcuDHp6LYgAAAG7SURBVEjHvVZLTgJBEH3VM8oghgghojFqXLjRrYnxFh7BtQdy7RG8hTFx7cZo/EQBIQGi8pvuLhfzA6YFxGEqmU+qa/rNe13VXQTfdvcPWEkXSZtlL+H5/o4AgPKbh3uFnH5USo5GseFLMvh4wpgPJt0+3p4eiGKM+B80fvkZhoY7cCG631/JacaGC4AQtveMBc1htm0b/cLyp2cdgWmtzHpb1kxgUkqjXysN9nSMwIQwT6qUSkhdD80GgI1yCYu0Sq0+tGYLNiKKmAV2enZuDL66vEC11jCObZRLE8eGy8lOg1kAmoqMYYm0mw1ge2tq4GDQn2tsBKzf7cwUWK+8gpnhOA56vV7o39newsf7S6zIpZTYGSMxs4zM3ioPA/21yFNJkNub63Cf5qPjk1TA0ilqISJmaaV+qnU2EUwIkR6Y1jpRwKkzcYJsxbKTBQAsZ7JmMK1jbOfOymwuz6Dg6CaAGFppL0+1OVH7velbXMZZCU9pSwiAyWu+VteK7OGxvzUFt9FjPa4rD/VvDJAnceezhVy+AKIo+KvdorDTK65vMhjQ7LdZ42A8VpUEgH3HL+/Cb5ia9SoBwA8BNLj4d4SodgAAAABJRU5ErkJggg==',
    2: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAbCAYAAACN1PRVAAAAAXNSR0IB2cksfwAAAARnQU1BAACxjwv8YQUAAAAgY0hSTQAAeiYAAICEAAD6AAAAgOgAAHUwAADqYAAAOpgAABdwnLpRPAAAAAZiS0dEAP4AxQCIekAK+gAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+oKEBctN+Bcl28AAAGkSURBVEjHvVbNTsJAEP5mWwXEECFGJUaNBy96NTG+hY/g2Qfy7CP4FsbEsxejURMVhASICBZ2dzx02wJdfgKlk/Qnu9P59vs6szsEYwdHx6xkH0mb467g7emRAIAK5ZPDYl6/KCWHvdjyJVnGeMKcAZN9Dx+vz0QxRrwAjTGLYWj0e32I7m87Oc3YcgEQwvWfMac5zHVd67hwTHjWEZjWyq6348wEJqW0jmulwb6OEZgQ9qBKqYTU9dFcANjZ3sQy7ataG/hnSzYiipgFdnF5ZXW+vbmeOFep1q1zoWLmn7lpMAtAU5ExLJFWow7s7S4UpNfzZgPzup2FV/z9+R4rcikl9kdILEXGcUWeSoI83N+F+zSfnp2nApZOUQsRMUsr9VOts4lgQoj0wLTWiQJOjcQJshWr2RwAYDWTs4NpHWM7d1bm8gUGBUc3AcTQSvt5qu2J6v1N3+Iy2bXwlHaEAJj85mt9o8Q+HpsGJbgNH+txXXmgf2OAfIk7P03kC0UQRc7tVpPCTq+0VWYwoNm0WaNgPFKVBIDNwJh3YRqmRq1CAPAP6punHgPbUS0AAAAASUVORK5CYII=',
    3: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAbCAYAAACN1PRVAAAAAXNSR0IB2cksfwAAAARnQU1BAACxjwv8YQUAAAAgY0hSTQAAeiYAAICEAAD6AAAAgOgAAHUwAADqYAAAOpgAABdwnLpRPAAAAAZiS0dEAP4AxQCIekAK+gAAAAlwSFlzAAAuIwAALiMBeKU/dgAAAAd0SU1FB+oKEBcsM/4qYjcAAAGDSURBVEjH3VZLTgJBEH1VM/IRQ4QYlZVx4Ua3JsZbeATXHsi1R/AWxsS1G6PRhVGDCRARRKarXMwPmAYMDr2wkvmkuqbfvNdV3UWIbGdvX00wRN7m+St4urslAKBq42C3VpEHY4LxKLV8SRafzhiLwILhAM+P90QZRvoHGlN+RiEYfg/B/c9ufpqp5QLA7IfPTNAC5vu+1c9eNL1KCiZi7Hp73q/AgiCw+sUINNQxBWO2T2qMyUndEM0HgO2tDSzTXt6aI2u2ZCOilFlsJ6dn1uDLi/OFx0bLyXfBLF4mJzImpdBpvbsDG/R77sBcyugkQW6ur5J9Wg+Pjp2AuSlq5pTZv0yQmWDM7A5MRHIFnDuT5siWC6UyAKBQLNvBRDJsF87KcqWqoPjoJoAUYiTMU7En6uBr/hZXLK0mp7THDCiFzdfael1DPI0alPg2fqxnddWR/k0BCiXufbRRqdZAlAZ3O21KOr36ZkOhgGjUZk2C6URVEgCNHFPeOWqYWs1XAoAf+zia+YGUmpsAAAAASUVORK5CYII=',
  };

/** @param {string} css */
function addStyles(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head?.append(style);
}

function addGameStyles() {
  addStyles(`
      #pfg-companion-panel { position:fixed; inset:0 auto 0 0; z-index:100000; width:280px; padding:16px; box-sizing:border-box; color:#dcecff; background:#101926; border-right:1px solid #52769f; box-shadow:4px 0 24px #0009; font:12px Arial,sans-serif; transform:translateX(-100%); transition:transform .18s ease; overflow:auto; }
      #pfg-companion-panel.pfg-open { transform:translateX(0); }
      #pfg-companion-panel h2 { margin:0 0 12px; font-size:16px; color:#9bd1ff; }
      #pfg-companion-panel button { float:right; color:#cbdced; background:transparent; border:0; cursor:pointer; font-size:18px; }
      .pfg-battery { display:inline-flex; width:20px; height:11px; border:1px solid #98b5d0; border-radius:2px; padding:1px; vertical-align:middle; box-sizing:border-box; }
      .pfg-battery::after { content:''; width:2px; height:5px; align-self:center; margin-left:2px; background:#98b5d0; }
      .pfg-battery > span { display:block; height:100%; background:#70b7e8; }
      .pfg-battery > span { width:28%; } .pfg-battery[data-level="1"] > span { width:28% !important; } .pfg-battery[data-level="2"] > span { width:60% !important; } .pfg-battery[data-level="3"] > span { width:100% !important; }
      #pfg-companion-panel ul { padding-left:18px; line-height:1.5; } #pfg-companion-panel .pfg-muted { color:#91a6bb; }
      #pfg-companion-panel .pfg-actions { display:flex; gap:8px; margin-top:12px; } #pfg-companion-panel .pfg-actions button { float:none; background:#1a2a40; border:1px solid #52769f; border-radius:4px; padding:4px 8px; font-size:12px; cursor:pointer; color:#dcecff; }
      #pfg-companion-panel .pfg-minified { display:block; margin-top:16px; padding-top:12px; border-top:1px solid #52769f; cursor:pointer; } #pfg-companion-panel .pfg-minified input { vertical-align:middle; margin:0 6px 0 0; }
      #pfg-companion-panel .pfg-actions button:disabled { opacity:.5; cursor:default; }
      #pfg-companion-menu { cursor:pointer; }
      #pfg-companion-menu .menu_icon { display:inline-block; vertical-align:middle; margin-right:4px; }
      #pfg-companion-icon { display:inline-block; width:27px; height:27px; margin-left:4px; border:0; background:transparent; box-sizing:border-box; text-decoration:none; line-height:0; }
      #pfg-companion-icon:hover { background:transparent; }
      #pfg-companion-icon .pfg-level-icon { display:block; width:27px; height:27px; }
    `);
}

// Whether the panel exports the trimmed current-universe document (for AI chats) or everything the extension has stored.
let exportMinified = true;

/**
 * The document for AI chats: the contract is in the ProxyForGame docs (ogame-api-import.md).
 * @param {any} exportData
 */
function trimmedExport(exportData) {
  const result = { ...exportData };
  for (const group of ['planets', 'moons']) {
    if (!result[group] || typeof result[group] !== 'object') continue;
    result[group] = Object.fromEntries(Object.entries(result[group]).map(([id, body]) => {
      const { resources, defenses, baseProduction, ...kept } = body || {};
      return [id, kept];
    }));
  }
  if (result.pfgCompanion && typeof result.pfgCompanion === 'object') {
    const { resources, ...companion } = result.pfgCompanion;
    result.pfgCompanion = companion;
  }
  result.speciesBonuses = onlyTotalBonus(result.speciesBonuses);
  return result;
}

// speciesBonuses is category -> bonus name -> { totalBonus, spaceObjectBonus, technologyBonus, ... }:
// descend to the objects that carry totalBonus and keep only that.
function onlyTotalBonus(node) {
  if (!node || typeof node !== 'object') return node;
  if ('totalBonus' in node) return { totalBonus: node.totalBonus };
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, onlyTotalBonus(child)]));
}

function hasExportData() {
  return exportMinified ? Boolean(activeEntry()?.export) : Object.keys(snapshots()).length > 0;
}

/** @returns {{ text: string, name: string } | null} */
function exportFile() {
  if (!hasExportData()) return null;
  if (!exportMinified) return { text: JSON.stringify(snapshots(), null, 2), name: 'pfg-companion-all.json' };
  const data = activeEntry().export;
  const uni = data.universe;
  return { text: JSON.stringify(trimmedExport(data)), name: `pfg-companion-${uni?.language}-${uni?.number}-${data.playerId}.json` };
}

/** @param {string} text */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (err) {
    debug('clipboard API failed, falling back to execCommand:', err);
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;opacity:0;';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copy failed');
}

/** @param {string} text @param {string} name */
function saveTextFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {{ collectedAt?: string, export?: any, error?: { at: string, message: string } } | null} entry */
function showPanel(entry) {
  const panel = document.getElementById('pfg-companion-panel');
  if (!panel) return;
  const exportData = entry?.export || null;
  const collectionError = entry?.error || null;
  const status = collectionStatus(exportData);
  debug('showPanel: status', status);
  // The time of the last accountInfo request, not of the last change: saving production factors does not request anything.
  const collectedAt = entry?.collectedAt ? formatDate(entry.collectedAt) : t('never');
  const missing = status.missingProduction?.length
    ? `<p>${escapeHtml(t('missingProduction'))}</p><ul>${status.missingProduction.map((planet) => `<li>${escapeHtml(planet.name || planet.id)} [${escapeHtml(planet.coords || '')}]</li>`).join('')}</ul>`
    : '';
  const error = collectionError ? `<p class="pfg-muted">${escapeHtml(t('lastError', { message: collectionError.message, date: formatDate(collectionError.at) }))}</p>` : '';
  panel.innerHTML = `<button type="button" aria-label="${escapeHtml(t('close'))}">×</button><h2>ProxyForGame companion</h2><p>${escapeHtml(panelText(exportData, status))}</p><p class="pfg-muted">${escapeHtml(t('lastCollection', { date: collectedAt }))}</p>${missing}${error}<div class="pfg-actions"><button type="button" id="pfg-refresh">${escapeHtml(t('refresh'))}</button><button type="button" id="pfg-clear">${escapeHtml(t('clear'))}</button></div>`
    + `<label class="pfg-minified"><input type="checkbox" id="pfg-minified"${exportMinified ? ' checked' : ''}>${escapeHtml(t('minified'))}</label>`
    + `<div class="pfg-actions"><button type="button" id="pfg-copy"${hasExportData() ? '' : ' disabled'}>${escapeHtml(t('copy'))}</button><button type="button" id="pfg-save"${hasExportData() ? '' : ' disabled'}>${escapeHtml(t('saveFile'))}</button></div>`;
  panel.querySelector('button:not([id])')?.addEventListener('click', () => panel.classList.remove('pfg-open'));
  panel.querySelector('#pfg-refresh')?.addEventListener('click', () => {
    debug('refresh clicked, forcing collection');
    void collectAccount(true).then(() => {
      debug('refresh flow: collection succeeded, saving production factors and refreshing UI');
      saveProductionFactors();
      refreshGameUi();
      const current = activeEntry();
      showPanel(current);
    }).catch((err) => {
      debug('refresh flow: collection failed:', err);
      recordError(err);
      refreshGameUi();
      const current = activeEntry();
      showPanel(current);
    });
  });
  panel.querySelector('#pfg-clear')?.addEventListener('click', () => {
    const uni = universe();
    const entry = activeEntry();
    const all = snapshots();
    if (entry?.export?.playerId && uni) {
      delete all[accountKey(entry.export.playerId, uni)];
    } else {
      Object.keys(all).forEach((key) => delete all[key]);
    }
    saveSnapshots(all);
    refreshGameUi();
    showPanel(activeEntry());
  });
  panel.querySelector('#pfg-minified')?.addEventListener('change', (event) => {
    exportMinified = event.target.checked;
    showPanel(activeEntry());
  });
  panel.querySelector('#pfg-copy')?.addEventListener('click', (event) => {
    const file = exportFile();
    if (!file) return;
    const button = event.currentTarget;
    void copyText(file.text).then(() => {
      button.textContent = t('copied');
      setTimeout(() => { button.textContent = t('copy'); }, 1500);
    }).catch((err) => debug('copy failed:', err));
  });
  panel.querySelector('#pfg-save')?.addEventListener('click', () => {
    const file = exportFile();
    if (file) saveTextFile(file.text, file.name);
  });
  panel.classList.add('pfg-open');
}

/** @param {string} value */
function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function panelText(exportData, status) {
  if (status.level === 3) return t('done');
  if (status.level === 2) return '';
  if (!exportData) return t('start');
  const missing = [];
  if (!status.accountReady) missing.push(t('accountPanel'));
  if (!status.bodiesReady) missing.push(t('planets'));
  return t('missing', { items: formatList(missing) });
}

function installGameUi() {
  addGameStyles();
  const panel = document.createElement('aside');
  panel.id = 'pfg-companion-panel';
  document.body.append(panel);
  const menu = document.getElementById('menuTable');
  if (!menu || document.getElementById('pfg-companion-menu')) return;
  const entry = document.createElement('li');
  entry.id = 'pfg-companion-menu';
  const status = collectionStatus(activeEntry()?.export);
  entry.innerHTML = `
      <span class="menu_icon">
        <a id="pfg-companion-icon" class="tooltipRight js_hideTipOnMobile" href="#" target="_self" style="display:block;line-height:0;text-decoration:none;">
          <img class="pfg-level-icon" src="${LEVEL_ICONS[status.level] || LEVEL_ICONS[1]}" alt="${escapeHtml(t('iconAlt'))}" width="27" height="27">
        </a>
      </span>
      <a class="menubutton" href="#" id="pfg-companion-menu-btn"><span class="textlabel">PfG Companion</span></a>
    `;
  const openPanel = (event) => {
    event.preventDefault();
    const panel = document.getElementById('pfg-companion-panel');
    if (panel?.classList.contains('pfg-open')) {
      panel.classList.remove('pfg-open');
      return;
    }
    const current = activeEntry();
    showPanel(current);
  };
  entry.querySelector('#pfg-companion-icon')?.addEventListener('click', openPanel);
  entry.querySelector('#pfg-companion-menu-btn')?.addEventListener('click', openPanel);
  menu.append(entry);
  refreshGameUi();
}

/** @param {any} exportData @param {ReturnType<typeof collectionStatus>} status */
function levelTooltip(exportData, status) {
  if (status.level === 3) return t('done');
  if (status.level === 2) return t('partial', { count: status.missingProduction.length });
  if (!exportData) return t('nothing');
  const missing = [];
  if (!status.accountReady) missing.push(t('account'));
  if (!status.bodiesReady) missing.push(t('planets'));
  return t('missingTip', { items: formatList(missing) });
}

function refreshGameUi() {
  const exportData = activeEntry()?.export;
  const status = collectionStatus(exportData);
  const iconSrc = LEVEL_ICONS[status.level] || LEVEL_ICONS[1];
  document.querySelectorAll('#pfg-companion-menu .pfg-level-icon').forEach((icon) => icon.setAttribute('src', iconSrc));
  setIconTooltip(levelTooltip(exportData, status));
}

// OGame turns `title` into its own tooltip only during its initial pass over the page, which has already
// run when the menu entry is added, so the game's changeTooltip() (in the MAIN world) is called through
// the bridge. Falls back to a plain title.
/** @param {string} text */
async function setIconTooltip(text) {
  const icon = document.getElementById('pfg-companion-icon');
  if (!icon || icon.getAttribute('data-tooltip-title') === text) return;
  const applied = await bridgeCall({ type: 'changeTooltip', elementId: 'pfg-companion-icon', text }, 500);
  if (!applied) icon.setAttribute('title', text);
}
