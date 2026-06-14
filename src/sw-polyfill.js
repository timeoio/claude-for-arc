/**
 * sw-polyfill.js — prepended to service-worker-loader.js
 *
 * Provides a chrome.sidePanel shim for Arc Browser.
 * Opens sidepanel.html as a frameless popup window flush against the right
 * edge of the Arc window, kept in sync as the window moves/resizes.
 */

if (!globalThis.chrome?.sidePanel) {
  const PANEL_W = 400;
  const _panelPaths = new Map();  // tabId -> path
  let _panelWindowId = null;
  let _mainWindowId = null;
  let _boundsListenerActive = false;

  // ── Keep popup flush to the right of the main window ──────────────────
  const _syncBounds = async () => {
    if (!_panelWindowId || !_mainWindowId) return;
    try {
      const [main, panel] = await Promise.all([
        chrome.windows.get(_mainWindowId),
        chrome.windows.get(_panelWindowId),
      ]);
      if (!main || !panel) return;
      if (main.state === 'fullscreen' || main.state === 'maximized') return;

      const targetLeft = main.left + main.width - PANEL_W;
      const targetTop  = main.top;
      const targetH    = main.height;

      if (
        panel.left   !== targetLeft ||
        panel.top    !== targetTop  ||
        panel.height !== targetH
      ) {
        await chrome.windows.update(_panelWindowId, {
          left:   targetLeft,
          top:    targetTop,
          height: targetH,
          width:  PANEL_W,
        });
      }
    } catch {
      // panel was closed
      _panelWindowId = null;
    }
  };

  const _startSync = () => {
    if (_boundsListenerActive) return;
    _boundsListenerActive = true;
    chrome.windows.onBoundsChanged.addListener(_syncBounds);
  };

  const _stopSync = () => {
    _boundsListenerActive = false;
    chrome.windows.onBoundsChanged.removeListener(_syncBounds);
  };

  // ── Open / toggle panel ────────────────────────────────────────────────
  const _openPanel = async (tabId) => {
    // Toggle: close if already open
    if (_panelWindowId !== null) {
      try {
        await chrome.windows.remove(_panelWindowId);
      } catch { /* already closed */ }
      _panelWindowId = null;
      _stopSync();
      return;
    }

    const path = _panelPaths.get(tabId) ?? `sidepanel.html?tabId=${tabId}`;
    const url  = chrome.runtime.getURL(path);

    // Get main window bounds
    let left = 1100, top = 0, height = 900;
    try {
      const win = await chrome.windows.getCurrent({ populate: false });
      _mainWindowId = win.id;
      left   = (win.left ?? 0) + (win.width ?? 1500) - PANEL_W;
      top    = win.top ?? 0;
      height = win.height ?? 900;
    } catch { /* use defaults */ }

    try {
      const popup = await chrome.windows.create({
        url,
        type:   'popup',
        width:  PANEL_W,
        height,
        left,
        top,
        focused: true,
      });
      _panelWindowId = popup.id ?? null;
      _startSync();

      // Clean up when popup is closed by user
      const onRemoved = (windowId) => {
        if (windowId === _panelWindowId) {
          _panelWindowId = null;
          _stopSync();
          chrome.windows.onRemoved.removeListener(onRemoved);
        }
      };
      chrome.windows.onRemoved.addListener(onRemoved);
    } catch (e) {
      console.warn('[Claude for Arc] Could not open panel:', e);
    }
  };

  // ── Shim ──────────────────────────────────────────────────────────────
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
