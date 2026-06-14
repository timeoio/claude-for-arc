#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Claude for Arc — patch.sh
#  Patches the official Claude for Chrome extension to work in Arc Browser.
#
#  Usage:
#    bash patch.sh [--source chrome|arc] [--out <dir>]
#
#  Options:
#    --source chrome   Copy from Chrome's extension folder (default)
#    --source arc      Copy from Arc's own extension folder (if already installed)
#    --out <dir>       Output directory (default: ./claude-arc-patched)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
EXTENSION_ID="fcoeoabgfenejglbffodgkkbkcdhcgfn"
CHROME_BASE="$HOME/Library/Application Support/Google/Chrome/Default/Extensions/$EXTENSION_ID"
ARC_BASE="$HOME/Library/Application Support/Arc/User Data/Default/Extensions/$EXTENSION_ID"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SOURCE="chrome"
OUT_DIR="$SCRIPT_DIR/claude-arc-patched"

# ── Arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --out)    OUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────
info()    { echo "  \033[34m→\033[0m $*"; }
success() { echo "  \033[32m✓\033[0m $*"; }
warn()    { echo "  \033[33m⚠\033[0m $*"; }
die()     { echo "  \033[31m✗\033[0m $*" >&2; exit 1; }

# ── Find source extension ─────────────────────────────────────────────────────
find_latest_version() {
  local base="$1"
  if [[ ! -d "$base" ]]; then return 1; fi
  # Pick the highest version directory
  ls "$base" | sort -V | tail -1
}

echo ""
echo "  ╭─────────────────────────────────╮"
echo "  │     Claude for Arc — Patcher    │"
echo "  ╰─────────────────────────────────╯"
echo ""

if [[ "$SOURCE" == "arc" ]]; then
  BASE="$ARC_BASE"
else
  BASE="$CHROME_BASE"
fi

VERSION=$(find_latest_version "$BASE") || true

if [[ -z "$VERSION" ]]; then
  # Try the other browser as fallback
  if [[ "$SOURCE" == "chrome" ]]; then
    warn "Chrome extension not found, trying Arc…"
    BASE="$ARC_BASE"
  else
    warn "Arc extension not found, trying Chrome…"
    BASE="$CHROME_BASE"
  fi
  VERSION=$(find_latest_version "$BASE") || true
fi

[[ -z "$VERSION" ]] && die "Could not find the Claude extension in Chrome or Arc.
  Please install it first: https://claude.com/claude-for-chrome"

SRC="$BASE/$VERSION"
info "Found Claude $VERSION at: $SRC"

# ── Copy extension ────────────────────────────────────────────────────────────
info "Copying extension to: $OUT_DIR"
rm -rf "$OUT_DIR"
cp -r "$SRC" "$OUT_DIR"
success "Copied"

# ── Patch manifest.json ───────────────────────────────────────────────────────
info "Patching manifest.json…"
MANIFEST="$OUT_DIR/manifest.json"

python3 - "$MANIFEST" "$SCRIPT_DIR" << 'PYEOF'
import json, sys, os

manifest_path = sys.argv[1]
script_dir = sys.argv[2]

with open(manifest_path) as f:
    m = json.load(f)

# Remove sidePanel permission (Arc doesn't support it)
if 'permissions' in m:
    m['permissions'] = [p for p in m['permissions'] if p != 'sidePanel']

# Remove update_url so Arc accepts it as an unpacked extension
m.pop('update_url', None)

# Keep the key so the extension ID stays identical to the official one → auth works
# (user must uninstall the official Arc extension to avoid conflict)

# Rename so it's identifiable
m['name'] = 'Claude for Arc'

with open(manifest_path, 'w') as f:
    json.dump(m, f, indent=2)

print(f"    permissions: {m['permissions']}")
PYEOF

success "manifest.json patched"

# ── Patch service worker ──────────────────────────────────────────────────────
info "Patching service worker (injecting sidePanel polyfill)…"

SW_LOADER="$OUT_DIR/service-worker-loader.js"
POLYFILL="$SCRIPT_DIR/src/sw-polyfill.js"

if [[ ! -f "$SW_LOADER" ]]; then
  die "service-worker-loader.js not found in extension. Has the extension structure changed?"
fi

# Prepend polyfill to the loader
ORIGINAL=$(cat "$SW_LOADER")
POLYFILL_CONTENT=$(cat "$POLYFILL")

cat > "$SW_LOADER" << JSEOF
// ── Claude for Arc: sidePanel polyfill ────────────────────────────────────
${POLYFILL_CONTENT}
// ── Original service-worker-loader.js ─────────────────────────────────────
${ORIGINAL}
JSEOF

success "service-worker-loader.js patched"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "  ╭─────────────────────────────────────────────────────╮"
echo "  │  ✓  Patch complete!                                 │"
echo "  │                                                     │"
echo "  │  To install in Arc:                                 │"
echo "  │  1. Open arc://extensions                           │"
echo "  │  2. Enable Developer mode (top right)               │"
echo "  │  3. Click \"Load unpacked\"                           │"
echo "  │  4. Select:                                         │"
echo "  │     $OUT_DIR"
echo "  │                                                     │"
echo "  │  Then press ⌘E on any page to open Claude!         │"
echo "  ╰─────────────────────────────────────────────────────╯"
echo ""
