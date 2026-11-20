# Writing Mods for Trafficity

Mods are folders inside Trafficity's `mods/` directory containing a `mod.json` manifest, an ES-module JavaScript entry (`mod.js`), optional CSS (`styles`), and optional TypeScript declarations (`types.d.ts`) for IDE autocomplete.

## 1. Anatomy of a Mod

```text
my-mod/
  mod.json       # Required manifest (id, name, version, entry, forkedFrom, ...)
  mod.js         # Entry ES module (export default function(modApi, game))
  style.css      # Optional stylesheet injected into <head>
  settings.toml  # Optional user-editable settings (rendered in UI & F9 drawer)
  types.d.ts     # Optional LSP type extensions (never name this mod.d.ts)
```

### `mod.json`

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "modloaderVersion": "1.4.1",
  "author": "You",
  "description": "What the mod does.",
  "dependencies": [],
  "optionalDependencies": ["redo-mod"],
  "entry": "mod.js",
  "styles": ["style.css"]
}
```

- `dependencies` / `optionalDependencies`: Loaded before your mod in topological order so `mods.use("<service>")` is ready when your `mod.js` runs.

---

## 2. How to Use the Public API

Write your mod entry as an `export default` function (or read `window.TrafficityMods` directly):

```js
/**
 * @param {TrafficityModsApi} modApi
 * @param {TrafficityGameFacade} game
 */
export default function initializeMod(modApi, game) {
  const modConfig = modApi.getConfig("my-mod", { showBanner: true });
  game.on("ready", () => {
    if (modConfig.showBanner) {
      modApi.addOverlay("my-mod", `<div>Ready!</div>`);
    }
  });
}
```

### Core Mod Loader API (`modApi`)

- **`modApi.bindKey(combo, handler)`**
  - *What it represents:* A capture-phase keyboard shortcut registry attached to `window`.
  - *What it does:* Intercepts key presses before Trafficity's own handlers run, ignoring editable inputs (`<input>`, `<textarea>`) and synthetic keys. Returning anything other than `false` consumes the key so the base game won't also react; returning `false` lets Trafficity handle it natively.
  - *How to use it:*
    ```js
    modApi.bindKey("Alt+1", () => game.setSpeed("pause"));
    modApi.bindKey("e", () => (game.isIdle() ? true : false)); // block when idle, pass through otherwise
    ```

- **`modApi.onMouse(type, handler, options)`**
  - *What it represents:* A capture-phase pointer/mouse/wheel listener (`"mousedown"`, `"mousemove"`, `"mouseup"`, `"wheel"`, `"contextmenu"`).
  - *What it does:* Fires before Trafficity's canvas listeners and automatically skips synthetic events dispatched by `game.sendSyntheticMouse` / `game.sendSyntheticWheel` so mods never trigger their own remaps in a loop.
  - *How to use it:*
    ```js
    modApi.onMouse("wheel", (wheelEvent) => {
      if (wheelEvent.ctrlKey) return; // let zoom work
      wheelEvent.preventDefault();
      game.cycleToolbeltSlot(wheelEvent.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    ```

- **`modApi.addOverlay(id, content)`**
  - *What it represents:* A managed DOM container (`<div id="tmod-overlay-<id>">`) appended to `document.body`.
  - *What it does:* Mounts or updates your custom HUD HTML or `Node` and automatically stops `mousedown`, `mouseup`, `pointerdown`, `pointerup`, `click`, `dblclick`, `contextmenu`, and `wheel` propagation so clicking or scrolling your overlay **won't interact with things behind the UI**.
  - *How to use it:*
    ```js
    const panel = document.createElement("div");
    panel.innerHTML = `<button id="my-btn">Toggle</button>`;
    panel.querySelector("#my-btn").addEventListener("click", () => game.cancel());
    modApi.addOverlay("my-hud", panel);
    ```

- **`modApi.getConfig(id, defaults)` / `await modApi.setConfig(id, config)`**
  - *What it represents:* Your mod's persisted configuration store.
  - *What it does:* `getConfig` returns saved values from your mod's `settings.toml` (or `mods-config.json` if there is no `settings.toml`) merged over `defaults`. `setConfig` persists updated values via `POST /api/mods/config`.
  - *How to use it:*
    ```js
    const modConfig = modApi.getConfig("my-mod", { speed: 2, showHud: true });
    await modApi.setConfig("my-mod", { ...modConfig, speed: 4 });
    ```

- **`modApi.provide(name, api)` / `modApi.use(name)`**
  - *What it represents:* A lightweight inter-mod service locator.
  - *What it does:* Lets a library mod register a named API (`provide`) so other mods that declare it in `dependencies` / `optionalDependencies` can look it up (`use`, returning `null` if not installed or disabled).
  - *How to use it:*
    ```js
    // In provider mod:
    modApi.provide("redo", { redo: () => true, canRedo: () => false });
    // In consumer mod:
    const redoService = modApi.use("redo");
    redoService?.redo();
    ```

### Game Facade (`game`)

- **`game.on(event, handler)`**
  - *What it represents:* High-level game lifecycle and state-change event emitter (`"ready"`, `"cursorModeChange"`, `"worldChange"`, `"roadPlaced"`).
  - *What it does:* Emits `"ready"` once `gameState` / `undoModule` are initialized (or via microtask if already ready), and lazily watches cursor mode, `worldRevision`, and undo entries only while listeners are subscribed. Returns an unsubscribe function `() => void`.
  - *How to use it:*
    ```js
    const stopWatching = game.on("cursorModeChange", (mode, previousMode) => {
      console.log("Tool changed:", previousMode, "->", mode);
    });
    ```

- **`game.*` helpers**
  - *What they represent:* A stable wrapper over Trafficity's DOM toolbar, camera/world projection, audio, and internal Parcel modules.
  - *What they do:*
    - **Toolbar & actions:** `pressButton`, `isButtonSelected`, `getToolbeltSlots`, `selectToolbeltSlot`, `cycleToolbeltSlot`, `watchToolbelt`, `addButtonHint`, `setSpeed`, `undo`, `cancel`, `playSfx`.
    - **State & coordinates:** `getCursorMode`, `isIdle`, `getCameraState`, `worldToScreen`, `screenToWorld`, `getConstants`, `getGameRelease`.
    - **Synthetic input & advanced internals:** `sendSyntheticMouse`, `sendSyntheticWheel`, `getUndoApi`, `getSnapApi`, `configureSnapSearch`, `requireRouterModule`.

- **`modApi.buildings`** (`CustomBuilding`, `register`, `get`, `list`)
  - *What it represents:* A declarative custom-building registry that injects new building types into both Trafficity's main-thread Parcel modules and isolated simulation Web Workers (`car-worker`, `happiness-worker`, `pathfinding-worker`).
  - *How to use it:* Call `modApi.buildings.register({ type, name, buildingCategory, width, depth, getExtrusions, defaultQuota, onPlace, onRenderWorld, ... })` during mod setup. See [`examples/eco-scrubber-mod/mod.js`](examples/eco-scrubber-mod/mod.js) for a working example.

### Direct `globalThis.__trafficity*` Access

We recommend starting with `modApi` and `game.*` because they are the simplest, cleanest way to write a mod and stay compatible across game updates. That said, if you know what you're doing and want direct access to the underlying `globalThis.__trafficity*` bridges populated by [src/patch.mjs](src/patch.mjs), they remain available at runtime.

---

## 3. Example Mods Walkthrough

- **[`examples/toolbelt-hotkeys-mod`](examples/toolbelt-hotkeys-mod/mod.js)**:
  - Uses `game.watchToolbelt(...)` + `game.addButtonHint(...)` to annotate toolbar buttons.
  - Reads configurable keybindings from [`settings.toml`](examples/toolbelt-hotkeys-mod/settings.toml) via `modApi.getConfig("toolbelt-hotkeys")`.
  - Binds `1`–`0`, `Alt+1`/`2`/`3`, `q`, `e` (conditional pass-through), and mouse wheel/drag/side-button shortcuts.
  - Consumes `modApi.use("redo")` when `redo-mod` is enabled.
  - Extends `TrafficityGameFacade` in [`types.d.ts`](examples/toolbelt-hotkeys-mod/types.d.ts) with `addSlotBadge`.
- **[`examples/redo-mod`](examples/redo-mod/mod.js)**:
  - Waits for `game.on("ready", ...)` and reads `game.getUndoApi()` to wrap `applyUndoSubRecord` / `undoLastAction` and maintain a Redo stack.
  - Plays `"placeRoad"` SFX via `game.playSfx(...)` and exposes `{ redo, canRedo, clear }` via `modApi.provide("redo", ...)`.
  - Declares its service type in [`types.d.ts`](examples/redo-mod/types.d.ts) so dependent mods get autocomplete on `modApi.use("redo")`.
- **[`examples/measuring-grid-mod`](examples/measuring-grid-mod/mod.js)**:
  - Uses `game.on("ready" / "cursorModeChange", ...)` and reads `game.getCameraState()` and `game.getConstants()` (`laneWidth`, `lanePointSpacing`) to render a world-aligned grid canvas.
  - Mounts a HUD whose mouse/wheel events call `e.stopPropagation()` so clicking HUD buttons never triggers road placement.
- **[`examples/snap-perf-fix-mod`](examples/snap-perf-fix-mod/mod.js)**:
  - Uses `game.on("ready", ...)` and `game.configureSnapSearch({ maxSteps, stride, suppressLog })` alongside `game.getSnapApi()` memoization.

## 4. `settings.toml`, Scaffolding, Forking & Packaging

- **Settings (`settings.toml`):** Declare `[settingKey]` tables with `label`, `description`, `type` (`"boolean"`, `"number"`, `"string"`, `"select"`), `options`, and `value` (or flat `key = value`). Editable directly on disk, in the `F9` in-game drawer, or in the Qt6 UI **Settings** dialog.
- **Create, Fork, Zip & Publish:** Use the **Mod Studio** tab in `npm run app` (or `npm run new-mod <id>`, `npm run fork-mod <mod>`, `npm run pack-mod <dir>`). Forked mods automatically record `forkedFrom` and `lineage` traceback metadata in `mod.json` and `registry.json` exports, and unmodified mods are marked **Unedited** until you customize `mod.js`, `mod.json`, or `style.css`.

---

## 5. LSP, Autocomplete & Extending Types

- Repo-wide JS LSP is configured in [`jsconfig.json`](jsconfig.json) with base types in [`types/trafficity-mods.d.ts`](types/trafficity-mods.d.ts).
- When installing mods via `npm run install-mod` (or `src/registry.mjs`), `jsconfig.json` and `.tmod-types/trafficity-mods.d.ts` are also provisioned in your `mods/` folder.
- To add types for a service or `extendGame()` helper in your mod, create `types.d.ts` (never `mod.d.ts`, which shadows `mod.js`):

```ts
export {};

declare global {
  interface TrafficityServices {
    myService: {
      ping(): string;
    };
  }
  interface TrafficityGameFacade {
    myHelper(): void;
  }
}
```

For the full API reference, open [`docs/api.html`](docs/api.html) (or click **API Docs** in `npm run app`).

---

## 6. Debugging Mods

- **Health Check & Manifest Validation:** Run `npm run health` (or click the **Health** badge in the desktop UI) to verify `app.asar` hooks, `mod.json` syntax, `settings.toml`, missing `entry`/`styles` files, and `dependencies`.
- **In-Game Console & Live Inspection:** Prefix logs with your mod ID (`console.log("[my-mod]", ...)`). In DevTools / the renderer console, inspect loaded mods and live state directly:
  ```js
  TrafficityMods.getMods();
  TrafficityMods.game.getCursorMode();
  TrafficityMods.game.getCameraState();
  TrafficityMods.game.getUndoApi();
  ```
- **Missing Dependencies or Load Errors:** Press `F9` in-game — mods with invalid manifests or missing required dependencies are highlighted in red with the exact reason.
- **Fast Iteration:** After editing `mod.js` or `style.css` in your `mods/` folder, click **Reload Game** inside the `F9` drawer to reload without restarting Steam.
- **Type & Unit Checks:** Run `npm run typecheck` (`tsc -p jsconfig.json --noEmit`) to catch typos against [`types/trafficity-mods.d.ts`](types/trafficity-mods.d.ts), and `node --test` on your `mod.test.mjs` file with mocked `window`/`document` globals.
