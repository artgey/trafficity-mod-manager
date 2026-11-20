# Trafficity Building System — Exhaustive Technical Internals

Trafficity does **not** use an OOP `Building` base class internally. Instead, buildings are pure data records (`type: string`) stored in `gameState.saveState.buildings[id]`, paired with static lookup tables spread across several Parcel modules in `dist/Router.89d029ab.js` and duplicated across three Web Workers.

Notably, **zero building PNG/SVG files exist in `app.asar`**. All 18 vanilla buildings are drawn procedurally from 2.5D polygon extrusions (`getExtrusions(width, depth)`), projected in-world via PixiJS `Graphics` and in UI previews via inline `<svg>` + PNG data-URL prebaking.

---

## 1. Core Building Definition Schema (`4nkf2`)

Module `4nkf2` exports:
- `BUILDING_DEFINITIONS`: `Array<BuildingDefinition>` (the 18 built-in definitions).
- `getBuildingDefaultColor(type)`: returns `def.buildingColors[0]` or `"#888888"`.
- `getBuildingDefinition(type)`: looks up `type` in a **closed-over `Map` (`h`)** populated once at module initialization (`for (let e of c) h.has(e.type) || h.set(e.type, e)`), throwing `Error("Building definition not found for type: " + type)` if missing.

> **Modding Trap:** Simply doing `BUILDING_DEFINITIONS.push(myDef)` updates toolbar enumeration (`jgEEo`), `kvRvT`, `placeBuildingsFromFootprints` (`6whda`), and `prebakeAllBuildingPreviewIcons` (`iPOHp`), **but does NOT update the closed-over `Map` `h` inside `getBuildingDefinition(type)`**. You must also wrap/replace `getBuildingDefinition` (via `Object.defineProperty`) AND inject into the 3 workers.

### Definition Fields

| Property | Type | Required | Description & Behavior |
| :--- | :--- | :--- | :--- |
| `type` | `string` | Yes | Unique building identifier slug (e.g. `"small-residential"`). Used as the join key across all lookup modules and saved into `.sav` files. |
| `buildingCategory` | `"residential" \| "commercial" \| "office" \| "industrial"` | Yes | Determines core simulation role, `BuildingViewPanel` (`aelWA`) tabs, tooltip rules (`eAKuV` auto-adds `"cpg"` to commercial inputs display), happiness meters (`5JbRC`), and runtime state fields created on placement (`journeyTraceHistory`/`activeJourneys` vs `activityHistory`/`activeActivities`). |
| `buildingColors` | `string[]` (hex `"#RRGGBB"`) | Yes | Color palette array. Index `0` is the primary roof/body color (also saved to `building.color`). Extrusions can select `colorIndex` (`0`, `1`, `2`, `3`, ...). Automatically darkened in dark mode by `DARK_MODE_BUILDING_DARKEN`. |
| `width` | `number` | Yes | Frontage width along the road edge (world units). Must leave room for `parkingSpaces` (`x` offsets within `[0, width]`) or `parkingGarageEntrance`/`Exit`. |
| `depth` | `number` | Yes | Depth perpendicular away from the road frontage (world units). |
| `pollutionOutput` | `"none" \| "low" \| "medium" \| "high"` | Yes | Static pollution emissions in `5x7Vi`: `{ none: 0, low: 0.55, medium: 0.65, high: 0.75 }`. `updatePollutionFromBuildings` raises `pollutionGrid` at `(centerX, centerY)` to at least that threshold. |
| `pollutionAffectsHappiness` | `boolean` (optional) | No | Observed `true` on all 3 residential types and `farm`. Enables the air-quality happiness meter (`5JbRC` / `6whda`) and air-quality tooltip warning (`eAKuV`). |
| `parkingSpaces` | `number[]` | Yes | X-offsets (`0 <= x <= width`) along the plot frontage where outdoor perpendicular parking stalls & sidewalk cutouts are generated (`2OGVI`, `803W5`). Empty `[]` for garage buildings. |
| `parkingGarageEntrance` | `number` (optional) | Garage only | X-offset along the frontage where vehicles enter the internal garage (`803W5`, `2OGVI`). Must be paired with `parkingGarageExit` and `parkingGarageEffectiveCapacity`. |
| `parkingGarageExit` | `number` (optional) | Garage only | X-offset along the frontage where vehicles exit the internal garage (`803W5`, `2OGVI`). Swapped automatically via `parkingGarageEntranceExitSwapped` based on `roadRunsLeftToRightAlongFront(...)`. |
| `parkingGarageEffectiveCapacity` | `number` (optional) | Garage only | Max effective car/visitor capacity for garage buildings (`7fuAh` throws `Missing parkingGarageEffectiveCapacity` if `parkingGarageEntrance !== undefined` and this is missing!). |
| `inputs` | `Array<"food" \| "copper" \| "iron" \| "steel" \| "cpg">` | Yes | Resource IDs consumed (factories list inputs explicitly e.g. `["iron"]`; commercial buildings keep `[]` here because `eAKuV` & commercial demand handle `"cpg"` implicitly). |
| `outputs` | `Array<"food" \| "copper" \| "iron" \| "steel" \| "cpg">` | Yes | Resource IDs produced by industrial buildings (`["food"]`, `["copper"]`, `["iron"]`, `["steel"]`, `["cpg"]`). |
| `vanCapacity` | `number` (optional) | Commercial | Number of delivery vans allowed simultaneously for commercial receivers (`dyZPp`). Also subtracted from `parkingSpaces.length` in `7fuAh` when computing visitor car parking capacity (`Math.max(0, parkingSpaces.length - (vanCapacity ?? 0))`). |
| `truckCapacity` | `Partial<Record<ResourceId, number>>` (optional) | Factories | Per-resource simultaneous incoming truck slots (`5qjWv`: `def.truckCapacity?.[resource] ?? 0`), e.g. `{ iron: 1 }`, `{ food: 1 }`, `{ copper: 1 }`. |
| `requiredTerrain` | `"sand" \| "grass" \| ...` (optional) | No | Plot must sample at least one point on this terrain (`arlJO` `buildingSatisfiesRequiredTerrain`). Vanilla uses `"sand"` (`small-industrial`) and `"grass"` (`farm`). |
| `forbiddenTerrain` | `"deepwasteland" \| ...` (optional) | No | Plot cannot intersect this terrain (`arlJO` `buildingIntersectsForbiddenTerrain`). Vanilla uses `"deepwasteland"` on all 3 residential types. |
| `mineTerrain` | `"mountain" \| "water"` (optional) | Mines/Fishery | Plot rear edge must lie inside this terrain (`arlJO` `buildingMineRearInTerrain`); ignores obstacle collision for its own target terrain at rear (`buildingFootprintIntersectsTerrainObstacles`). Triggers mountain stroke boundary lines in `bRLNG` (`getMineMountainBoundaryStrokeColor`). |
| `labelY` | `number` (optional) | No | Y-offset used by `BuildingPreview` (`iPOHp`) when `showResourceLabel: true` to draw resource badge arrows inside the icon (`farm`, `food-factory`, `copper-mine`, `fishery`, `iron-mine`, `copper-product-factory`). |
| `getExtrusions` | `(width: number, depth: number) => Extrusion[]` | Yes (procedural) | Returns array of 2.5D polygon roofs/volumes in building-local space. Optional `colorIndex`, `roofDarkness`, `roofDirectionOverride`, `skipRoofOutline`. |

---

## 2. All 18 Vanilla Building Definitions (Verified Values)

| Type | Category | Size (`w x d`) | Colors | Parking / Garage | Inputs -> Outputs | Terrain Constraint | Pollution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `small-residential` | `residential` | `60 x 60` | `["#78CC51"]` | `[15]` | `[] -> []` | forbidden: `deepwasteland` | `none` (affects happiness) |
| `medium-residential` | `residential` | `90 x 90` | `["#50972e"]` | `[15,35,55,75]` | `[] -> []` | forbidden: `deepwasteland` | `none` (affects happiness) |
| `large-residential` | `residential` | `140 x 120` | `["#31641a"]` | Garage: in `27.5`, out `112.5`, cap `12` | `[] -> []` | forbidden: `deepwasteland` | `none` (affects happiness) |
| `small-commercial` | `commercial` | `110 x 90` | `["#3997e4"]` | `[15,35,55,75,95]` (`vanCapacity: 1`) | `[] -> []` | — | `none` |
| `medium-commercial` | `commercial` | `200 x 175` | `["#2380cc"]` | `[30,50,...,170]` (`8` spaces, `vanCapacity: 2`) | `[] -> []` | — | `none` |
| `large-commercial` | `commercial` | `350 x 200` | `["#0e6ab5"]` | Garage: in `40`, out `310`, cap `24` (`vanCapacity: 4`) | `[] -> []` | — | `none` |
| `small-office` | `office` | `90 x 90` | `["#9b59d0"]` | `[15,35,55,75]` | `[] -> []` | — | `none` |
| `medium-office` | `office` | `180 x 185` | `["#7b3db8"]` | `[30,50,70,90,110,130,150]` | `[] -> []` | — | `none` |
| `large-office` | `office` | `280 x 200` | `["#5e2a9a"]` | Garage: in `40`, out `240`, cap `24` | `[] -> []` | — | `none` |
| `small-industrial` | `industrial` | `140 x 120` | `["#f0d13d"]` | `[20,40,60,80,100,120]` | `[] -> []` | required: `sand` | `low` |
| `medium-industrial` | `industrial` | `200 x 175` | `["#e8bd2c"]` | `[30,50,...,170]` (`8` spaces) | `[] -> []` | — | `medium` |
| `steel-mill` | `industrial` | `400 x 210` | `["#8A8A8A", iron, steel, cpg]` | Garage: in `60`, out `340`, cap `12` (`truckCapacity: {iron:1}`) | `["iron"] -> ["steel"]` | — | `high` |
| `farm` | `industrial` | `200 x 175` | `["#8A8A8A", "#78CC51", roofOutline]` | Garage: in `40`, out `160`, cap `5` | `[] -> ["food"]` | required: `grass` | `none` (affects happiness) |
| `food-factory` | `industrial` | `160 x 140` | `["#8A8A8A", food, cpg]` | Garage: in `32`, out `128`, cap `6` (`truckCapacity: {food:1}`) | `["food"] -> ["cpg"]` | — | `medium` |
| `copper-mine` | `industrial` | `160 x 240` | `["#8A8A8A", copper]` | Garage: in `32`, out `128`, cap `6` | `[] -> ["copper"]` | mineTerrain: `mountain` | `medium` |
| `fishery` | `industrial` | `160 x 288` | `["#8A8A8A", "#78CC51"]` | Garage: in `32`, out `128`, cap `6` | `[] -> ["food"]` | mineTerrain: `water` | `none` |
| `iron-mine` | `industrial` | `160 x 240` | `["#8A8A8A", darken(iron, 0.1)]` | Garage: in `35.2`, out `124.8`, cap `6` | `[] -> ["iron"]` | mineTerrain: `mountain` | `medium` |
| `copper-product-factory` | `industrial` | `192 x 123.6` | `["#8A8A8A", copper, cpg]` | Garage: in `24.96`, out `167.04`, cap `8` (`truckCapacity: {copper:1}`) | `["copper"] -> ["cpg"]` | — | `medium` |

### Valid Resource & Terrain IDs

- **`RESOURCE_DEFINITIONS` (`90RkR`):** `"food"`, `"copper"`, `"iron"`, `"steel"`, `"cpg"` (`Consumer goods`). (`RESOURCE_NEED_COUNT = 5`).
- **`TERRAIN_DEFINITIONS` (`lz5kL`):** `"water"`, `"land"`, `"mountain"`, `"void"`, `"sand"`, `"grass"` (`Fertile land`), `"wasteland"`, `"deepwasteland"`.

---

## 3. Coordinate System, Footprints & 2.5D Extrusions

### Building-Local Coordinate Projection (`k7FBV`)

`getBuildingFootprintWorldCorners(footprint)` returns 4 corners around `(footprint.centerX, footprint.centerY)` rotated by `footprint.rotation`:
- `corners[0]` = local `(+width/2, -depth/2)` (front-left when facing the road from the plot)
- `corners[1]` = local `(-width/2, -depth/2)` (front-right)
- `corners[2]` = local `(-width/2, +depth/2)` (back-right)
- `corners[3]` = local `(+width/2, +depth/2)` (back-left)

`projectBuildingCoordinate(footprint, x, y)` maps `(x, y)` inside `[0..width, 0..depth]`:
- **`x = 0 -> width`** walks linearly along the **front edge** from `corners[0]` to `corners[1]` (with `rotation = 0`, `x` goes from `+w/2` to `-w/2`, i.e., **right-to-left in unrotated world coords** because the frontage faces `"north"` at `rotation - Math.PI / 2`).
- **`y = 0 -> depth`** extends perpendicularly inward from front edge (`y = 0`) to rear edge (`y = depth`) along angle `atan2(-(c1.x - c0.x), c1.y - c0.y)` (with `rotation = 0`, `+y` goes toward `+depth/2`).

### Extrusion Geometry (`9ccnm`, `bRLNG`)

Each object returned by `getExtrusions(width, depth)` has:

```ts
interface Extrusion {
  points: Array<{
    x: number;
    y: number;
    height: number;                 // Extrusion drop/shadow offset: (+0.5 * height, +0.5 * height)
    nextEdgeOffsetOverride?: number;// Optional roof slope/edge hint (0 or 1 on slanted roofs)
  }>;
  roofDarkness: number;             // Brightness adjustment: 0 normal, negative darker (e.g. -0.65), positive lighter
  colorIndex?: number;              // Index into def.buildingColors[] (defaults to 0)
  roofDirectionOverride?: number;   // Radians overriding edge angle for directional roof shading
  skipRoofOutline?: boolean;        // If true, skips inner/outer roof border contrast pass
}
```

Shadows (`getExtrusionShadowPolygonsFlat`) project each edge `{p[o], p[o+1]}` into a quad extruded by `(+0.5 * p.height, +0.5 * p.height)` in world coordinates.

---

## 4. Scattered Lookup Tables & Module Dependencies

Because Trafficity splits building metadata across separate modules, registering a building requires touching all active tables below:

1. **`4nkf2` (`BUILDING_DEFINITIONS`, `getBuildingDefinition`, `getBuildingDefaultColor`)**: Core geometry, colors, categories, I/O, parking/garage specs.
2. **`aUbb1` (`buildingDisplayName`) + `4aR6e` (`LOCALISATION_STRINGS`)**:
   - `aUbb1` has a private closed-over map `o[type] -> i18nKey` and runs `t(o[type])`.
   - `t(key, vars)` in `9nNmt` looks up `LOCALISATION_STRINGS[currentLang][key]`, falling back to `LOCALISATION_STRINGS.en[key]`, then returns `key` itself. If `o[type]` is `undefined`, `t(undefined)` returns `undefined`! Always wrap `aUbb1.buildingDisplayName` (or inject into `LOCALISATION_STRINGS` AND handle fallback in `buildingDisplayName`).
3. **`fFJcz` (`getBuildingCarCountSpec`, `isProductionVehicleCarCountSpec`, `getResidentCarCountForResidentialBuildingType`, `getTotalVehicleCountForBuildingType`)**:
   - Maps `type` to `{ cars: N }`, `{ trucks: { [resource]: N } }`, or `{ vans: { [resource]: N } }`.
   - Default for unlisted buildings is `null` (spawns 0 vehicles).
4. **`jnB0a` (`buildingHasGetVisitedNeed`)**:
   - Private table `i[type]`:
     - Commercial/Office/Industries: `{ getVisitedTimeToIncrement: number, obtainTimeToIncrement?: Record<ResourceId, number>, deliverTimeToIncrement?: Record<ResourceId, number> }` (e.g. `40`, `25`, `10` seconds depending on tier).
   - Used by both main thread (`6whda`) and workers (`6hect`) to know whether a building needs visitor arrivals (`getVisited` satisfaction meter).
5. **`2cbpn` (`getSatisfactionWeightForBuildingType`, `getSatisfactionWeightForPackNumber`)**:
   - Residential: uses `getResidentCarCountForResidentialBuildingType(type)`.
   - Commercial: **hardcoded lookup map** `{ "small-commercial": 15, "medium-commercial": 30, "large-commercial": 60 }` — **throws `Error("Commercial building type has no defined satisfaction weight: ...")` if missing!**
   - Office: **hardcoded lookup map** `{ "small-office": 15, "medium-office": 30, "large-office": 60 }` — **throws if missing!**
   - Industrial: returns `20` automatically.
6. **`5x7Vi` (`updatePollutionFromBuildings`)**: Reads `def.pollutionOutput` dynamically (`none`/`low`/`medium`/`high`).
7. **`7fuAh` / `5qjWv` / `dyZPp`**: Visitor, truck, and van incoming capacities read `def.parkingSpaces`, `def.parkingGarageEffectiveCapacity`, `def.truckCapacity`, `def.vanCapacity` dynamically.

---

## 5. Runtime State & Full Lifecycle

### Placement (`d3foG` -> `dDLDP` -> `6whda`)

1. **Toolbar (`kvRvT`, `jgEEo`):**
   - `getBuildingToolbarPlacementRows(saveState)` iterates `BUILDING_DEFINITIONS`, comparing placed count in `saveState.buildings` vs `saveState.cumulativeBuildingCount[type] ?? 0`.
   - Clicking a toolbar icon sets `game.setCursorMode({ mode: "building placement", buildingDefinitionName: type, rowPlacementStart: null, rowPlacementEnd: null })`.
2. **Draft Snapping & Validation (`d3foG`, `dDLDP`, `arlJO`, `cCmiT`, `zDrFY`, `2ICyP`):**
   - Finds nearest open lane tip/side (`findNearestBuildingFootprint`), checks: road proximity (`notAlongRoad`), junction overlap (`overlapsJunction`), elevation (`elevatedRoad`), lane clearance (`laneTooClose`), frontage chord target reach (`targetTooFar`), other buildings (`buildingInWay`), terrain obstacles/locked tiles (`terrainObstacle`, `lockedTile`), and `requiredTerrain`/`forbiddenTerrain`/`mineTerrain` (`wrongTerrain`).
   - Renders preview via `createBuildingGraphicsParts` (`XfMqf`) into `layers.buildingsGroundPreview`, `buildingsGroundSidewalkPreview`, `buildingsShadowPreview`, `buildingsObjectPreview`.
3. **Instantiation (`6whda` — `placeBuildingsFromFootprints` / `placeBuildingAtFootprint`):**
   - Allocates `id = game.saveState.allocateBuildingId()`.
   - Constructs `saveState.buildings[id]`:

```js
{
  id,
  type: def.type,
  color: def.buildingColors[0],
  footprint: {
    validity: "valid",
    width, depth, centerX, centerY, rotation,
    direction: "left" | "right",
    leftTargetPoint: { laneSectionId, pointIndex },
    rightTargetPoint: { laneSectionId, pointIndex },
  },
  waitPoints: [...],
  garageEntryOptions: [],
  emergeLaneTokenA: -1,
  emergeLaneTokenB: -1,
  emergeLaneTokensReady: false,
  parkingSpaceLockHolders: Array(def.parkingSpaces.length).fill(null),
  // If parkingGarageEntrance !== undefined:
  parkingGarageEntranceExitSwapped: roadRunsLeftToRightAlongFront(saveState.laneSections, footprint),
  // If residential:
  journeyTraceHistory: [],
  activeJourneys: [],
  // If commercial | industrial | office:
  activityHistory: [],
  activeActivities: [],
}
```

   - Computes `waitPoints` (`updateBuildingWaitPoints`, `updateBuildingJunctionMouthWaitPoints`), registers spatial cell (`game.buildingCellTracker.registerBuilding(building)`), seeds `buildingHappinessMetadata`.
   - **Vehicle Spawning (`6whda`):**
     - Production buildings (`isProductionVehicleCarCountSpec`): spawns `trucks` and `vans` generically for ANY type matching `fFJcz`.
     - **Residential caveat:** `6whda` hardcodes `"small-residential" === t.type || "medium-residential" === t.type` for outdoor `placementDeps.spawnOutdoorResidentialCar(...)` and `"large-residential" === t.type` for garage `createResidentCarInWorker(...)`! Custom residential buildings must invoke `placementDeps.spawnOutdoorResidentialCar` / garage spawning from a placement wrapper.
   - Calls `updateBuildingGraphics(game, building)`, records undo (`recordBuildingsPlacedForUndo`), rebuilds garage crossables (`rebuildParkingGarageCrossables`), and syncs workers (`saveState.updateBuildings(...)`).

### Rendering (`XfMqf`, `2OGVI`, `iPOHp`)

- **World layers (`gameState.layers`):**
  - `buildingsGround` & `buildingsGroundSidewalk`: asphalt/parking stalls/sidewalks (`2OGVI`).
  - `buildingsObject`: building meshes (`XfMqf` creates PixiJS `Graphics` or `Container`/`Sprite`, tinted in view modes).
  - `shadows`: extruded shadow quads + `markShadowLodDirty`.
- **View modes (`XfMqf`):** `"normal"`, `"pollution"`, `"car-noise"`, `"happiness"`, `"awaiting-first-trip"`, `"traffic-flow"`. In non-normal modes, `applyBuildingDisplayColors` sets `.tint` on `objectContainer.children[i]`.
- **UI Preview (`iPOHp` `BuildingPreview`):** Projects `getExtrusions` into inline `<svg>` OR renders a cached PNG data URL from prebake cache `Map` `I` as `<img class="building-count-preview" src={...}>`.

### Selection, Panel, Deletion, Save (`aelWA`, `gh1Od`, `2D2V6`)

- **Selection & Panel (`aelWA` `BuildingViewPanel`):** Opens when `gameState.worldSelection` is `{ type: "building", buildingId }`. Renders `BuildingPreview`, satisfaction bars (`getApplicableHappinessMeters`), and either resident car list (if `buildingCategory === "residential"`) or active visiting/delivery vehicle activity list.
- **Deletion (`gh1Od` `deleteBuildingsFromGameState`):** Queues happiness history for potential undo restoration, unregisters from `buildingCellTracker`, releases garage/parking locks, removes & destroys Pixi containers across all 4 layers, rebuilds crossables, clears selection.
- **Save Persistence:** Serialized inside gzipped JSON `.sav` under `world.buildings[id]`. Only `parkingSpaceLockHolders` and `journeyTraceHistory` are compacted (`d1gNk` / save exporter); custom keys on `saveState.buildings[id]` are preserved unless stripped by `toWorkerBuilding` (`2D2V6`, which only omits `journeyTraceHistory`, `activeJourneys`, `activityHistory`, `activeActivities`).

---

## 6. The Web Worker Isolation Boundary

Trafficity spawns classic Web Workers (`new Worker(url)`) from `Router.89d029ab.js` via `2p8Od` (`car-worker`), `i2fsA` (`pathfinding-worker`), and `kATiu` (`happiness-worker`), resolved through `7ryUf`. Because workers run in isolated threads wrapped in self-executing IIFEs (`(()=>{ ... })()`), main-thread patches to `4nkf2` / `jnB0a` / `fFJcz` **do not cross into workers**.

Each worker contains its own internal module IDs:

| Worker | `getBuildingDefinition` module | `buildingHasGetVisitedNeed` module | `getBuildingCarCountSpec` module |
| :--- | :--- | :--- | :--- |
| `car-worker.d0cd07dd.js` | `aS4Aq` | `6hect` | *(not bundled)* |
| `happiness-worker.57a44d79.js` | `aS4Aq` | `6hect` | `3baQI` |
| `pathfinding-worker.beb79cef.js` | `aS4Aq` | `6hect` | *(not bundled)* |

> Note: Parcel tree-shook `BUILDING_DEFINITIONS` out of `aS4Aq` inside workers, leaving only the `u` Map and `getBuildingDefinition` export. Any worker patch must wrap `aS4Aq.getBuildingDefinition` (or intercept `window.Worker` before worker creation to inject a tiny shim right before the worker's bootstrap `l("fHJ87")` calls!).
