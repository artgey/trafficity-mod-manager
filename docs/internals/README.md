# Trafficity Modding Internals & Extension Knowledge Database

> **Tracked Reference (`docs/internals/`)** — Reverse-engineered read-only from shipped Steam build `trafficity@1.0.0+34b3cf6d3f` / `6969441617` (`~/.local/share/Steam/steamapps/common/Trafficity/resources/app.asar`) and the mod-manager source in this repository.

## Contents

| File | Scope |
| :--- | :--- |
| [`01-buildings-internals.md`](./01-buildings-internals.md) | Exhaustive dissection of Trafficity's building system: all 18 built-in building schemas, geometry & 2.5D extrusions, terrain/resource rules, scattered lookup tables, placement/deletion/undo/save lifecycle, toolbar quotas, PixiJS v8 world rendering, SVG/PNG UI previews, overlays, and isolated Web Workers. |
| [`02-custom-building-prototype.mjs`](./02-custom-building-prototype.mjs) | Clean, standalone, extendable `CustomBuilding` + `BuildingRegistry` ES module prototype (not wired as an example mod) demonstrating main-thread + worker registration, procedural extrusions or PNG/SVG sprite rendering, quotas, and lifecycle hooks. |
| [`02-custom-building-reference.md`](./02-custom-building-reference.md) | Detailed documentation for every `CustomBuilding` constructor option and property, exact valid enum values where constrained, Pixi/UI sprite behavior, lifecycle hooks (`onPlace`, `onDelete`, `onSelect`, etc.), and known engine caveats. |
| [`03-asset-file-injection-internals.md`](./03-asset-file-injection-internals.md) | Complete investigation of Sound (`@pixi/sound` SFX & ambient noise), Music (`HTMLAudioElement`), Images, Videos (`.mp4`), Fonts (`.ttf` / `@font-face`), Styles (`.css`), Saves/JSON (`/dev-saves`, `/api/player-saves`), and Worker scripts across `app.asar`, `electron/static-server.js`, `src/mod-api.cjs`, and `runtime/loader.js`. |
| [`04-levelup-progression-internals.md`](./04-levelup-progression-internals.md) | Dissection of City Level / Development Pack progression (`aigC5`, `a3oY4`, `9colC`, `jgEEo`, `bCcpU`): eligibility gates, budget/tile/building unlock effects, worker sync, and how mods can hook or customize triggers and rewards. |
| [`05-reload-binary-screen.md`](./05-reload-binary-screen.md) | Diagnosis of why **Reload Game** sometimes displays raw binary symbols (stale in-memory Electron `app.asar` offset table when `npm run patch` overwrites `app.asar` while the game is running). |
| [`06-redo-buildings.md`](./06-redo-buildings.md) | Diagnosis of why Redo only works on roads and not buildings (`f5Ojv` `"buildings placed"` / `"buildings deleted"` sub-records vs `redo-mod` only handling `"confirm"`). |
| [`07-pollution-propagation-scrubber.md`](./07-pollution-propagation-scrubber.md) | Confirmation of concentric center-outward pollution diffusion (`5x7Vi` + `gs8fX`) and why `eco-scrubber` zeroing cells in-place stops factory emissions from propagating past its radius. |
| [`08-multilane-road-lag.md`](./08-multilane-road-lag.md) | Diagnosis of remaining multilane-to-multilane road connection lag (`placementCache` key misses on `money` & unquantized `endPoint`, plus `h0N8S` / `WppSZ` / `gSON2` / `E71eU` overlap & glue-along recovery). |
| [`09-traffic-lights-internals.md`](./09-traffic-lights-internals.md) | API mapping of traffic light status (`5TAGW` `ParallelIntersectionMetadata`, `dcoVe` `shouldLaneShowAmber` / `canSourceLaneProceedThroughIntersection`, phase tick loop, and proposed `TrafficityMods.game` helper). |
| [`10-road-placement-constraints.md`](./10-road-placement-constraints.md) | Complete reference of road placement geometry constants, ramp/slope limits, turn/approach angles, junction chop-off formulas, glue-along/traffic-light-arm guards, and rejection reasons (`bTgKI`, `dMMfs`, `8w78C`, `h0N8S`, `E71eU`, `aIdtw`). |

---

## Shipped Bundle & Process Architecture

Trafficity is an Electron desktop application whose static frontend runs over an embedded local HTTP server (`electron/static-server.js`) bound to `http://127.0.0.1:<freePort>` with `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, and `Cross-Origin-Resource-Policy: same-origin` (required for `SharedArrayBuffer` worker parallelism).

### Key Bundles in `app.asar:/dist/`

| File | Role | Module System & Global Registry |
| :--- | :--- | :--- |
| `dist/index.html` | App entry HTML + `<script type="importmap">` mapping Parcel asset IDs (`7AXFu`, `aANHk`, `eF01f`, etc.) + `<script src="/mods-runtime/loader.js">` injected before `<script type="module" src="/transit-city-game.225ce3d0.js">`. | No CSP `<meta>` tag. |
| `dist/transit-city-game.225ce3d0.js` | Boot bundle: React (`acw62`, JSX `ayMG0`/`8rWe0`), localization strings (`4aR6e`, `9nNmt`), and router loader. | Initializes `globalThis.parcelRequireeccb`. |
| `dist/Router.89d029ab.js` | Main game bundle (~3.43 MB, 904 Parcel modules): simulation coordinator, PixiJS v8 (`Container`, `Graphics`, `Sprite`, `Texture`, `ImageSource`, `CanvasSource`), `@pixi/sound` (`8thuK`), UI components, `BUILDING_DEFINITIONS` (`4nkf2`). | Shares `globalThis.parcelRequireeccb` (exposed by `patch.mjs` as `globalThis.__trafficityRouterRequire`, wrapped by `TrafficityMods.game.requireRouterModule(id)`). |
| `dist/WebGLRenderer.e8a166f0.js` / `dist/WebGPURenderer.c3500d8a.js` / `dist/browserAll.e26ea88f.js` | Dynamically imported PixiJS v8 renderer backends. | Shared Parcel runtime. |
| `dist/car-worker.d0cd07dd.js` | Classic Web Worker (~1.41 MB): vehicle physics, parking, lane switching, intersection locking. | **Isolated IIFE** (`(()=>{ ... })()`). Has its own private Parcel `d`/`l` registry and bundled copies of building tables (`aS4Aq`, `6hect`). |
| `dist/happiness-worker.57a44d79.js` | Classic Web Worker (~1.42 MB): visitor/goods gap calculations, happiness meters, building weights. | **Isolated IIFE**. Has its own private `aS4Aq`, `6hect`, and `3baQI`. |
| `dist/pathfinding-worker.beb79cef.js` | Classic Web Worker (~1.41 MB): A*/graph route calculation & destination picking. | **Isolated IIFE**. Has its own private `aS4Aq` and `6hect`. |

### Important Patching Mechanism in Parcel (`Router.89d029ab.js`)

Every Parcel module exports getters via helper `e(...)`:

```js
function e(target, name, get, set) {
  Object.defineProperty(target, name, { get, set, enumerable: true, configurable: true });
}
```

Two rules follow from this:
1. **Never plain-assign `mod.someExport = fn`** — strict mode throws `TypeError` because only `get` is defined (no `set`). Always use **`Object.defineProperty(mod, "someExport", { value: fn, writable: true, configurable: true, enumerable: true })`** (works because `configurable: true`).
2. **Watch intra-module local calls** — inside the same Parcel module, helper functions often call the internal minified function identifier directly (e.g., `F` calling `D` inside `6whda`, or `E` calling `k` inside `XfMqf`), bypassing `t.exports`. Cross-module callers always call `(0, importedModule.exportName)(...)`, which goes through the patched property descriptor.

---

## Upcoming Investigation Queue (Not Yet Researched Here)

- UI Zoom & Accessibility addons (Dark mode globals in `dD8nW`, CSS custom properties/classes in `transit-city-game.b32ffa77.css` & `Router.4cebc423.css`, typography/boldness & root scaling).
- New in-game menus (React `Router` state in `4ZnLW`, modal/drawer hooks, `isModalDialogOpen` / `shouldBlockWorldPointer`, toolbar & pause menu DOM anchors).
