/**
 * sw-polyfill.js — prepended to service-worker-loader.js
 *
 * Provides a chrome.sidePanel shim for Arc Browser (and other Chromium
 * browsers that don't implement the Side Panel API).
 *
 * When the official extension calls chrome.sidePanel.open({ tabId }), we
 * instead send a message to our content script (arc-panel.js) that opens
 * the floating Arc-style panel.
 */

if (!globalThis.chrome?.sidePanel) {
  const _panelPaths = new Map(); // tabId -> full extension URL for sidepanel.html

  const _openPanel = async (tabId) => {
    const path = _panelPaths.get(tabId) ?? 'sidepanel.html';
    const url = chrome.runtime.getURL(path);

    const _send = () =>
      chrome.tabs.sendMessage(tabId, { type: '__CLAUDE_ARC_OPEN__', url });

    try {
      await _send();
    } catch {
      // Content script not yet ready — inject it programmatically then retry
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          files: ['arc-panel.js'],
        });
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['arc-panel.css'],
        });
      } catch {
        // scripting may fail on restricted pages — silently ignore
      }
      setTimeout(async () => {
        try { await _send(); } catch { /* page doesn't support content scripts */ }
      }, 350);
    }
  };

  chrome.sidePanel = {
    setOptions: ({ tabId, path, enabled } = {}) => {
      if (tabId != null && path) _panelPaths.set(tabId, path);
      return Promise.resolve();
    },
    open: ({ tabId } = {}) => {
      if (tabId != null) _openPanel(tabId);
      return Promise.resolve();
    },
    getOptions: ({ tabId } = {}) =>
      Promise.resolve({
        tabId,
        path: _panelPaths.get(tabId) ?? 'sidepanel.html',
        enabled: true,
      }),
    setPanelBehavior: () => Promise.resolve(),
    getPanelBehavior: () => Promise.resolve({ openPanelOnActionClick: false }),
  };
}
