#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "$SCRIPT_DIR/node_modules" ] && command -v npm >/dev/null 2>&1; then
    npm install
fi

APP_BIN="$SCRIPT_DIR/bin/trafficity-mod-manager"
if [ ! -x "$APP_BIN" ]; then
    npm run build:ui
fi

exec "$APP_BIN" "$@"
