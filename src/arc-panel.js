/**
 * arc-panel.js — content script
 *
 * Creates the Arc-native floating sidebar that hosts sidepanel.html.
 * Handles open/close messages from the polyfilled service worker,
 * resize, squeeze/overlay mode toggle, and keyboard shortcuts.
 */

(() => {
  if (window.__claudeArcPanel) return;
  window.__claudeArcPanel = true;

  // ── Constants ───────────────────────────────────────────────────────────
  const MIN_W = 300;
  const MAX_W = 900;
  const DEFAULT_W = 420;
  const SK = {
    width: 'claude_arc_w',
    mode: 'claude_arc_mode',   // 'overlay' | 'squeeze'
    open: 'claude_arc_open',
    url: 'claude_arc_url',
  };

  // ── State ────────────────────────────────────────────────────────────────
  let panelOpen = false;
  let panelWidth = DEFAULT_W;
  let mode = 'overlay';
  let currentUrl = null;
  let isResizing = false;

  // ── Build DOM ────────────────────────────────────────────────────────────
  const host = document.createElement('div');
  host.id = 'claude-arc-host';

  // Shadow DOM so page styles don't bleed in
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      #wrap {
        --w: ${DEFAULT_W}px;
        --radius: 16px;
        --dur: 0.32s;
        --ease: cubic-bezier(0.34, 1.06, 0.64, 1);

        position: fixed;
        top: 0;
        right: 0;
        width: var(--w);
        height: 100dvh;
        z-index: 2147483647;
        transform: translateX(calc(var(--w) + 24px));
        transition: transform var(--dur) var(--ease);
        display: flex;
        flex-direction: row;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
      }

      #wrap.open {
        transform: translateX(0);
        pointer-events: all;
      }

      /* ── Resize handle ────────────────────────────────────────── */
      #handle {
        width: 8px;
        flex-shrink: 0;
        cursor: col-resize;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
      }

      #handle::before {
        content: '';
        width: 3px;
        height: 36px;
        border-radius: 99px;
        background: rgba(120, 120, 128, 0.28);
        transition: background 0.2s, height 0.2s, transform 0.1s;
      }

      #handle:hover::before,
      #handle:active::before {
        background: rgba(120, 120, 128, 0.55);
        height: 52px;
      }

      /* ── Panel shell ──────────────────────────────────────────── */
      #panel {
        flex: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        border-radius: var(--radius) 0 0 var(--radius);
        overflow: hidden;
        box-shadow:
          -2px 0 0 0 rgba(0,0,0,0.04),
          -8px 0 32px rgba(0,0,0,0.12),
          -2px 0 80px rgba(0,0,0,0.08);

        /* Arc glassmorphism */
        background: rgba(250, 249, 248, 0.96);
        backdrop-filter: blur(32px) saturate(180%);
        -webkit-backdrop-filter: blur(32px) saturate(180%);
        border-left: 1px solid rgba(0,0,0,0.07);
      }

      @media (prefers-color-scheme: dark) {
        #panel {
          background: rgba(28, 27, 26, 0.97);
          border-left: 1px solid rgba(255,255,255,0.06);
          box-shadow:
            -2px 0 0 0 rgba(0,0,0,0.3),
            -8px 0 32px rgba(0,0,0,0.4),
            -2px 0 80px rgba(0,0,0,0.2);
        }
      }

      /* ── Top bar ────────────────────────────────────────────── */
      #topbar {
        flex-shrink: 0;
        height: 44px;
        display: flex;
        align-items: center;
        padding: 0 10px 0 14px;
        gap: 6px;
        border-bottom: 1px solid rgba(0,0,0,0.06);
        background: transparent;
      }

      @media (prefers-color-scheme: dark) {
        #topbar { border-bottom-color: rgba(255,255,255,0.05); }
      }

      .topbar-spacer { flex: 1; }

      /* Arc-style pill buttons */
      .tb-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: rgba(100,100,108,0.9);
        cursor: pointer;
        transition: background 0.15s, color 0.15s, transform 0.1s;
        flex-shrink: 0;
      }

      .tb-btn:hover {
        background: rgba(120,120,128,0.12);
        color: rgba(60,60,67,1);
        transform: scale(1.05);
      }

      .tb-btn.active {
        background: rgba(99,102,241,0.12);
        color: rgba(99,102,241,1);
      }

      @media (prefers-color-scheme: dark) {
        .tb-btn { color: rgba(180,180,190,0.8); }
        .tb-btn:hover {
          background: rgba(255,255,255,0.08);
          color: rgba(220,220,230,1);
        }
      }

      /* Claude logo badge */
      #logo {
        width: 22px;
        height: 22px;
        border-radius: 7px;
        background: #CC785C;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      #logo svg { width: 14px; height: 14px; }

      /* Panel title */
      #title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: rgba(60,60,67,0.9);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-left: 2px;
      }

      @media (prefers-color-scheme: dark) {
        #title { color: rgba(220,220,230,0.85); }
      }

      /* ── Iframe ─────────────────────────────────────────────── */
      #iframe {
        flex: 1;
        width: 100%;
        border: none;
        display: block;
        background: transparent;
      }

      /* ── Loading overlay ─────────────────────────────────────── */
      #loader {
        position: absolute;
        inset: 44px 0 0 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        background: inherit;
        transition: opacity 0.3s;
        pointer-events: none;
      }

      #loader.hidden { opacity: 0; }

      .spinner {
        width: 28px;
        height: 28px;
        border: 2.5px solid rgba(120,120,128,0.2);
        border-top-color: #CC785C;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin { to { transform: rotate(360deg); } }

      .loader-text {
        font-size: 12px;
        color: rgba(120,120,128,0.7);
        letter-spacing: 0.01em;
      }
    </style>

    <div id="wrap">
      <div id="handle" title="Drag to resize"></div>
      <div id="panel">
        <div id="topbar">
          <div id="logo">
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 3L14.5 10L10 17L5.5 10L10 3Z" fill="white" opacity="0.9"/>
            </svg>
          </div>
          <span id="title">Claude</span>
          <div class="topbar-spacer"></div>
          <button class="tb-btn" id="btn-mode" title="Toggle squeeze / overlay">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1" y="1" width="5" height="13" rx="1.5" fill="currentColor" opacity="0.4"/>
              <rect x="8" y="1" width="6" height="13" rx="1.5" fill="currentColor"/>
            </svg>
          </button>
          <button class="tb-btn" id="btn-reload" title="Reload Claude">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 7C1 3.686 3.686 1 7 1c1.852 0 3.52.795 4.69 2.066L13 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M13 1.5V5H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M13 7c0 3.314-2.686 6-6 6a5.998 5.998 0 01-4.69-2.066L1 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="tb-btn" id="btn-close" title="Close (⌘E)">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <div id="loader">
          <div class="spinner"></div>
          <span class="loader-text">Loading Claude…</span>
        </div>

        <iframe id="iframe" allow="clipboard-read; clipboard-write; microphone" title="Claude"></iframe>
      </div>
    </div>
  `;

  document.documentElement.appendChild(host);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const wrap    = shadow.getElementById('wrap');
  const panel   = shadow.getElementById('panel');
  const handle  = shadow.getElementById('handle');
  const iframe  = shadow.getElementById('iframe');
  const loader  = shadow.getElementById('loader');
  const btnMode = shadow.getElementById('btn-mode');
  const btnReload = shadow.getElementById('btn-reload');
  const btnClose  = shadow.getElementById('btn-close');

  // ── Persist helpers ──────────────────────────────────────────────────────
  function save() {
    chrome.storage.local.set({
      [SK.width]: panelWidth,
      [SK.mode]: mode,
      [SK.open]: panelOpen,
      [SK.url]: currentUrl,
    });
  }

  function applyWidth() {
    wrap.style.setProperty('--w', `${panelWidth}px`);
    if (mode === 'squeeze' && panelOpen) {
      document.documentElement.style.setProperty('--_caw', `${panelWidth + 8}px`);
    }
  }

  // ── Squeeze mode ─────────────────────────────────────────────────────────
  // We inject a <style> into the main document (not shadow) to push body right.
  let squeezeStyle = null;

  function applySqueeze() {
    if (squeezeStyle) return;
    squeezeStyle = document.createElement('style');
    squeezeStyle.id = '__claude-arc-squeeze__';
    squeezeStyle.textContent = `
      html { transition: margin-right 0.32s cubic-bezier(0.34,1.06,0.64,1) !important; }
      html.__claude-arc-sq { margin-right: ${panelWidth + 8}px !important; }
    `;
    document.head.appendChild(squeezeStyle);
    requestAnimationFrame(() => document.documentElement.classList.add('__claude-arc-sq'));
  }

  function removeSqueeze() {
    document.documentElement.classList.remove('__claude-arc-sq');
    if (squeezeStyle) {
      squeezeStyle.remove();
      squeezeStyle = null;
    }
  }

  function updateSqueeze() {
    if (squeezeStyle) {
      squeezeStyle.textContent = `
        html { transition: margin-right 0.32s cubic-bezier(0.34,1.06,0.64,1) !important; }
        html.__claude-arc-sq { margin-right: ${panelWidth + 8}px !important; }
      `;
    }
  }

  // ── Open / close ─────────────────────────────────────────────────────────
  function openPanel(url, animate = true) {
    panelOpen = true;
    if (url && url !== currentUrl) {
      currentUrl = url;
      loader.classList.remove('hidden');
      iframe.src = url;
    }
    wrap.style.transition = animate
      ? 'transform var(--dur) var(--ease)'
      : 'none';
    wrap.classList.add('open');
    if (mode === 'squeeze') applySqueeze();
    save();
  }

  function closePanel(animate = true) {
    panelOpen = false;
    wrap.style.transition = animate
      ? 'transform var(--dur) var(--ease)'
      : 'none';
    wrap.classList.remove('open');
    removeSqueeze();
    save();
  }

  function toggle(url) {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel(url || currentUrl);
    }
  }

  window.__claudeArcToggle = toggle;

  // ── iframe loaded ─────────────────────────────────────────────────────────
  iframe.addEventListener('load', () => {
    loader.classList.add('hidden');
  });

  // ── Mode toggle ──────────────────────────────────────────────────────────
  function updateModeBtn() {
    btnMode.classList.toggle('active', mode === 'squeeze');
    btnMode.title = mode === 'squeeze'
      ? 'Switch to overlay mode'
      : 'Switch to squeeze mode (push page)';
  }

  btnMode.addEventListener('click', () => {
    mode = mode === 'overlay' ? 'squeeze' : 'overlay';
    updateModeBtn();
    if (panelOpen) {
      if (mode === 'squeeze') applySqueeze();
      else removeSqueeze();
    }
    save();
  });

  // ── Reload ───────────────────────────────────────────────────────────────
  btnReload.addEventListener('click', () => {
    loader.classList.remove('hidden');
    iframe.src = iframe.src; // eslint-disable-line no-self-assign
  });

  // ── Close ────────────────────────────────────────────────────────────────
  btnClose.addEventListener('click', () => closePanel());

  // ── Resize handle ────────────────────────────────────────────────────────
  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    const startX = e.clientX;
    const startW = panelWidth;
    iframe.style.pointerEvents = 'none';

    const onMove = (ev) => {
      panelWidth = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - ev.clientX)));
      applyWidth();
      updateSqueeze();
    };

    const onUp = () => {
      isResizing = false;
      iframe.style.pointerEvents = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      save();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  // ── Message from service worker polyfill ────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === '__CLAUDE_ARC_OPEN__') {
      if (panelOpen && msg.url === currentUrl) {
        closePanel();
      } else {
        openPanel(msg.url);
      }
    }
  });

  // ── Keyboard shortcut (⌘E / Ctrl+E) ─────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const hit = isMac
      ? e.metaKey && !e.shiftKey && !e.altKey && e.key === 'e'
      : e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'e';
    if (hit) {
      e.preventDefault();
      toggle();
    }
  });

  // ── Restore state ────────────────────────────────────────────────────────
  chrome.storage.local.get([SK.width, SK.mode, SK.open, SK.url], (res) => {
    if (res[SK.width]) panelWidth = res[SK.width];
    if (res[SK.mode]) mode = res[SK.mode];
    if (res[SK.url]) currentUrl = res[SK.url];
    applyWidth();
    updateModeBtn();
    if (res[SK.open] && currentUrl) openPanel(currentUrl, false);
  });
})();
