#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "$SCRIPT_DIR/node_modules" ] && command -v npm >/dev/null 2>&1; then
    echo "Installing Node dependencies..."
    npm install
fi

show_cli_menu() {
    while true; do
        echo ""
        echo "=========================================="
        echo "  Trafficity Mod Manager (Linux CLI)"
        echo "=========================================="
        echo "  [1] Patch Game (npm run patch)"
        echo "  [2] Restore Stock (npm run restore)"
        echo "  [3] Check Status (npm run status)"
        echo "  [4] Open API Docs (docs/api.html)"
        echo "  [5] Exit"
        echo ""
        read -rp "Select an option (1-5): " choice
        case "$choice" in
            1) npm run patch ;;
            2) npm run restore ;;
            3) npm run status ;;
            4)
                if command -v xdg-open >/dev/null 2>&1; then
                    xdg-open "$SCRIPT_DIR/docs/api.html" >/dev/null 2>&1 &
                else
                    echo "Open: $SCRIPT_DIR/docs/api.html"
                fi
                ;;
            5) exit 0 ;;
            *) echo "Invalid option." ;;
        esac
    done
}

if [ "${1:-}" = "--cli" ]; then
    show_cli_menu
fi

APP_BIN="$SCRIPT_DIR/bin/trafficity-mod-manager"
if [ ! -x "$APP_BIN" ] && command -v qmake6 >/dev/null 2>&1; then
    echo "UI binary not found at $APP_BIN. Building..."
    npm run build:ui
fi

if [ -x "$APP_BIN" ]; then
    exec "$APP_BIN" "$@"
fi

echo "Qt6 Quick UI binary not available; falling back to CLI menu."
show_cli_menu
