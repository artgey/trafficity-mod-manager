#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[Trafficity Mod Manager] Node.js (and npm) are required for patching and mod management." >&2
    echo "Install Node.js from https://nodejs.org/ or your system package manager and re-run ./launch-app.sh." >&2
    exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[Trafficity Mod Manager] Installing Node dependencies..."
    npm install
fi

APP_BIN="$SCRIPT_DIR/bin/trafficity-mod-manager"
if [ ! -x "$APP_BIN" ]; then
    if ! command -v qmake6 >/dev/null 2>&1; then
        echo "[Trafficity Mod Manager] Desktop UI binary not found and qmake6 is not installed." >&2
        echo "Install Qt6 build packages (e.g. Debian/Ubuntu: sudo apt install g++ qmake6 qt6-base-dev qt6-declarative-dev qml6-module-qtquick-controls qml6-module-qtquick-layouts qml6-module-qtquick-templates)" >&2
        echo "Or use the CLI directly: npm run patch | npm run health | npm run status" >&2
        exit 1
    fi
    echo "[Trafficity Mod Manager] Building Qt6 Quick desktop UI..."
    npm run build:ui
fi

exec "$APP_BIN" "$@"
