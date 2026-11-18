# AGENTS.md — Trafficity Reverse Engineering Findings & Repo Guide

This file documents the observed architecture of **Trafficity** (Steam App ID `5185750`, Build `26743311`) and how `trafficity-mod-manager` integrates with it.

## Target Game Findings (`Trafficity`)

- **Install Directory:** `~/.local/share/Steam/steamapps/common/Trafficity`
- **Packaging:** Windows x64 Electron PE (`Trafficity.exe`), application bundle in `resources/app.asar`, and unpacked native addon in `resources/app.asar.unpacked/node_modules/steamworks.js` (`steam_api64.dll`, `steamworksjs.win32-x64-msvc.node`).

### Electron Fuses (`Trafficity.exe`)
- `EnableEmbeddedAsarIntegrityValidation`: **disabled** (`not_enforced`) — `app.asar` can be modified and repacked without hash mismatches.
- `OnlyLoadAppFromAsar`: **disabled** (`not_restricted_to_app_asar`).
- `RunAsNode`: **enabled**
- `EnableNodeOptionsEnvironmentVariable`: **enabled**
- `EnableNodeCliInspectArguments`: **enabled**
- `GrantFileProtocolExtraPrivileges`: **enabled**
- `WasmTrapHandlers`: **enabled**

### Tech Stack (`package.json` & `app.asar`)
- **Bundler:** Parcel (`@parcel/bundler-default`, `sourceMap: false` for `default` target; hashed assets under `dist/`).
- **UI:** React 19 (`^19.1.0`), `chart.js` (`^4.5.1`), `react-chartjs-2` (`^5.3.1`).
- **Renderer & Audio:** PixiJS v8 (`^8.9.1`, separate `WebGLRenderer` and `WebGPURenderer` bundles), `@pixi/sound` (`^6.0.1`).
- **Simulation & Geometry:** `clipper2-ts` (`^2.0.1-18`), `polygon-clipping` (`^0.15.7`), `delaunator` (`^5.0.1`), `simplex-noise` (`^4.0.3`), `seedrandom` (`^3.0.5`), plus Web Workers (`car-worker`, `happiness-worker`, `pathfinding-worker`, `webworkerAll`).
- **Desktop / Steam / Telemetry:** `steamworks.js` (`^0.4.0`), `@sentry/browser` (`^10.78.0`).

### Electron Runtime & Server Details
- **`electron/main.js`:**
  - `BrowserWindow` uses `contextIsolation: true` and `nodeIntegration: false`.
  - `getDevUrl()` checks `--url=<url>` or `ELECTRON_START_URL` to load an external frontend URL (also skips `app.requestSingleInstanceLock()`).
  - Built-in DevTools shortcut: `Ctrl+Shift+J` pressed **5 times** consecutively within 1500 ms per press (`DEVTOOLS_PRESS_COUNT = 5`, `DEVTOOLS_PRESS_WINDOW_MS = 1500`).
  - Includes a Proton/Wine detection check (`WINEPREFIX || STEAM_COMPAT_DATA_PATH`) for audio sandbox compatibility.
  - **Proton/Wine `shell.openPath` Gotcha:** Trafficity ships as a Windows PE (`process.platform === "win32"`), so on Linux via Proton/Wine, calling `shell.openPath(dir)` triggers Wine's *"There is no Windows program configured to open this type of file"* error. Always guard `shell.openPath` behind `!isWine`, focus native folder opening on real Windows, and return `{ ok: false, wine: true, modsDir, hostPath }` (mapping `C:\` via `WINEPREFIX` or `Z:\` to the Linux host path) so the UI can display a copyable path banner instead.
- **`electron/preload.js`:** Exposes `window.trafficityDesktop` via `contextBridge`.
- **`electron/static-server.js`:** Serves `dist/` and `src/dev-saves/` on `http://127.0.0.1:<freePort>` with strict isolation headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Resource-Policy: same-origin`
  - Existing APIs: `/api/dev-saves`, `/api/player-settings`, `/api/autosave-registry`, `/api/player-saves`, `/dev-saves/<id>.json`.
- **`player-saves/store.js`:** `getPlayerSavesDir()` resolves `AppData/Roaming/Trafficity/saves` (overrideable via `TRAFFICITY_SAVES_DIR`).
- **`dist/index.html`:** Uses `<script type="importmap">` and loads `<script type="module" src="/transit-city-game.28c230a9.js"></script>`.

---

## Repo Architecture & Conventions

- **`src/patch.mjs`:**
  - Extracts `app.asar`, injects `electron/mod-api.cjs` and `electron/mod-loader.js`, patches `electron/static-server.js`, `electron/preload.js`, `electron/main.js`, and `dist/index.html`, and repacks with `unpackDir: "node_modules/steamworks.js"`.
  - **ASAR Cache Gotcha:** `@electron/asar` caches ASAR headers in memory per path. Always call `asar.uncache(asarPath)` before extracting and after repacking/restoring, and write to `${asarPath}.tmp` before renaming.
  - Patch functions must remain idempotent (`/* TRAFFICITY_MOD_MANAGER_PATCH */`).
- **`src/mod-api.cjs`:**
  - Stores mods in `path.join(path.dirname(await getPlayerSavesDir()), "mods")` (or `TRAFFICITY_MODS_DIR`) and state in `mods-config.json` alongside `saves/`.
  - All `/mods-runtime/*` and `/api/mods*` responses **must** include the COOP/COEP/CORP isolation headers or Chromium will block them.
- **`runtime/loader.js`:**
  - Loaded via a synchronous `<script src="/mods-runtime/loader.js"></script>` **before** `/transit-city-game.*.js` so `window.TrafficityMods` and capture-phase key/mouse interceptors are active before the game registers its listeners.
  - Provides the `F9` / bottom-right `Mods` drawer UI.
- **Tests:** Run `npm test` (`node --test test/*.test.mjs`) after any change.
- **Game Keybindings Reference:** See [`GAME_BINDINGS.md`](GAME_BINDINGS.md) for the exact `KEY_BINDING_ACTIONS`, `DEFAULT_KEY_BINDINGS`, hardcoded keys, and `event.key.toLowerCase()` matching logic extracted from `dist/Router.520f1c86.js`.
