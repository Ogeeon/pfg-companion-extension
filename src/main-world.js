// Runs in the page's MAIN world (manifest content_scripts entry with "world": "MAIN", document_start):
// the isolated world cannot read OGame's own JS objects, and this script cannot use chrome.* APIs.
// It only answers bridge requests from src/bridge.js; without a requester it stays inert.
(function () {
  'use strict';
  window.addEventListener('pfg-companion-bridge', (event) => {
    const detail = event.detail || {};
    let result = null;
    if (detail.type === 'resourcesBar') {
      const value = window.resourcesBar?.resources?.[detail.key]?.amount;
      if (typeof value === 'number' || typeof value === 'string') result = value;
    } else if (detail.type === 'changeTooltip') {
      if (typeof window.changeTooltip === 'function') {
        try {
          window.changeTooltip(document.getElementById(detail.elementId), detail.text);
          result = true;
        } catch {
          result = null; // A failed tooltip falls back to a plain title on the caller's side.
        }
      }
    }
    window.dispatchEvent(new CustomEvent('pfg-companion-bridge-reply', { detail: { requestId: detail.requestId, result } }));
  });
}());
