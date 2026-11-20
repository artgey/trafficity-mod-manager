# `CustomBuilding` & `BuildingRegistry` — Reference Documentation

This document explains every option, valid enum value, simulation effect, rendering option, lifecycle hook, and known engine limitation of [`02-custom-building-prototype.mjs`](./02-custom-building-prototype.mjs).

---

## 1. `new CustomBuilding(config)` — Attributes & Limited Options

### A. Identity & Localization

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `type` | `string` | *(Required)* | Must be unique across vanilla (`18` types) and mods. Avoid spaces; kebab-case or namespaced slug recommended (e.g. `"mod:bakery"`). | Primary key used everywhere in Trafficity: `BUILDING_DEFINITIONS`, toolbar rows, worker tables, `buildingDisplayName`, and serialized inside `.sav` files under `world.buildings[id].type` and `world.cumulativeBuildingCount[type]`. |
| `name` | `string` | `config.type` | Any string | Fallback display name returned by `buildingDisplayName(type)` in toolbar tooltips, placement messages, and `BuildingViewPanel`. |
| `localizedNames` | `Record<string, string>` \| `null` | `null` | Supported vanilla language codes in `4aR6e` / `d9Mr8`: `"en"`, `"fr"`, `"de"`, `"es"`, `"ru"`, `"ptbr"`, `"zhs"`, `"ja"`, `"ko"`. | Per-language display names checked using `9nNmt.getLocalisationLanguage()`. Falls back to `localizedNames.en`, then `name`. |

---

### B. Category & Plot Size

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `buildingCategory` | `string` | *(Required)* | **Strictly limited to:** `"residential"` \| `"commercial"` \| `"office"` \| `"industrial"`. | Drives simulation role & UI panels: <br>• **`"residential"`**: Creates `journeyTraceHistory`/`activeJourneys`, displays `"Residents"` tab in `BuildingViewPanel`, lets residents spawn trips to `"commercial"`, `"office"`, and `"industrial"`.<br>• **`"commercial"`**: Creates `activityHistory`/`activeActivities`; `BuildingTypeTooltip` automatically shows consuming **`"cpg"`** (`Consumer goods`) even if `inputs: []`; attracts shopping trips and delivery vans (`vanCapacity`).<br>• **`"office"`**: Attracts commuter work trips.<br>• **`"industrial"`**: Attracts worker trips, can emit pollution, produces/consumes cargo resources via `truckCapacity` & `outputs`. |
| `width` | `number` | `110` | Positive number (`> 0`). Vanilla ranges: `60` (`small-residential`) to `400` (`steel-mill`). | Plot width parallel to the road frontage (`corners[0] -> corners[1]`). Affects snap distance checks, neighbor overlap bounding box, and mouse hover reach (`2 * width` in `d3foG`). |
| `depth` | `number` | `90` | Positive number (`> 0`). Vanilla ranges: `60` (`small-residential`) to `288` (`fishery`). | Plot depth extending perpendicularly away from the road edge (`y = 0` at curb -> `y = depth` at rear). |

---

### C. Colors & Visuals (`XfMqf`, `iPOHp`, `4rhnu`)

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `buildingColors` | `string[]` | `[categoryDefaultHex]` | Array of 6-digit hex CSS strings (`"#RRGGBB"`). Defaults: res `#78CC51`, com `#3997e4`, off `#9b59d0`, ind `#e8bd2c`. | `buildingColors[0]` is stored as `building.color` and acts as default roof/body color (auto-darkened in Dark Mode). Subsequent indices (`1`, `2`, `3`) are referenced by `Extrusion.colorIndex`. |
| `getExtrusions` | `(width, depth, instance) => Extrusion[]` | Single box extrusion | Returned polygon points live in `(x ∈ [0..width], y ∈ [0..depth], height ≥ 0)`. Optional per-poly fields: `roofDarkness`, `colorIndex`, `roofDirectionOverride`, `skipRoofOutline`. | Controls **procedural 2.5D roof/wall geometry**, **extruded ground shadows** (`bRLNG`), and **vector SVG / PNG-prebaked toolbar icons** (`iPOHp`). Even when using a custom `spriteUrl`, providing a matching extrusion shape gives accurate dynamic drop shadows on the terrain. |
| `extrusionHeight` | `number` | `35` | Positive number (`>= 0`). | Height passed to the fallback rectangle box extrusion when `getExtrusions` is omitted. |
| `spriteUrl` | `string \| null` | `null` | Same-origin path (e.g. `"/mods-runtime/mods/<folder>/assets/bakery.png"`), `data:image/...`, or `blob:` URL. | Replaces the PixiJS world building mesh (`parts.object`) with a textured PixiJS `Sprite` sized to the footprint AND overrides `BuildingPreview` (`iPOHp`) in the toolbar/view panel with an `<img>` using that source. Note: ground asphalt/sidewalk parking bays (`parts.ground`, `parts.groundSidewalk`) and shadows (`parts.shadow`) still render beneath it automatically! |
| `spritePadding` | `number` | `0` | Any number (`>= 0`). | Inset margin (world units) subtracted from both sides of `width` and `depth` when sizing the world `Sprite`. |
| `spriteFlipY` | `boolean` | `false` | `true` \| `false` | Flips vertical orientation of the world `Sprite` if your texture faces bottom-to-top relative to the curb (`rotation + Math.PI`). |

---

### D. Road Frontage, Parking Spaces vs. Garage

> **Mutual Exclusion Constraint:** In Trafficity (`803W5`, `2OGVI`, `7fuAh`), a building uses **either** outdoor perpendicular `parkingSpaces` **or** an internal drive-in `garage` (`parkingSpaces: []`). Notice in our constructor, passing `garage` automatically sets `parkingSpaces = []`.

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `parkingSpaces` | `number[]` | `[Math.round(width / 2)]` (if no `garage`) | Array of X-offsets inside `[0, width]` (typically spaced ≥ `20` units apart so adjacent cars don't collide, e.g. `[15, 35, 55, 75]`). Set `[]` when using `garage`. | Places outdoor parking bays along the sidewalk frontage (`2OGVI`). Visitor car capacity = `Math.max(0, parkingSpaces.length - (vanCapacity ?? 0))` (`7fuAh`). |
| `garage` | `{ entrance: number, exit: number, effectiveCapacity: number } \| null` | `null` | `entrance` & `exit` must be X-offsets within `(0, width)`. `effectiveCapacity` must be `> 0`. | Configures internal garage entry/exit kerb mouths (`parkingGarageEntrance`, `parkingGarageExit`, `parkingGarageEffectiveCapacity`). Automatically mirrored based on left/right driving side & road direction (`parkingGarageEntranceExitSwapped`), and rebuilds passing crossable lane tokens (`rebuildParkingGarageCrossables`). |

---

### E. Terrain Rules & Pollution

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `requiredTerrain` | `string \| undefined` | `undefined` | **Valid terrains (`lz5kL`):** `"water"` \| `"land"` \| `"mountain"` \| `"void"` \| `"sand"` \| `"grass"` \| `"wasteland"` \| `"deepwasteland"`. | Plot placement requires intersecting this terrain (`arlJO` `buildingSatisfiesRequiredTerrain`). Shown in hover tooltip as `"Must be placed on <terrain>"`. |
| `forbiddenTerrain` | `string \| undefined` | `undefined` | Same 8 values as above. Vanilla uses `"deepwasteland"` on residential buildings. | Blocks placement (`wrongTerrain`) if any sample point inside the footprint touches this terrain. |
| `mineTerrain` | `string \| undefined` | `undefined` | **Strictly limited to:** `"mountain"` \| `"water"`. | Requires the plot's **rear edge** to sit inside `mountain` or `water` while carving exception logic into obstacle checks (`arlJO` `buildingMineRearInTerrain`) and drawing mountain border outlines (`bRLNG`). |
| `pollutionOutput` | `string` | `"none"` | **Strictly limited to:** `"none"` \| `"low"` \| `"medium"` \| `"high"`. | `updatePollutionFromBuildings` (`5x7Vi`) raises `pollutionGrid` at center to `none: 0`, `low: 0.55`, `medium: 0.65`, `high: 0.75`. |
| `pollutionAffectsHappiness` | `boolean` | `true` for `"residential"`, else `false` | `true` \| `false` | Enables Air Quality happiness penalty (`5JbRC`, `6whda`) and shows `"Dislikes pollution"` in the toolbar tooltip (`eAKuV`). |

---

### F. Resources, Vehicles & Demand Simulation

| Option | Type | Default | Limited Options / Constraints | What It Does |
| :--- | :--- | :--- | :--- | :--- |
| `inputs` | `string[]` | `[]` | Each item strictly in: `"food"` \| `"copper"` \| `"iron"` \| `"steel"` \| `"cpg"`. | Cargo types consumed by factories (commercial types consume `"cpg"` implicitly without needing `"cpg"` in `inputs`, though keeping `inputs` accurate documents dependencies). |
| `outputs` | `string[]` | `[]` | Each item strictly in: `"food"` \| `"copper"` \| `"iron"` \| `"steel"` \| `"cpg"`. | Cargo types produced by industrial mines/farms/factories/fisheries. |
| `vanCapacity` | `number \| undefined` | `undefined` | Positive integer (vanilla commercial: `1`, `2`, `4`). | Max simultaneous delivery vans accepted by a commercial building (`dyZPp`). **Subtracted from `parkingSpaces.length`** when calculating visitor parking slots! |
| `truckCapacity` | `Record<string, number> \| undefined` | `undefined` | Keys from `VALID_RESOURCES`, values `>= 1` (vanilla factories: `{ iron: 1 }`, `{ food: 1 }`, `{ copper: 1 }`). | Simultaneous incoming supply truck slots per input resource (`5qjWv`). |
| `vehicles` | `{ cars: number } \| { trucks: Record<string, number> } \| { vans: Record<string, number> } \| null` | `null` | Mutually exclusive shape matching `fFJcz`. Resource keys in `trucks`/`vans` must belong to `VALID_RESOURCES`. | Spawns residents or cargo delivery vehicles owned by this building:<br>• `{ cars: N }`: Resident cars spawned on outdoor spaces (`N <= parkingSpaces.length`) or in the garage.<br>• `{ trucks: { [res]: N } }`: Producer heavy trucks (farms, mines, steel mill).<br>• `{ vans: { [res]: N } }`: Consumer-goods vans (food/copper factories). |
| `needsVisited` | `boolean` | `false` for `"residential"`, `true` otherwise | `true` \| `false` | Controls `buildingHasGetVisitedNeed(type)` in both main thread (`jnB0a`) and workers (`6hect`), enabling visitor-access satisfaction tracking. |
| `satisfactionWeight` | `number` | `20` (industrial) / `15` (others) | Non-negative number (`>= 0`). | Weight used by `getSatisfactionWeightForBuildingType` (`2cbpn`) for city-wide happiness & unlock thresholds (prevents vanilla `Error` thrown for unlisted commercial/office types). |
| `labelY` | `number \| undefined` | `undefined` | Number inside `[0, depth]`. | Y-coordinate where `BuildingPreview` draws the resource flow badge arrow when `showResourceLabel: true`. |
| `defaultQuota` | `number` | `0` | Integer `>= 0`. | When `> 0`, `BuildingRegistry` automatically seeds `saveState.cumulativeBuildingCount[type] = defaultQuota` when a world loads if missing, making the building immediately available in the toolbar without waiting for a Development Pack unlock! |

---

## 2. Lifecycle & Expansion Hooks

Either pass callbacks inside `new CustomBuilding({ ... })` OR **subclass `CustomBuilding`** and override these methods (great for specialized modded mechanics like transit hubs, toll booths, pollution scrubbers, or dynamic cargo converters!):

| Hook / Method | Signature | When It Fires | Common Extension Uses |
| :--- | :--- | :--- | :--- |
| `onPlace` | `(gameState, buildingRecord, { placementDeps }, self)` | After player places building(s) or restores via undo (`6whda`). | Attach custom metadata on `buildingRecord`, deduct/grant money (`gameState.saveState`), play custom sound effects (`mods.game.playSfx` or `@pixi/sound`), modify nearby road speed limits, trigger custom popups. |
| `onDelete` | `(gameState, buildingRecord, self)` | After building is demolished or undone (`gh1Od`). | Clean up custom overlays, timers, linked objects, or refund budget. |
| `onSelect` | `(gameState, buildingRecord, self)` | When user clicks a building of this `type` (`worldSelection.type === "building"`). | Open or update a custom inspector HUD (`mods.addOverlay(...)`) alongside `BuildingViewPanel`. |
| `onRenderWorld` | `(parts, buildingRecord, gameState, { Sprite, Texture, CanvasSource }, self)` | Whenever `createBuildingGraphicsParts` or `updateBuildingGraphics` runs (placement preview, world load, hover, dark-mode toggle, view mode switch). | Draw extra PixiJS `Graphics`/`Sprite` layers onto `parts.object`, `parts.ground`, `parts.groundSidewalk`, or `parts.shadow` (e.g., animated radar sweep, range ring, status neon sign, smoke emitter). |

---

## 3. Important Caveats & Limitations

1. **Worker Injection Must Happen Before Map Load (`installWorkerHook()`):**
   Call `registry.installWorkerHook()` at mod initialization (even before `"ready"`), because as soon as the player clicks Start/Load Map, Trafficity spawns `car-worker`, `happiness-worker`, and `pathfinding-worker`. Once a worker is running, changing `window.Worker` won't affect already-running threads unless the map restarts.
2. **Development Pack Objectives Interaction (`defaultQuota`):**
   If you add `saveState.cumulativeBuildingCount[myType] = N` in a standard progressive game, note that `areAllUnlockedBuildingsPlaced(saveState)` (`jgEEo` / `aigC5`) checks **all** keys in `cumulativeBuildingCount` to decide whether the City Level "All buildings placed" objective is met!
   - **Tip:** If your mod wants optional sandbox buildings that don't block City Level progression, either keep `defaultQuota: 0` and provide a custom placement button (calling `gameState.setCursorMode({ mode: "building placement", buildingDefinitionName: type, rowPlacementStart: null, rowPlacementEnd: null })` when placed freely or patching `jgEEo.areAllUnlockedBuildingsPlaced`), OR only grant quota in sandbox / via user action.
3. **Garage Residential Car Spawning Inside `BuildingRegistry`:**
   Vanilla `6whda`'s garage spawner (`M`) uses `CAR_COLOR_COUNT` (`84pTe`) and `generateCarDrivingProperties` (`jwrek`). The simplified prototype uses numeric fallbacks when spawning garage residents (`colorIndex < 6`, `{ maxSpeed: 100 }`); production mod implementations can read exact `84pTe.CAR_COLOR_COUNT` and `jwrek.generateCarDrivingProperties("car")` directly from `game.requireRouterModule`.
4. **Loading Pre-Existing `.sav` Files Containing Custom Buildings:**
   If a save already contains `{ type: "mod:bakery", ... }` on disk:
   - The player **must** still have that mod enabled when loading the save; otherwise vanilla `getBuildingDefinition("mod:bakery")` throws `Building definition not found for type: mod:bakery`.
   - `BuildingRegistry` patches `getBuildingDefinition`, `updateBuildingGraphics`, and workers before/at world load, so re-loading a modded save re-renders and simulates custom buildings seamlessly! (Existing resident cars stored in `saveState.residents` already restore from the save automatically.)
