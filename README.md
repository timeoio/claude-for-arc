<div align="center">

  <h1>Claude for Arc</h1>
  <p>The official Claude for Chrome extension, natively integrated into Arc Browser.</p>

  <img src="https://img.shields.io/badge/Arc_Browser-compatible-5B5EA6?style=flat-square"/>
  <img src="https://img.shields.io/badge/Claude-1.0.75-CC785C?style=flat-square"/>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square"/>
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square"/>
</div>

---

## Why

The official **Claude for Chrome** extension uses the `chrome.sidePanel` API. Arc Browser doesn't implement it — so clicking the extension icon does nothing, and shows a "Browser not supported" notification.

This patcher injects a minimal `chrome.sidePanel` polyfill into the extension's service worker, and replaces the native side panel with a floating Arc-native sidebar.

**Zero original code is replaced.** Only two files are added (`arc-panel.js`, `arc-panel.css`) and the service worker gets a 40-line shim prepended. The extension ID stays the same → your login and settings persist.

---

## Features

| | |
|---|---|
| **Arc-native sidebar** | Slides in from the right with spring animation |
| **Squeeze mode** | Pushes page content left — like a real side panel |
| **Overlay mode** | Floats on top — zero layout impact |
| **Resizable** | Drag the left edge (280px → 900px) |
| **⌘E shortcut** | Same shortcut as Chrome — just works |
| **State persistence** | Remembers your width, mode, and open/closed state |
| **Dark mode** | Follows system preference |
| **All Claude features** | Computer use, MCP, page context — nothing removed |
| **Auto-updates** | Re-run `patch.sh` after Claude updates |

---

## Install

**Requirements:** Arc Browser, Claude for Chrome installed in Chrome (or Arc)

```bash
# Clone this repo
git clone https://github.com/YOUR_USERNAME/claude-for-arc
cd claude-for-arc

# Run the patcher (auto-detects your Chrome/Arc Claude extension)
bash patch.sh
```

Then in Arc:
1. Go to `arc://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `claude-arc-patched/` folder
5. Press **⌘E** on any page — Claude opens 

>  **If you had Claude installed in Arc before:** you'll see two Claude entries in `arc://extensions`. Disable the official one (grey toggle) and keep only **Claude for Arc** active.

---

## Usage

| Action | How |
|--------|-----|
| Open / close | `⌘E` or click the toolbar icon |
| Squeeze mode | Click the layout icon in the top bar |
| Overlay mode | Click the layout icon again |
| Resize | Drag the left edge of the panel |
| Reload Claude | Click the reload icon in the top bar |

---

## How it works

```
patch.sh
  ├── Copies the official Claude extension
  ├── Removes `sidePanel` permission from manifest.json
  ├── Removes update_url (required for unpacked extensions)
  ├── Adds arc-panel.js + arc-panel.css as content scripts
  └── Prepends src/sw-polyfill.js to service-worker-loader.js

sw-polyfill.js (service worker)
  └── Provides a chrome.sidePanel shim:
        setOptions() → stores the sidepanel.html path
        open({tabId}) → sends __CLAUDE_ARC_OPEN__ message to content script

```

---

## Updating Claude

When Anthropic releases a new version of the extension, just re-run the patcher:

```bash
bash patch.sh
```

Then go to `arc://extensions` and click the **reload** icon on the Claude for Arc extension.

---

## Options

```bash
bash patch.sh [--source chrome|arc] [--out <dir>]

  --source chrome   Copy from Chrome's extension folder (default)
  --source arc      Copy from Arc's own extension folder
  --out <dir>       Output directory (default: ./claude-arc-patched)
```

---

## Limitations

- Doesn't work on `arc://`, `chrome://`, or `chrome-extension://` pages (browser restriction)
- Pages that use `width: 100vw` may overflow slightly in squeeze mode
- The `⌘E` shortcut is registered at the document level — if a page captures it first, use the toolbar icon

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <sub>Not affiliated with Anthropic. Claude and Claude for Chrome are trademarks of Anthropic.</sub>
</div>
