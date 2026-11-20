# AGENTS.md — Trafficity Reverse Engineering Findings & Repo Guide

This file documents the observed architecture of **Trafficity** (Steam App ID `5185750`, Build `26770952`, release `trafficity@1.0.0+5a84bc8003`), all findings discovered while developing mods, what can be built with the exposed systems, and repository conventions for `trafficity-mod-manager`.

---

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
  - Detects Proton/Wine via `process.platform === "win32" && Boolean(process.env.WINEPREFIX || process.env.STEAM_COMPAT_DATA_PATH)`.
  - **Proton/Wine `shell.openPath` Gotcha:** Calling `shell.openPath(dir)` under Proton/Wine triggers Wine's *"There is no Windows program configured to open this type of file"* dialog. Always guard `shell.openPath` behind `!isWine`, focus native folder opening on real Windows, and return `{ ok: false, wine: true, modsDir, hostPath }` (mapping `C:\` via `WINEPREFIX` or `Z:\` to the Linux host path) so the UI displays a copyable path banner instead.
- **`electron/preload.js`:** Exposes `window.trafficityDesktop` via `contextBridge` (including `setCrashAnnotation` added in Build `26765575` using `crashReporter.addExtraParameter("trafficity-mem", ...)`).
- **`electron/static-server.js`:** Serves `dist/` and `src/dev-saves/` on `http://127.0.0.1:<freePort>` with strict isolation headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Resource-Policy: same-origin`
  - Existing APIs: `/api/dev-saves`, `/api/player-settings`, `/api/autosave-registry`, `/api/player-saves`, `/dev-saves/<id>.json`.
- **`player-saves/store.js`:** `getPlayerSavesDir()` resolves `AppData/Roaming/Trafficity/saves` (overrideable via `TRAFFICITY_SAVES_DIR`).
- **`dist/index.html`:** Uses `<script type="importmap">` (`"a1e1R"` points to the hashed `Router.*.js`, lazy-imported by `transit-city-game.*.js` via module `brWFf`).

---

## Deep Engine & DOM Findings (Discovered While Building Mods)

### 1. Toolbar & UI DOM Structure (`RoadsToolbar` / `GameMultiButton`)
- `GameButton` wraps `GameMultiButton` (`cyWuI`), rendering:
  ```html
  <div class="game-multi-button game-multi-button-size-large ..." data-tutorial-target="...">
    <button type="button" class="game-multi-button-option [game-multi-button-option-selected]">
      <div class="game-button-icon-square">...</div>
      <div class="game-button-badge">...</div>
    </button>
  </div>
  ```
- **Critical DOM Gotcha:** `data-tutorial-target` lives on the outer `.game-multi-button` `<div>` (which only has hover tooltip handlers), while the React `onClick` handler lives on the inner `<button class="game-multi-button-option">`. Clicking the wrapper does nothing; always resolve the inner `<button>`.
- Toolbelt slots live in `.road-toolbar-buttons-row`, separated by `.road-toolbar-buttons-divider`, with compact tools (`rectangle-delete`, `traffic-eraser`, undo) inside `.road-toolbar-compact-tools`.
- Exhausted/0-count building slots carry class `building-toolbar-button--exhausted` on their `.game-multi-button` wrapper (and `disabled` when `isDisabled` is true).
- Secondary tool property panels (Curve Mode, Elevation, Angle Snapping, Grid Density, Roundabout Size, Delete Shape) toggle visibility via `.road-toolbar-controls-panel--visible`.
- **Map vs. UI Layering:** `#pixi` (`position: absolute; inset: 0`) holds the PixiJS map canvas and sits beneath all React toolbars, tooltips, and dialogs. Appending a `<canvas>` (`pointer-events: none`) inside `#pixi` renders strictly above the map and strictly below all game UI.

### 2. World Constants, Coordinates & Camera (`bTgKI`, `7EBLK`)
- **Road & World Scale (`bTgKI`):**
  - `LANE_POINT_SPACING = 3` world units (smallest road sampling/stretch step).
  - `LANE_WIDTH = 20` world units.
  - `SIDEWALK_WIDTH = 3`, `MIN_JUNCTION_CHOP_DISTANCE = 20`, `MINIMUM_TURN_RADIUS = 30`.
  - Screen ↔ World transform: `screenX = worldX * cameraZoom + mapContainer.position.x`, `screenY = worldY * cameraZoom + mapContainer.position.y`.
- **Pointer & Camera Handlers (`7EBLK`):**
  - `e1(ev, gameState)` runs at the start of every mouse/wheel event (`mousemove`, `mousedown`, `mouseup`, `click`, `contextmenu`, `wheel`).
  - `e5` (`mousedown`) starts native camera panning when `ev.button === 1` (`t.isCameraPanning = true`, `t.cameraPanLastScreen = { x, y }`), and `e8` (`mouseup`) stops it on `ev.button === 1`. Dispatching synthetic middle-mouse events lets mods reuse native panning smoothly.
  - `e9` (`handleWheel`) zooms on every `wheel` event not inside `.ui-wheel-scroll`, ignoring `ev.ctrlKey`. Intercepting `wheel` with `{ passive: false, capture: true }` allows separating scroll-wheel tool cycling from `Ctrl+Wheel` zoom.
  - `e4` (`handleClick`) confirms 2-point road placement (`startPoint` → confirm) using `t.highlightedPoint` (updated by `mousemove`) and 3-point grid placement (`firstPoint` → `secondPoint` → confirm).
  - `eX` (`toggleCurveMode`) natively cycles `areaDeleteShape` in `rectangle delete` and `roundaboutSize` in `place roundabout`, but otherwise unconditionally toggles `roadPlacementMode` even when no road tool is selected (and does not handle `grid` density).

### 3. Input Matching & Keybindings (`a8scP`, `GAME_BINDINGS.md`)
- Trafficity matches keys via `e.key.toLowerCase() === token` (plus `e.code === "Digit" + token` for `0–9`), blocks actions when `ctrlKey` / `metaKey` / `altKey` is held (`hasBlockingModifier`), and tracks held keys in `gameState.keysPressed`.
- OS/driver-level remappers (e.g., Kanata) rewrite keystrokes before Electron sees them.
- Full keybinding list is documented in [`GAME_BINDINGS.md`](GAME_BINDINGS.md).

### 4. Undo Journal Architecture & TDZ Gotcha (`f5Ojv`, `duUfw`, `6l6Hv`)
- Player actions wrapped in `runRecordedPlayerAction` (`duUfw`) record `{ subRecords, moneyDelta }` entries into a per-`SaveState` `WeakMap` history (`getUndoHistory(saveState)`), capped at 20 entries.
- `confirm` sub-records store `createdLaneSections` (`{ id, links, coords }`, **without** `points`), `removedLaneSections` (with `points.withoutLocks()`), junctions, intersections, and `before`/`after` link diffs.
- Replaying Redo via `applyUndoSubRecord` requires snapshotting live `laneSections` (`live.points.withoutLocks()`), `junctions`, and `intersections` from `gameState.saveState` **before** `undoLastAction` deletes them.
- `undoLastPlayerAction` (`eQ`) plays `"placeRoad"` SFX (`lVhdV.playUiSfx`) **outside** `undoLastAction`; direct calls to `applyUndoSubRecord` must call `playSfx("placeRoad")` explicitly.
- **Parcel TDZ Gotcha:** Parcel hoists `Object.defineProperty(exports, "undoLastAction", { get: () => fn })` at the top of `f5Ojv` before `let fn = ...` at the bottom. Any event dispatched synchronously at the top of `f5Ojv` will throw `ReferenceError` if listeners read `exports.undoLastAction`. Always defer with `queueMicrotask(...)`.

### 5. Roundabout / Autoconnect Snap Lag Root Cause (`aYVZj`, `hkRbw`, `cbJhu`)
- `getNearestLaneCreationPoint` (`aYVZj`) runs every Pixi ticker frame with no memoization across unchanged frames.
- Inside `aYVZj`, when hovering a `"midpoint"` fails `ef` (`!action.exists || draftJunctionsOverlapAdjacentOnSameLane`), helper `em` searches **30 points backward and 30 points forward**, invoking full `getRoadConstructionAction` (arc generation + junction geometry + `getConstructionOverlaps` + glue recovery) **up to 61 times in a single animation frame**, plus per-frame `console.log("junction midpoint snap", ...)` in `ea`.
- Bounding/striding `em` (e.g., `maxSteps = 5, stride = 3`) + memoizing `getNearestLaneCreationPoint` by quantized world coords, `worldRevision`, road def, elevation, placement mode, angle snap, shift state, and `startPoint` eliminates the frame drops.

### 6. Parcel Update History & Resilience
- **Build `26757030` (`a7671b7e7a`):** Added `computeAreaDeletionCrossableRefund` (`bTgKI`), junction passing-path loop checks (`8Wq5B`), lane token frontage/congestion split (`5pxKp`, `aFL2A`), and renamed `f5Ojv`'s `undoLastAction` alias `k` → `T`.
- **Build `26765575` (`b15972261c`):** Added buildings facing/interacting with junction mouths (`5Maft`, `Ql8Cr`, `803W5`, `d1gNk`, `ipWDw`, `hBiFw`, `6l6Hv`), `placement.road.trafficLightsInFrontOfBuilding` (`1gskn` / `4aR6e`), and renderer Crashpad memory annotations (`preload.js` `setCrashAnnotation`, `lDHat`).
- **Build `26770952` (`5a84bc8003`):** Added `electron/renderer-freeze-watch.js` (unresponsive/GPU frame-stall watch with synchronous Steam overlay fallback via `store.js` `disableSteamOverlaySettingSync` and a 2 s rAF probe in `preload.js`) and glue-along/road-split module `aebgq` (`Router.cd259386.js`). All 9/9 hardened regex hooks passed with zero code changes.
- **Build `34b3cf6d3f` (`trafficity@1.0.0+34b3cf6d3f`, `Router.89d029ab.js`):** Added `electron/steam-overlay-gpu-fallback.js` (Steam overlay `--in-process-gpu` WARP fallback when ANGLE/D3D11 init fails, preventing loading-screen WebGL hangs). All 9/9 hardened regex hooks passed with zero code changes.
- **Build `6969441617` (`trafficity@1.0.0+6969441617`, `Router.8fc9524d.js`):** Updated simulation/pathfinding/keep-clear modules (`23yKB`, `3ma0f`, `ipWDw`, `jr3rt`, `32ZRr`, `fldJX`, `3rH81`, `1Lwfl`, `kPe38`, `4rdeQ`, workers `car-worker.28a3b082.js`, `happiness-worker.c64b5b7b.js`, `pathfinding-worker.b3556765.js`) and added `8Cnjy` (`createResidentCar`) + `j3N6S` (`logTrafficEraserSend`, `getRecentTrafficEraserSends`). All 9/9 hardened regex hooks and all loader/worker Parcel module IDs passed with zero code changes.
- **Rule:** Never hardcode single-letter minified variable names in `patchRouterSource`. Use regex captures (`$1`, `$2`, ...) and run `verifyRouterHooks` after patching so missing hooks fail fast on future game updates.

---

## What Can Be Built With Everything Exposed

1. **Custom Controls, Hotkeys & Pointer Workflows:** Capture-phase keyboard/mouse/wheel hooks (`bindKey`, `onMouse`), toolbelt slot selection & wheel cycling, context-aware property toggles, synthetic pan/drag/click workflows, and mouse side-button actions.
2. **World-Space Visual Overlays & Measuring Tools:** `<canvas>` overlays mounted inside `#pixi` synced 1:1 with `game.getCameraState()` (`mapContainer.position`, `cameraZoom`) and calibrated to `LANE_POINT_SPACING` (`3u`) and `LANE_WIDTH` (`20u`), plus custom HUD widgets via `addOverlay`.
3. **Custom Snapping & Placement Helpers:** Wrapping `game.getSnapApi().snapModule.getNearestLaneCreationPoint` to add grid snapping, custom snap filters, or performance memoization/throttling.
4. **Undo/Redo & State-Mutation Tools:** Wrapping `game.getUndoApi().undoModule` (`undoLastAction` / `applyUndoSubRecord`) and reading `gameState.saveState` (`laneSections`, `junctions`, `intersections`, `buildings`, `money`, `worldRevision`).
5. **Audio & UI Feedback Mods:** Triggering native UI SFX (`"click"`, `"placeRoad"`, `"placeBuilding"`, `"buildingRowCount"`, `"cityLevelUnlockReady"`) via `game.playSfx(name)`, injecting CSS stylesheets (`mod.json` `styles`), and annotating toolbar buttons with badges/hints.
6. **Modular / Shared Library Mods:** Composing multi-mod ecosystems using `dependencies` / `optionalDependencies` topological load ordering, `TrafficityMods.provide(name, api)` / `use(name)`, `TrafficityMods.extendGame(methods)`, and arbitrary Parcel module access via `game.requireRouterModule(id)`.
7. **Save & Scenario Mods:** Leveraging Trafficity's plain-JSON dev-saves and local HTTP APIs (`/api/dev-saves`, `/api/player-saves`, `/api/mods/config`) alongside per-mod persisted configs (`getConfig` / `setConfig`).

---

## Repo Architecture & Conventions

- **`src/patch.mjs`:** Idempotent ASAR patcher (`npm run patch` / `npm run restore`). Always calls `asar.uncache(asarPath)` before extracting and after repacking/restoring, writes to `${asarPath}.tmp` before renaming, cleans up `${tempAsar}.unpacked`, refreshes `app.asar.bak` whenever patching an unpatched stock `app.asar`, copies `src/mod-api.cjs`, `src/toml.cjs`, and `runtime/loader.js`, and verifies all `REQUIRED_ROUTER_HOOKS` via `verifyRouterHooks`.
- **`src/mod-api.cjs` & `src/toml.cjs`:** Resolves `mods/` next to `saves/` (`AppData/Roaming/Trafficity/mods` or `TRAFFICITY_MODS_DIR`), reads/writes per-mod `settings.toml` (falling back to `mods-config.json`), exposes `gameRelease`, `forkedFrom`/`lineage`, and sets COOP/COEP/CORP isolation headers on every response.
- **`src/registry.mjs`, `src/mod-tools.mjs`, & `src/health.mjs`:** Pure-Node ZIP installer/packager, `registry.json` fetcher with local fallback, mod scaffolding (`scaffoldMod`), forking (`forkMod` with `forkedFrom`/`lineage`), `.tmod-origin.json` unedited-mod hash tracking, LSP workspace type provisioning (`jsconfig.json` + `.tmod-types/trafficity-mods.d.ts`), and environment/mod health check (`npm run health`).
- **`runtime/loader.js` & `types/trafficity-mods.d.ts`:** Loaded synchronously before `/transit-city-game.*.js`, resolves dependencies topologically, loads mods sequentially via `await import(...)` (invoking `export default` when present), exposes `window.TrafficityMods` (`buildings.register` / `CustomBuilding` for main-thread + worker custom buildings, `game.on(...)`, `worldToScreen` / `screenToWorld` / `configureSnapSearch`), isolates overlay pointer events, and mounts the `F9` Mod Manager UI with inline `settings.toml` controls.
- **`docs/api.html` & `MODDING.md`:** Standalone HTML API reference (no emojis, no external dependencies) and mod-authoring guide.
- **Tests:** Run `npm test` (`tsc -p jsconfig.json --noEmit` + `node --test test/*.test.mjs examples/*/*.test.mjs`) and `npm run test:ui` (`./bin/trafficity-mod-manager --self-test`).
- **Game Keybindings Reference:** See [`GAME_BINDINGS.md`](GAME_BINDINGS.md).
