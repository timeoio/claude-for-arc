/**
 * sw-polyfill.js — prepended to service-worker-loader.js
 *
 * Provides a chrome.sidePanel shim for Arc Browser.
 * Opens sidepanel.html as a frameless popup window flush against the right
 * edge of the Arc window, kept in sync as the window moves/resizes.
 */

if (!globalThis.chrome?.sidePanel) {
  const PANEL_W = 436;
  const _panelPaths = new Map(); // tabId -> path
  let _panelWindowId = null;
  let _mainWindowId  = null;
  let _syncing       = false;

  // ── Sync popup position to main window ──────────────────────────────────
  const _syncBounds = async (windowId) => {
    if (!_panelWindowId || !_mainWindowId) return;
    if (windowId === _panelWindowId) return; // ignore popup's own moves
    if (windowId !== _mainWindowId)   return; // ignore unrelated windows
    if (_syncing) return;
    _syncing = true;
    try {
      const main = await chrome.windows.get(_mainWindowId);
      if (!main || main.state === 'fullscreen' || main.state === 'minimized') return;
      await chrome.windows.update(_panelWindowId, {
        left:   main.left + main.width - PANEL_W,
        top:    main.top,
        width:  PANEL_W,
        height: main.height,
      });
    } catch {
      _panelWindowId = null;
      chrome.windows.onBoundsChanged.removeListener(_syncBounds);
    } finally {
      _syncing = false;
    }
  };

  // ── Open / toggle panel ────────────────────────────────────────────────
  const _openPanel = async (tabId) => {
    // Toggle: close if already open
    if (_panelWindowId !== null) {
      try { await chrome.windows.remove(_panelWindowId); } catch { /* already closed */ }
      _panelWindowId = null;
      chrome.windows.onBoundsChanged.removeListener(_syncBounds);
      return;
    }

    const path = _panelPaths.get(tabId) ?? `sidepanel.html?tabId=${tabId}`;
    const url  = chrome.runtime.getURL(path);

    // Get the Arc window from the tab (most reliable from service worker)
    let left = 900, top = 0, height = 800;
    try {
      const tab = await chrome.tabs.get(tabId);
      const win = await chrome.windows.get(tab.windowId);
      _mainWindowId = win.id;
      left   = (win.left ?? 0) + (win.width ?? 1320) - PANEL_W;
      top    = win.top ?? 0;
      height = win.height ?? 800;
    } catch { /* use defaults */ }

    try {
      // Create first, then force position — macOS ignores create() coords
      const popup = await chrome.windows.create({
        url,
        type:    'popup',
        width:   PANEL_W,
        height,
        focused: true,
      });
      _panelWindowId = popup.id ?? null;

      // macOS restores window to last position — force correct bounds multiple times
      const _forcePosition = async () => {
        if (!_panelWindowId) return;
        try {
          await chrome.windows.update(_panelWindowId, { left, top, width: PANEL_W, height });
        } catch { /* popup already closed */ }
      };

      // Fire immediately, then again after macOS restoration animation
      await _forcePosition();
      setTimeout(_forcePosition, 150);
      setTimeout(_forcePosition, 400);

      // Start syncing position
      chrome.windows.onBoundsChanged.addListener(_syncBounds);

      // Clean up when popup is closed by user
      const onRemoved = (windowId) => {
        if (windowId === _panelWindowId) {
          _panelWindowId = null;
          chrome.windows.onBoundsChanged.removeListener(_syncBounds);
          chrome.windows.onRemoved.removeListener(onRemoved);
        }
      };
      chrome.windows.onRemoved.addListener(onRemoved);
    } catch (e) {
      console.warn('[Claude for Arc] Could not open panel:', e);
    }
  };

  // ── Shim ────────────────────────────────────────────────────────────────
  chrome.sidePanel = {
    setOptions: ({ tabId, path } = {}) => {
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
        path:    _panelPaths.get(tabId) ?? 'sidepanel.html',
        enabled: true,
      }),
    setPanelBehavior: () => Promise.resolve(),
    getPanelBehavior: () =>
      Promise.resolve({ openPanelOnActionClick: false }),
  };
}
