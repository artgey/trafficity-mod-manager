# Trafficity Sound, Image, Font, Video & File Injection — Technical Internals

This document details how Trafficity packages, serves, resolves, and plays/renders every external asset type (`ogg`, `mp3`, `wav`, `png`, `mp4`, `ttf`, `css`, `json`, `.sav`, `.js`), together with the existing mod-manager HTTP static routes and the exact injection mechanisms (no ASAR repacking required).

---

## 1. How Trafficity Serves Files (`electron/static-server.js` + `dist/index.html`)

Trafficity does **not** load game assets via `file://` URLs directly from the filesystem. Instead, `electron/static-server.js` runs an embedded Node HTTP server (`http://127.0.0.1:<freePort>`) serving directly out of `app.asar`.

### Request Routing Order in `createRequestListener`

Every HTTP request passes through these handlers **in strict top-to-bottom priority**:

1. `/api/dev-saves` -> returns sorted JSON list of dev-save IDs from `src/dev-saves/*.json`.
2. `/api/player-settings` -> `handlePlayerSettingsApi` (`settings.json`).
3. `/api/autosave-registry` -> `handleAutosaveRegistryApi` (`autosaves.json`).
4. `/api/player-saves` & `/api/player-saves/...` -> `handlePlayerSavesApi` (`.sav` gzipped JSON, `.meta`, `.png`).
5. **`handleModRequest(req, res, url)`** (injected by `src/patch.mjs` -> `src/mod-api.cjs`):
   - `GET /api/mods` (with optional `?enabled=1`)
   - `POST /api/mods/toggle`
   - `POST /api/mods/config`
   - `GET /mods-runtime/loader.js`
   - `GET /mods-runtime/mods/<modIdOrFolder>/<relativePath>` (**serves ANY file inside a mod's directory!**)
6. `GET /dev-saves/<file>` -> serves JSON saves from `src/dev-saves/`.
7. **Fallback:** serves static files from `dist/` (with SPA fallback to `dist/index.html`).

### Response Security Headers & CSP

- `dist/index.html` has **no `<meta http-equiv="Content-Security-Policy">` tag**, meaning `data:`, `blob:`, same-origin `/mods-runtime/mods/...`, CSS `@font-face`, Canvas, WebAudio, and dynamic `<script>`/`import()` are unrestricted on `http://127.0.0.1:<port>`.
- Every response (both `static-server.js` and `src/mod-api.cjs`) attaches:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp` (**strict!** Any external resource without matching `Cross-Origin-Resource-Policy` is blocked by COEP, which is why serving files from same-origin `/mods-runtime/mods/...` with `CORP: same-origin` or `blob:`/`data:` URLs works seamlessly).
  - `Cross-Origin-Resource-Policy: same-origin`

---

## 2. How Mod Asset Serving Works Today (`src/mod-api.cjs` + `runtime/loader.js`)

Without modifying a single line of the mod manager, any file placed inside a mod folder (`<modsDir>/<modFolder>/...`) is already reachable at:

```text
/mods-runtime/mods/<encodeURIComponent(mod.folder)>/<relativePath>
```
*(Or `<mod.id>` in place of `<mod.folder>` — `createModRequestHandler` matches `m.id === modIdOrFolder || m.folder === modIdOrFolder`, and guards against `..` directory traversal via `safeJoin`).*

### Current `MIME_TYPES` in `src/mod-api.cjs`

Recognized explicitly today:
- Text/Web: `.css`, `.html`, `.js`, `.json`, `.mjs`
- Audio: `.mp3` (`audio/mpeg`), `.ogg` (`audio/ogg`), `.wav` (`audio/wav`)
- Images: `.png` (`image/png`), `.svg` (`image/svg+xml`), `.webp` (`image/webp`)
- Fonts: `.ttf` (`font/ttf`)

**Gap observed in `src/mod-api.cjs`:** `.mp4`, `.webm`, `.woff`, `.woff2`, `.jpg`, `.jpeg`, `.gif`, `.toml` are **not** in `src/mod-api.cjs`'s `MIME_TYPES` table yet (so they currently fall back to `Content-Type: application/octet-stream`, unlike `electron/static-server.js` which already lists `.jpg`, `.jpeg`, `.gif`, `.woff`, `.woff2`). `.mp4` `<video>` tags and `@font-face` fonts work much more reliably when proper MIME types are returned.

### Stylesheets via `mod.json`

`runtime/loader.js` automatically injects every path listed in `mod.json`'s `"styles": ["style.css"]` array as:
```html
<link rel="stylesheet" href="/mods-runtime/mods/<folder>/style.css">
```
inside `<head>` during `loadModAssets()`.

---

## 3. Complete Inventory & Loading Mechanisms in Trafficity

Every asset URL in `dist/` is declared in `dist/index.html`'s `<script type="importmap">` and resolved in `Router.89d029ab.js` via `import.meta.resolve("<importId>")`:

### A. UI Sound Effects (`lVhdV` -> `1GCZp` -> `@pixi/sound` `8thuK`)

`lVhdV.playUiSfx(name)` plays 5 named UI sounds using **`@pixi/sound`** (`requireRouterModule("8thuK").sound`):

| SFX Name (`playUiSfx` key) | `@pixi/sound` Alias | Parcel Module -> Import ID -> File | Volume Scale (`sfxVolume/20 * scale`) |
| :--- | :--- | :--- | :--- |
| `"click"` | `"ui-sfx-click"` | `9xFTP` -> `7AXFu` -> `/click1.b4605b55.ogg` | `0.3` |
| `"placeRoad"` | `"ui-sfx-place-road"` | `9vG2f` -> `a0j25` -> `/footstep_wood_001.7d8cf8ac.ogg` | `1.5` |
| `"placeBuilding"` | `"ui-sfx-place-building"` | `9vG2f` -> `a0j25` -> `/footstep_wood_001.7d8cf8ac.ogg` | `1.5` |
| `"buildingRowCount"` | `"ui-sfx-building-row-count"` | `gG427` -> `cWnpT` -> `/impactWood_light_000.5c8c529b.ogg` | `0.15` |
| `"cityLevelUnlockReady"` | `"ui-sfx-city-level-unlock-ready"` | `93glF` -> `4xxgw` -> `/unlock.149b84fa.mp3` | `0.375` |

**How loading works (`1GCZp.loadSound`):**
1. Fetches the URL (`await fetch(t)`) and converts it to `ArrayBuffer` (unless `sound.useLegacy` is true).
2. Calls `sound.add(alias, { source: arrayBuffer, preload: true, loop: opts.loop, singleInstance: false })` — **ONLY IF `!sound.exists(alias)`!**

**Injection Consequence (Works Today):**
Because `lVhdV` checks `if (sound.exists(alias)) return`, a mod can **replace any UI sound** or **register brand-new custom SFX** directly at runtime:
```js
const { sound } = mods.game.requireRouterModule("8thuK");
const res = await fetch("/mods-runtime/mods/my-mod/assets/custom-click.ogg");
const buf = await res.arrayBuffer();
if (sound.exists("ui-sfx-click")) sound.remove("ui-sfx-click");
sound.add("ui-sfx-click", { source: buf, preload: true, loop: false, singleInstance: false });
```
Or play custom sounds respecting user volume settings via `mods.game.requireRouterModule("fifBi").getAppSettings().sfxVolume`.

---

### B. Ambient Spatial Audio (`qIEGF` + `1OD7p` -> `@pixi/sound`)

`qIEGF.createAmbientNoiseAudioController()` manages 4 stereo-panned looping `@pixi/sound` channels (using `StereoFilter` from `bvBVk`), mixed dynamically by camera zoom & road/jam proximity:

| `@pixi/sound` Alias | Parcel Module -> Import ID -> File |
| :--- | :--- |
| `"ambient-street-noise"` | `gFJJz` -> `kAKWl` -> `/street-noise.4ec33a78.wav` |
| `"ambient-highway-noise"` | `kUyXO` -> `1Fus7` -> `/highway-noise.696bd121.wav` |
| `"ambient-wind-noise"` | `fWQ3F` -> `6d3nQ` -> `/wind.2cff7fdd.wav` |
| `"ambient-traffic-jam-noise"` | `ytqvf` -> `4QCam` -> `/traffic-jam-sound.3a99efc2.wav` |

Like UI SFX, `qIEGF` checks `sound.exists(alias)` before calling `loadSound`, and loads lazily when a map initializes (playing after first `pointerdown`). Pre-registering any of these 4 aliases in `8thuK.sound` on main menu (or removing + re-adding + restarting controller) replaces ambient audio!

---

### C. Background Music Playlist (`1JlYf` `createGameMusicController`)

Music does **NOT** use `@pixi/sound` — it uses standard browser **`new Audio(url)` (`HTMLAudioElement`)** inside `createGameMusicController` (used in `Router` `4ZnLW`):

| Track ID | Parcel Module -> Import ID -> File |
| :--- | :--- |
| `"menu-bonus"` (looped on main menu) | `ek815` -> `9w7oG` -> `/trafficity-bonus-music-2.16d37c8c.mp3` |
| `"track-1"` | `fZC7i` -> `aANHk` -> `/trafficity-track-1.1993bd8c.mp3` |
| `"track-2"` | `8C6JQ` -> `9FETf` -> `/trafficity-track-2.f182bc00.mp3` |
| `"track-3"` | `4kuaX` -> `lTaqj` -> `/trafficity-track-3.121d5db0.mp3` |
| `"track-5"` | `glNYW` -> `9aqef` -> `/trafficity-track-5.84cb1d1d.mp3` |
| `"completion"` | `1yuIC` -> `5Bo4V` -> `/trafficity-completion-music.8b819a76.mp3` |

**Quirk / Timing Caveat:** The playlist array `f = [{ id: "track-1", url: t(l) }, ...]` resolves `import.meta.resolve(...)` **at module evaluation time**, BEFORE `DOMContentLoaded` mods finish async `import(...)`! Furthermore, `Router` calls `playMenuMusic()` in React's initial `useEffect`.
- **Consequence:** Overriding `fZC7i.exports` after `Router` loads won't retroactively change the already-constructed array `f`. To replace music tracks reliably, either:
  1. **Intercept `window.Audio`** (check `src` for `/trafficity-track-` or `/trafficity-bonus-music-` and swap `url` to `/mods-runtime/mods/...`), OR
  2. **Intercept at HTTP level** in `src/mod-api.cjs` before `static-server` falls through to `dist/`!

---

### D. Images, Logos & UI Tutorial Videos

#### Static UI Images in `app.asar:/dist/` (all `.png`):
- `bnTHB` (`c0459`): `/tutorial-menu-dark.2fbdcdf2.png`
- `91HWM` (`fOeu6`): `/tutorial-menu-light.7be8fa49.png`
- `9SewM`: `/textmark-black.05e59693.png`
- `cxUMf`: `/textmark-white.c31159bd.png`
- `4Q4Dc` (`2Mf3B`): `/onramp-logo-black.70c2e051.png`
- `aJfsq` (`lNxX2`): `/onramp-logo-white.006e0e60.png`

#### Tutorial Videos in `app.asar:/dist/` (19 `.mp4` files, used in `TutorialTipsPanel` `1KHqu` etc.):
- `add-lane.a50d9136.mp4` (`lpXSj`), `add-lane-junction.827f3fe2.mp4` (`3HdRM`), `build-bridge.55b0f88d.mp4` (`1yQE6`), `create-junction.3e3558af.mp4` (`k1Hx2`), `create-road.76a4cbad.mp4` (`1tUvK`), `curve-mode.584e7cdd.mp4` (`c13lJ`), `delete-rectangle.96760e83.mp4` (`hHG5B`), `place-building.d268c7c3.mp4` (`9uFv7`), `place-building-run.0b3ad5f0.mp4` (`fsFsY`), `place-grid.f365f42d.mp4` (`fSWyU`), `place-keep-clear.22a42345.mp4` (`AgLyT`), `place-mine.850ec1e2.mp4` (`cCVPO`), `place-fishery.54957d22.mp4` (`kLutV`), `place-roundabout.ae0861f5.mp4` (`bIlBB`), `place-traffic-lights.31ec1c7e.mp4` (`aYYvn`), `select-traffic-lights.9b6c9535.mp4` (`9LFy0`), `slip-road.5dac26f0.mp4` (`4Wdfy`), `traffic-erase.1eb7b6a7.mp4` (`cwuxt`), `overlay.779d38e3.mp4` (`1HNao`).

#### Dynamic PixiJS v8 Textures & Sprites (`Router.89d029ab.js`):
Note that Trafficity's bundled PixiJS v8 omits `@pixi/assets` (`PIXI.Assets`) and `Texture.from(...)` static helper on `Texture` (`bLlTJ`)! Instead, `bLlTJ` (`Texture`), `4rhnu` (`Sprite`), `aQPld` (`ImageSource`), and `8xl7d` (`CanvasSource`) are available:
- Draw an `HTMLImageElement` or `ImageBitmap` onto a `<canvas>` (or pass directly to `ImageSource` -> notice `ImageSource` warns and auto-converts `HTMLImageElement` to `CanvasSource` anyway).
- Construct `new Texture({ source: new CanvasSource({ resource: canvas }) })`, then `new Sprite({ texture })`.
- Works both inside world containers (`gameState.layers.*`) and custom overlays!

---

### E. Fonts & Stylesheets

`dist/transit-city-game.b32ffa77.css` defines the game's two fonts:
```css
@font-face { font-family: Lexend; src: url(lexend-font.bc91a6a1.ttf); font-weight: 300 700; }
@font-face { font-family: Geologica; src: url(geologica-font.7739bf70.ttf); font-weight: 100 900; }
```
Because mod `styles` `<link>` tags append to `<head>` **after** `transit-city-game.b32ffa77.css`, a mod stylesheet can:
1. Override `@font-face` (`font-family: Lexend` or `Geologica`) pointing `src: url("/mods-runtime/mods/<folder>/fonts/my-font.ttf")` to swap fonts game-wide without touching CSS selectors!
2. Define a custom `font-family` and apply typography/accessibility rules globally (`*`, `body`, `--font-*`).

---

### F. JSON Data Files, Dev-Saves & Player Saves

- **23 Built-in Dev-Saves (`src/dev-saves/*.json`):** Listed via `GET /api/dev-saves` (filenames without `.json`) and fetched from `GET /dev-saves/<name>.json`.
- **Player Saves (`player-saves/store.js`):** Stored compressed on disk (`.sav` gzipped JSON + `.meta` JSON + `.png` thumbnail) and accessed via `/api/player-saves/...`.
- **Custom Mod Data Files:** Any `.json`, `.toml`, `.txt`, `.csv`, `.bin`, `.wasm` inside a mod folder can be loaded directly via `fetch("/mods-runtime/mods/<folder>/data/config.json")`.

---

## 4. Three Practical Asset & File Injection Strategies

### Strategy 1: Pure Mod Runtime Assets (Works Today, Zero Loader Changes)

For **additive** assets (new building textures, custom mod UI sounds, custom fonts, custom CSS, custom JSON presets):
1. Place files inside `<modsDir>/<my-mod>/assets/...`.
2. Load from `/mods-runtime/mods/<mod.folder>/assets/...` (using `fetch`, `new Audio(...)`, `new Image()`, `@font-face`, or `styles` in `mod.json`).
3. **Optional small convenience helper for `runtime/loader.js`:** Exposing e.g. `mods.getAssetUrl(modIdOrFolder, relPath)` avoids hardcoding `/mods-runtime/mods/...` string templates inside mods.

### Strategy 2: Runtime API Interception (Works Today for SFX, Images/Sprites, Fonts, Workers)

- **UI SFX & Ambient Audio:** Replace aliases in `mods.game.requireRouterModule("8thuK").sound`.
- **Images/Logos in DOM:** Swap `<img>` `src` attributes via `MutationObserver` matching `/tutorial-menu-`, `/onramp-logo-`, `/textmark-`.
- **Sprites in World:** Wrap Pixi container builders (e.g. `XfMqf` for buildings, `hVdEj`/`84pTe` for vehicles).
- **Audio Elements (`Music`):** Wrap `window.Audio` / `HTMLAudioElement` `src` setter early. *(Caveat: mods imported after `DOMContentLoaded` run slightly after `Router` mounts initial menu music — adding an optional `"preload"` / early hook in `mod.json` would let mods run **before** `<script type="module" src="/transit-city-game...js">`!)*
- **Web Workers:** Wrap `window.Worker` (`XMLHttpRequest(..., false)` + `Blob` URL) before map load so isolated worker bundles (`car-worker`, `happiness-worker`, `pathfinding-worker`) accept injected data/modules cleanly.

### Strategy 3: HTTP Asset Override Layer in `src/mod-api.cjs` (Mod-Manager Enhancement Idea)

Look again at `electron/static-server.js` request order:
`handleModRequest(req, res, url)` runs **before** `/dev-saves/` AND **before** `dist/`!

That means `src/mod-api.cjs` is already in the exact interception bottleneck for **100% of Trafficity's external assets**. Adding a declarative `"assetOverrides"` field in `mod.json` (plus missing MIME types `.mp4`, `.webm`, `.woff`, `.woff2`, `.jpg`, `.jpeg`, `.gif`, `.wasm`) would let a resource-pack mod drop a single `mod.json` with **zero JS code** to replace:
- Any music track (`/trafficity-track-1.*.mp3` or exact path)
- Any sound effect or ambient loop (`/click1.*.ogg`, `/highway-noise.*.wav`)
- Any logo or tutorial video (`/onramp-logo-*.png`, `/place-building.*.mp4`)
- Built-in fonts (`/lexend-font.*.ttf`, `/geologica-font.*.ttf`)
- Or inject extra custom maps into `/api/dev-saves` and `/dev-saves/<id>.json`!

**Timing & Cache Note for Strategy 3:** Because `mods-config.json` / `listMods()` are read dynamically per request in `src/mod-api.cjs` (and toggling mods triggers `reloadIgnoringCache()` in `electron/main.js`), HTTP asset overrides work immediately across game reloads without ever modifying `app.asar`'s asset files or hash manifest!
