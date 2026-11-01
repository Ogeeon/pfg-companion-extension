// Isolated-world side of the MAIN-world bridge. OGame's own JS objects (the page's `resourcesBar` and
// its `changeTooltip()`) are unreachable from the isolated world, where chrome.storage lives, so
// src/main-world.js (a manifest content_scripts entry with "world": "MAIN") answers these requests.
// Every request carries a requestId and the caller resolves on the matching reply, or on timeout.
const BRIDGE_REQUEST_EVENT = 'pfg-companion-bridge';
const BRIDGE_REPLY_EVENT = 'pfg-companion-bridge-reply';
const BRIDGE_TIMEOUT_MS = 200;
let bridgeSequence = 0;
const bridgePending = new Map();

window.addEventListener(BRIDGE_REPLY_EVENT, (event) => {
  const detail = event.detail || {};
  const resolve = bridgePending.get(detail.requestId);
  if (!resolve) return;
  bridgePending.delete(detail.requestId);
  resolve(detail.result ?? null);
});

/**
 * @param {Record<string, any>} request
 * @returns {Promise<any>} the page's answer, or null when the MAIN-world script did not answer in time
 */
function bridgeCall(request, timeoutMs = BRIDGE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const requestId = `pfg-${++bridgeSequence}`;
    const timer = setTimeout(() => {
      bridgePending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    bridgePending.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    window.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT, { detail: { ...request, requestId } }));
  });
}
