# Trafficity Mod Manager

Lightweight Mod Manager, pre-bundle Mod Loader, extensible `TrafficityMods.game` API facade, `app.asar` patcher, and compiled Qt6 Quick desktop UI for **Trafficity** (Steam App ID `5185750`). Works on both Windows and Linux (Steam Proton / Wine).

## Features

- **In-Game Mod Manager (`F9`):** Toggle mods on/off, inspect missing dependencies, open or copy the mods folder path, and reload the game without restarting Steam.
- **Compiled Qt6 Quick Desktop UI (`ui/`):** Native desktop companion app to check patch status, patch/restore `app.asar`, install example mods, toggle mods, open the mods folder natively on Windows or Linux, and open the HTML API documentation.
- **Steam-Update Resilient:** Mods and `mods-config.json` live in `AppData/Roaming/Trafficity/` (next to player saves). After a Steam game update, re-run `npm run patch` (or click **Patch Game** in the QtQuick UI) to re-apply hooks cleanly.
- **Extensible `TrafficityMods.game` Facade & Dependency System:** Supports `dependencies` / `optionalDependencies` topological loading, `provide`/`use` inter-mod services, `extendGame`, and full HTML API documentation in [`docs/api.html`](docs/api.html).

## Desktop UI

Run the pre-compiled Qt6 Quick desktop UI directly (no compilation required):

```bash
npm install
./bin/trafficity-mod-manager
```

Or via npm:

```bash
npm run app
```

From the UI you can check game status, patch or restore `app.asar`, install the example mods, toggle mods on/off, open the mods folder natively, and open `docs/api.html`.

## Quick Start (CLI)

```bash
npm install
npm run patch
```

Other CLI commands:

```bash
npm run status                         # Inspect game detection, release, and hook status (JSON)
npm run restore                        # Revert resources/app.asar from app.asar.bak
npm test                               # Run patcher, mod-api, loader, and all example mod tests
node src/patch.mjs --game-dir <path>   # Override auto-detected Steam install directory
```

Environment variable overrides:
- `TRAFFICITY_GAME_DIR`: Custom path to the Trafficity installation directory.
- `TRAFFICITY_MODS_DIR`: Custom path to the mods directory.

## Included Example Mods (`examples/`)

- **`toolbelt-hotkeys-mod`:** Numbered `1`–`9`/`0` toolbelt slot badges and hotkeys, mouse wheel tool cycling (skipping 0-available/exhausted items) + `Ctrl+Scroll` zoom, `Alt+1`/`2`/`3` speed controls, `Q` deletion toggle + `Shift+Del` traffic eraser, context-aware `E` property shift (curve mode / grid density with idle guard), idle right-click hold camera pan, `Shift+Right-Click` rectangle delete, left-click drag-and-drop placement, and Mouse Back/Forward Undo & Redo.
- **`redo-mod`:** Standalone Redo stack hooking Trafficity's undo journal with `"placeRoad"` SFX, `Ctrl+Y` / `Ctrl+Shift+Z`, and `"redo"` service registration.
- **`snap-perf-fix-mod`:** Memoizes per-frame road snap queries and bounds the 60-step midpoint overlap loop to eliminate roundabout/autoconnect placement lag.
- **`measuring-grid-mod`:** Togglable world measuring grid (`Alt+G`) calibrated to road step spacing (`3u`) and lane width (`20u`), adjustable granularity (`[` / `]`), and optional road-point grid snapping (`Alt+S`).
- **`arrow-pan-mod`:** Minimal example mod using `TrafficityMods.game.cancel()`.

## Mod Format & API Documentation

Create a folder inside `mods/` containing a `mod.json` manifest and an optional ES module `mod.js` and CSS files:

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "author": "You",
  "description": "What this mod does.",
  "dependencies": [],
  "optionalDependencies": ["redo-mod"],
  "entry": "mod.js",
  "styles": ["style.css"]
}
```

- **Full API Reference:** Open [`docs/api.html`](docs/api.html) in a browser (or click **API Docs** in the QtQuick UI).
- **Per-Mod Unit Testing:** Every mod folder can include a zero-dependency `mod.test.mjs` runnable directly inside its folder:
  ```bash
  cd examples/toolbelt-hotkeys-mod
  node --test
  ```
- **Additional Docs:** [`GAME_BINDINGS.md`](GAME_BINDINGS.md), [`ROADMAP.md`](ROADMAP.md), and [`AGENTS.md`](AGENTS.md).
