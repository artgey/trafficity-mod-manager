# Trafficity Mod Manager — Module Map & API Roadmap

> **Target Game Build:** `trafficity@1.0.0+6969441617` (`dist/Router.8fc9524d.js` — 906 total Parcel modules: ~340 Trafficity domain modules, 42 importmap asset modules, and ~524 vendor/PixiJS/React/Chart.js/Sentry modules; plus `dist/transit-city-game.225ce3d0.js` and 3 isolated Web Workers).

This document maps **every functional subsystem in Trafficity**, tracks **how much is currently exposed by `TrafficityMods`** (`runtime/loader.js`, `src/patch.mjs`, `src/mod-api.cjs`), and outlines the **prioritized roadmap** so new mods can interact cleanly with every part of the game.

---

## 1. Subsystem Coverage Summary

| Domain | Approx. Game Modules | Current `TrafficityMods` Coverage | KB / Research Status | Status |
| :--- | :---: | :--- | :--- | :--- |
| **Core, Camera, Input & Undo** | 8+ | `bindKey`, `onMouse`, `sendSynthetic*`, `getCameraState`, `worldToScreen`, `screenToWorld`, `getUndoApi`, `undo`, `cancel`, `game.on` | Verified | **Mapped** |
| **Buildings, Extrusions & Placement** | 86 | `mods.buildings` (`CustomBuilding`, `register`, `get`, `list`) + 3-worker sync | [`01-buildings-internals.md`](modding-kb.tmp/01-buildings-internals.md), [`02-custom-building-prototype.mjs`](modding-kb.tmp/02-custom-building-prototype.mjs) | **Mapped** *(sprites in KB)* |
| **Roads, Lanes, Junctions & Snapping** | 94 | `getSnapApi`, `configureSnapSearch`, `getConstants`, `on("roadPlaced")` | Snap & undo verified | **Partial** |
| **Vehicles, Pathfinding & Traffic Sim** | 36 | `setSpeed`, worker script hook (buildings only) | Worker structure verified | **Partial** |
| **Economy, Resources, Pollution & Happiness** | 26 | Raw `requireRouterModule` only (`5x7Vi`, `d9GJQ` used in `eco-scrubber-mod`) | Pollution/happiness verified | **Unmapped** |
| **Terrain, Map, Tiles & Shadows** | 26 | None (raw `requireRouterModule` only) | Terrain enum (`lz5kL`) verified | **Unmapped** |
| **Progression, Level-Up, Saves & Settings** | 22 | `getConfig` / `setConfig` (mod settings only) | [`04-levelup-progression-internals.md`](modding-kb.tmp/04-levelup-progression-internals.md) | **Researched** |
| **UI, Menus, Toolbars, Theme & i18n** | 37 | `addOverlay`, `watchToolbelt`, `pressButton`, `selectToolbeltSlot`, `cycleToolbeltSlot`, `addButtonHint`, `mod.json` `styles` | `aUbb1` / `9nNmt` verified | **Partial** |
| **Audio, Music, SFX & Asset/File Injection** | 21 + 42 assets | `game.playSfx`, `/mods-runtime/mods/<folder>/<file>` HTTP serving | [`03-asset-file-injection-internals.md`](modding-kb.tmp/03-asset-file-injection-internals.md) | **Partial / Researched** |

---

## 2. Complete Game Module Map & Current API Coverage

### A. Core, Router, Camera, Input & Undo
- **Key Modules:**
  - `4ZnLW` (`Router`), `4j4D5` (main game canvas/controller), `7EBLK` (input handlers, `undoLastPlayerAction`), `6l6Hv` (world interaction controller)
  - `cghJ1` (`CAMERA_ZOOM_FACTOR`, `CAMERA_MAX_ZOOM`, `clampCameraZoom`), `3eSgq` (`getCameraWorldCenter`)
  - `f5Ojv` (`undoLastAction`, `applyUndoSubRecord`, `validateUndoSubRecord`), `duUfw` (`getUndoHistory`, `runRecordedPlayerAction`)
  - `a8scP` (keybinding matching), `d3K9J` (default world state)
- **Mapped in `TrafficityMods`:**
  - `mods.bindKey`, `mods.onMouse`, `mods.sendSyntheticKey`, `game.sendSyntheticMouse`, `game.sendSyntheticWheel`
  - `game.getCameraState`, `game.worldToScreen`, `game.screenToWorld`
  - `game.undo`, `game.cancel`, `game.getUndoApi`, `game.on("ready" | "cursorModeChange" | "worldChange" | "roadPlaced")`
- **Gaps:** No `setCameraState(x, y, zoom)` helper or custom undo sub-record registration helper.

### B. Buildings, Extrusions, Placement & Footprints
- **Key Modules:**
  - Definitions & tables: `4nkf2` (`BUILDING_DEFINITIONS`, `getBuildingDefinition`), `aUbb1` (`buildingDisplayName`), `fFJcz` (`getBuildingCarCountSpec`), `jnB0a` (`buildingHasGetVisitedNeed`), `2cbpn` (`getSatisfactionWeightForBuildingType`)
  - Placement, deletion & repair: `6whda` (`placeBuildingAtFootprint`, `placeBuildingsFromFootprints`, `restoreBuildingsAtFootprints`), `gh1Od` (`deleteBuildingsFromGameState`), `d3foG` (`findNearestBuildingFootprint`), `dDLDP` (`updateDraftBuildingPreview`), `arlJO` (terrain rules), `cCmiT` (footprint overlap), `zDrFY` (lane clearance), `2ICyP` (locked tiles), `bE4CP` (`BuildingCellTracker`)
  - Rendering & UI: `XfMqf` (`createBuildingGraphicsParts`, `updateBuildingGraphics`, `applyBuildingDisplayColors`), `bRLNG` (`addBuildingExtrusion`), `k7FBV` (`projectBuildingCoordinate`), `9ccnm`, `2OGVI` (`getBuildingParkingSpaceRunGraphics`), `iPOHp` (`BuildingPreview`, `prebakeAllBuildingPreviewIcons`), `eAKuV` (`BuildingTypeTooltip`), `aelWA` (`BuildingViewPanel`), `jgEEo` / `kvRvT` (toolbar rows & quotas)
  - Road/garage interaction: `803W5`, `5Maft`, `Ql8Cr`, `hBiFw`, `d1gNk`
  - Workers: `aS4Aq`, `6hect`, `3baQI` (in `car-worker`, `happiness-worker`, `pathfinding-worker`)
- **Mapped in `TrafficityMods`:**
  - `mods.buildings.CustomBuilding`, `mods.buildings.register`, `mods.buildings.get`, `mods.buildings.list`
  - Worker `window.Worker` synchronous Blob injection
- **Gaps:** `spriteUrl` (2D PNG/SVG sprites in world + toolbar `BuildingPreview`) is prototyped in `modding-kb.tmp/02-custom-building-prototype.mjs` and ready to promote into `runtime/loader.js`.

### C. Roads, Lanes, Junctions, Intersections, Roundabouts & Snapping
- **Key Modules:**
  - Constants & geometry: `bTgKI` (`LANE_WIDTH`, `LANE_POINT_SPACING`), `CRTJF` (`maxLanePointElevation`, `LaneGraphicsLayerGroup`, road colors), `9F4Ss` (`getSnappedRoundaboutCenter`)
  - Snapping & construction: `aYVZj` (`getNearestLaneCreationPoint`), `hkRbw`, `cbJhu`, `1Pjot`, `E71eU` (`createGlueAlongPath`), `8j00L`, `1Qwza`, `admPE`, `6NtaA` (`getGridConstructionAction`), `8lnVn` & `dYbIg` (roundabouts), `eVmnQ` & `g23BU` (deletion), `1gskn` (blocked tooltips)
  - Junctions, traffic lights & keep-clear: `gm1Xv` (intersection/junction graphics & traffic light circles), `jr3rt` (keep-clear memberships), `3KOJY` (protected turns), `hh89e` (crossable locks)
- **Mapped in `TrafficityMods`:**
  - `game.getConstants`, `game.getSnapApi`, `game.configureSnapSearch`, `game.on("roadPlaced")`
- **Gaps:** No high-level road/roundabout/traffic-light/keep-clear inspection or programmatic placement API.

### D. Vehicles, Pathfinding, Workers & Traffic Simulation
- **Key Modules:**
  - Simulation & speed: `4rdeQ` (`setSimSpeed`, `getSimDeltaMS`), `kPe38` (`MAX_CARS`, worker counts), `gy5Fo` (`stepTrafficFlow`, `createLaneSectionJamCountState`), `23yKB` (lock/yield/deadlock constants), `jwrek` (`generateCarDrivingProperties`)
  - Residents & vehicles: `1Lwfl` (`ParallelResidentMetadata`), `8Cnjy` (`createResidentCar`), `hVdEj` & `84pTe` (`attachResidentCarGraphics`, `CAR_COLORS`), `fxu6p` (`selectResidentCar`), `cQ3IH` (`ResidentViewPanel`), `9JYQM` (`purgeResidentCarOnMainThread`)
  - Pathfinding & workers: `ipWDw` (`ParallelPathingManager`), `cTLaq` (route neighbor & destination picking), `fldJX` (`requestPickDest`, `requestPlanJourney`), `liTNI` (`fastPlanJourney`), `2D2V6` (`toWorkerBuilding`), `j3N6S` (`logTrafficEraserSend`), `8GfQx` (`shouldHoldErasedStationaryCars`), `1S1mt` (`TeleportHomeReason`)
- **Mapped in `TrafficityMods`:** `game.setSpeed`, plus building-only worker injection.
- **Gaps:** No `mods.traffic` API (live traffic flow stats, active car counts, vehicle color/speed hooks, or custom worker message hooks).

### E. Economy, Resources, Pollution, Noise & Happiness
- **Key Modules:**
  - Resources & pollution: `90RkR` (`RESOURCE_DEFINITIONS`), `5x7Vi` (`updatePollutionFromBuildings`), `d9GJQ` (`POLLUTION_CELL_SIZE`, `ParallelPollutionGrid`), `gs8fX` (`updatePollutionDiffusion`)
  - Happiness & noise: `cp1Ub` (`getAirQualityHappinessAtMapPoint`, `getQuietnessHappinessAtMapPoint`), `aZtm6` (`updateBuildingHappinessValues`), `iPSQw` (`ParallelBuildingHappinessMetadata`), `5JbRC` (`getOverallHappinessForBuilding`), `9XAt9` (happiness colors), `2wonA` & `7pCNV` (visitor/goods gaps), `csV9W` & `dDz4x` (activity & journey traces), `9M4sb` (journey targets/penalties)
- **Mapped in `TrafficityMods`:** None (mods currently call `requireRouterModule` directly).
- **Gaps:** No `mods.environment` / `mods.economy` API (money/budget helpers, pollution grid read/write, overall city happiness/traffic flow getters).

### F. Terrain, Map, Tiles & Shadows
- **Key Modules:**
  - `lz5kL` (`TERRAIN_DEFINITIONS`), `70dcm` (`getTerrainTopTypeAtMapPoint`, `sampleMapPointHitsTerrainObstacle`), `luPLz` & `fivhC` (`bakeTerrainTopTypeGrid`), `cq0UX` (terrain colors), `eesgK` / `bXGpV` / `50ACd` (map generation), `akRnM` & `pQySL` (mountain shadows), `5clv5` (`TileUnlockMarkers`), `idtaX` & `3HSjl` (tile unlock camera)
- **Mapped in `TrafficityMods`:** None.
- **Gaps:** No terrain query (`getTerrainAt(x, y)`) or tile-unlock helper.

### G. Progression, Objectives, Saves, Settings & Achievements
- **Key Modules:**
  - Level-up & packs: `aigC5` (`setPendingDevelopmentPackUnlockIfEligible`, `claimPendingDevelopmentPackUnlock`, `getTileUnlocksForPack`), `a3oY4` (`SCENARIOS`, `developmentPackGetter`), `9colC` (`DIFFICULTY_MODES`, `getUnlockMetricThresholdPercent`, `scaleBudgetForDifficulty`), `lAjA8` (`DevelopmentPackProgress`), `bCcpU` (`TopRightCityLevelObjectives`), `eItav` (`DevelopmentPackUnlockDialog`)
  - Tutorials, saves & settings: `2FxNM` & `1KHqu` (tutorials), `8GfQx` & `2yd5D` (`SaveGameBrowser`), `fifBi` & `a1sFD` (`getAppSettings`, `useAppSettings`), `4P6kg` (`SettingsPanel`), `8ULsK` (`KeyBindingsPanel`), `ivZgo` (`installSteamAchievementSync`)
- **Mapped in `TrafficityMods`:** `mods.getConfig` / `mods.setConfig` (mod settings only).
- **Gaps:** No `game.on("levelUpReady" | "levelUp")` events, pack/quota modifiers, or custom dev-save registration.

### H. UI, Menus, Overlays, Toolbars, Theme & Localization
- **Key Modules:**
  - Pages & menus: `gCciw` (`MainMenu`), `cfSCH` (`NewGamePage`), `aCVng` (`LoadGamePage`), `7R9Wv` (`SettingsPage`), `5lkDk` (`CreditsPage`), `30GNH` (`GameMenuOverlay`), `cnx0j` (`GameDialog`), `5kNWc` (`MenuConfirmDialog`)
  - HUD & overlays: `8BQf7` (`TopLeftOverlaysControl`), `lpoYr` (`TopRightMoneyDisplay`), `2VO6n` (`TopRightPauseControl`), `2j6ba` (`TopRightFpsDisplay`), `hDWaT` (`MouseTooltip`), `8HdpY` (`UnlockNotificationPanel`)
  - Theme & i18n (including `transit-city-game.225ce3d0.js`): `dD8nW` (dark mode & accent colors), `h6eat` (`rebuildWorldForVisualTheme`), `9nNmt` (`t`), `4aR6e` (`LOCALISATION_STRINGS`), `d9Mr8` (9 languages), `acw62` (React), `ayMG0` (JSX)
- **Mapped in `TrafficityMods`:** `addOverlay`, `watchToolbelt`, `pressButton`, `isButtonSelected`, `getToolbeltSlots`, `selectToolbeltSlot`, `cycleToolbeltSlot`, `addButtonHint`, `mod.json` `styles`.
- **Gaps:** No UI zoom/scale helper, dark-mode/accessibility subscription, i18n string registration, or native in-game menu/dialog hook.

### I. Audio, Music, SFX & Asset/File Injection
- **Key Modules:**
  - `lVhdV` (`playUiSfx`), `1GCZp` (`loadSound`), `8thuK` (`@pixi/sound`), `bvBVk` (`StereoFilter`), `qIEGF` & `1OD7p` (`createAmbientNoiseAudioController`), `1JlYf` (`createGameMusicController`), `gNrZw` (`attachMenuUiClickSfx`)
  - Mod-manager HTTP layer: `src/mod-api.cjs` (`/mods-runtime/mods/<idOrFolder>/<file>`), `electron/static-server.js`
- **Mapped in `TrafficityMods`:** `game.playSfx(name)` + static mod file serving.
- **Gaps:** Missing MIME types in `src/mod-api.cjs` (`.mp4`, `.woff`, `.woff2`, `.jpg`, `.jpeg`, `.gif`), no `mods.getAssetUrl()`, no `assetOverrides` in `mod.json`, and no `mods.audio` helper for custom SFX/music/ambient replacement.

---

## 3. Prioritized Modloader Roadmap

### Phase 1 — Asset, Image & Audio Injection (`v1.5.x`)
1. **HTTP Asset Overrides & MIME Completeness (`src/mod-api.cjs`):**
   - Add `.mp4`, `.webm`, `.woff`, `.woff2`, `.jpg`, `.jpeg`, `.gif`, `.wasm` to `MIME_TYPES`.
   - Support declarative `"assetOverrides"` in `mod.json` (served before `/dev-saves/` and `/dist/`) to replace game music, SFX, logos, fonts, tutorial videos, or inject custom dev-saves without touching `app.asar`.
2. **Loader Asset & Sprite Helpers (`runtime/loader.js`):**
   - Add `mods.getAssetUrl(modId, relativePath)` and optional `"preload"` scripts running before `Router` mounts initial music.
   - Promote `spriteUrl` / `spritePadding` / `spriteFlipY` from [`modding-kb.tmp/02-custom-building-prototype.mjs`](modding-kb.tmp/02-custom-building-prototype.mjs) into `TrafficityMods.buildings`.
3. **Audio Facade (`mods.audio`):**
   - Expose `registerSfx(id, url)`, `replaceUiSfx(name, url)`, `replaceAmbient(alias, url)`, and `playCustomSfx(id, volumeScale)` over `8thuK` + `fifBi`.

### Phase 2 — UI Zoom, Accessibility & Custom In-Game Menus (`v1.6.x`)
1. **Research & Map UI/Theme/Menu Internals:**
   - Dissect `dD8nW`, `h6eat`, `30GNH` (`GameMenuOverlay`), `cnx0j` (`GameDialog`), `Router.4cebc423.css`, and `transit-city-game.b32ffa77.css` into `modding-kb.tmp/`.
2. **Accessibility & Theme APIs (`mods.ui`):**
   - `setUiScale(factor)` / font-weight / high-contrast / dark-mode theme hooks (`onThemeChange`, `isDarkMode()`).
   - `registerMenuEntry` / `openModal` helpers that properly set `isModalDialogOpen` / block world pointer bleed.
   - `mods.i18n.addStrings(lang, map)` injecting into `4aR6e.LOCALISATION_STRINGS`.

### Phase 3 — Progression, Economy & Environment APIs (`v1.7.x`)
1. **Level-Up Events & Modifiers (`mods.progression`):**
   - Expose `game.on("levelUpReady", ...)` and `game.on("levelUp", ...)` wrapping `aigC5`.
   - Helpers to read/modify `money`, `tileUnlockCount`, `cumulativeBuildingCount`, and `SCENARIOS` pack rewards.
2. **Environment & Simulation Metrics (`mods.environment`):**
   - Clean read/write helpers for `pollutionGrid` (`d9GJQ`, `5x7Vi`), `carNoiseGrid`, building happiness (`iPSQw`), and live `trafficFlow` / `totalSatisfaction`.

### Phase 4 — Roads, Traffic & Terrain APIs (`v1.8.x`)
1. **Terrain Queries (`mods.terrain`):** `getTerrainAt(worldX, worldY)` via `70dcm`.
2. **Traffic & Simulation Controls (`mods.traffic`):** Read live car counts/congestion (`gy5Fo`, `1Lwfl`), hook car colors/speeds (`jwrek`, `84pTe`), and inspect/purge vehicles.
3. **Road & Junction Helpers (`mods.roads`):** Read-only inspection of `laneSections`, `junctions`, `intersections`, and helper wrappers for common road/traffic-light queries.

---

## 4. Developer Quality & Audit Roadmap

Engineering quality audits to harden the patcher, runtime loader, desktop companion app, and modding ecosystem:

- [x] **Developer Experience (DX) & Strict Type Enforcement Audit** *(Completed)*
  - Enabled `"checkJs": true` + `"strict": true` (`@types/node`) across `src/**/*.mjs`, `src/**/*.cjs`, `runtime/**/*.js`, `examples/**/*.js`, and `types/**/*.d.ts` with zero explicit `any`s.
  - Made `hookRoadSnap`, `hookRoadPlacement`, `hookRoundaboutPlacement`, and `addBuildingTooltipLine` multi-mod composable; added `game.getCursorState()`, unsubscribe handles, `Cache-Control: no-store`, starter `mod.test.mjs`, PR/release CI gates, and async Qt6 UI `QProcess` handlers.

- [ ] **1. Security & Trust-Boundary Audit**
  - **ZIP & Installer (`src/registry.mjs`, `src/mod-tools.mjs`):** Enforce uncompressed-size / zip-bomb limits in `extractZipBuffer`, guard symlink escapes, populate `sha256` hashes in `registry.json`, and review arbitrary-URL install prompts.
  - **Local HTTP Server (`src/mod-api.cjs`):** Validate `Origin`/`Host` headers on `POST /api/mods/toggle` & `/api/mods/config`, verify path-traversal edge cases, and audit `innerHTML` / XSS surfaces in the `F9` drawer (`runtime/loader.js`).
  - **Desktop App (`ui/Backend.cpp`):** Sanitize paths/URLs before `QDesktopServices::openUrl` and review `QProcess` argument handling.

- [ ] **2. Steam-Update Resilience & Fragility Audit**
  - Audit all 9 regex hooks in `src/patch.mjs`, all `ROUTER_MODULES` + `WORKER_MODULES` Parcel IDs in `runtime/loader.js`, and DOM selectors (`.road-toolbar-buttons-row`, `[data-tutorial-target]`, `#pixi`) for fail-fast vs. silent breakage on game updates.
  - Extend `verifyRouterHooks` / `npm run health` to verify `ROUTER_MODULES` and `WORKER_MODULES` existence against the live `app.asar`.

- [ ] **3. Runtime Performance & Memory Leak Audit**
  - **In-game loader & mods:** Revoke `URL.createObjectURL` blobs in `PatchedTrafficityWorker`, scope `watchToolbelt`'s `document.body` `MutationObserver`, skip redundant `measuring-grid` `requestAnimationFrame` redraws when the camera is stationary, and profile `eco-scrubber`'s per-cell diffusion loop.
  - **Qt6 UI:** Move `computeModCodeHash` off the GUI thread in `Backend::loadModsFromDisk()` and audit `QFileSystemWatcher` churn.

- [ ] **4. Cross-Platform & Failure-Mode Audit (Windows, Linux, Proton/Wine)**
  - Handle patching while Trafficity is running (locked `app.asar` on Windows), spaces/Unicode in Steam paths, corrupted/missing `app.asar.bak`, offline registry fallback, and mod load-error isolation so one broken mod cannot break others.

- [ ] **5. Over-Engineering, Duplication & Dead-Code Audit**
  - Deduplicate shared logic between C++ and JS (e.g., `computeModCodeHash` implemented in both `ui/Backend.cpp` and `src/registry.mjs`), prune unused exports/files, and reconcile doc-vs-feature drift (e.g., inline `settings.toml` controls in the `F9` drawer).

- [ ] **6. UI / UX & Feature-Parity Audit (`ui/Main.qml` & `F9` Drawer)**
  - Audit `ui/Main.qml` and the in-game `F9` drawer for missing workflows (such as inline `settings.toml` editing in `F9`), error feedback, keyboard accessibility, and responsive layout edge cases.
