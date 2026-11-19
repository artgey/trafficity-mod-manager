# Writing Mods for Trafficity

Mods are folders inside Trafficity's `mods/` directory containing a `mod.json` manifest, an ES-module JavaScript entry (`mod.js`), optional CSS (`styles`), and optional TypeScript declarations (`types.d.ts`) for IDE autocomplete.

## 1. Anatomy of a Mod

```text
my-mod/
  mod.json     # Required manifest
  mod.js       # Entry ES module
  style.css    # Optional stylesheet injected into <head>
  types.d.ts   # Optional LSP type extensions (never name this mod.d.ts)
```

### `mod.json`

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
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

## 2. Public API vs `globalThis.__trafficity*`

Write your mod entry as an `export default` function (or use `window.TrafficityMods`):

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

Always prefer `modApi` (`window.TrafficityMods`) and `game`:

- **`modApi.bindKey(combo, handler)`** — Capture-phase keyboard shortcuts (`"Alt+1"`, `"Shift+Delete"`, `"q"`). Return `false` to let Trafficity handle the key natively.
- **`modApi.onMouse(type, handler, options)`** — Capture-phase mouse/wheel/contextmenu hooks (automatically ignores synthetic events).
- **`modApi.addOverlay(id, content)`** — Mounts an isolated HUD/panel (`#tmod-overlay-<id>`) that stops click/wheel propagation so clicking your UI won't place roads.
- **`modApi.getConfig(id, defaults)` / `modApi.setConfig(id, config)`** — Read/write `settings.toml` or `mods-config.json` with default fallbacks.
- **`modApi.provide(name, api)` / `modApi.use(name)`** — Share services between mods.
- **`game.*`** — Stable wrapper over Trafficity internals (`on`, `pressButton`, `isButtonSelected`, `selectToolbeltSlot`, `cycleToolbeltSlot`, `getCursorMode`, `isIdle`, `sendSyntheticMouse`, `sendSyntheticWheel`, `watchToolbelt`, `addButtonHint`, `playSfx`, `setSpeed`, `undo`, `cancel`, `getUndoApi`, `getSnapApi`, `configureSnapSearch`, `getCameraState`, `worldToScreen`, `screenToWorld`, `getConstants`).
  - **`game.on(event, handler)`** — Subscribe to `"ready"`, `"cursorModeChange"`, `"worldChange"`, or `"roadPlaced"` without polling or knowing internal bundle symbols. Returns an unsubscribe function.

### Should mods touch `globalThis.__trafficity*` directly?

**No — always use the wrapped `mods.game.*` API** (`getCursorMode()`, `isIdle()`, `getCameraState()`, `getUndoApi()`, `getSnapApi()`, `configureSnapSearch()`, `playSfx()`, `requireRouterModule()`). The underlying `globalThis.__trafficity*` variables are internal bridges between [src/patch.mjs](src/patch.mjs) and [runtime/loader.js](runtime/loader.js) and are intentionally omitted from the public TypeScript definitions so mods stay simple and resilient across game updates.

---

## 3. Example Mods Walkthrough

- **[`examples/toolbelt-hotkeys-mod`](examples/toolbelt-hotkeys-mod/mod.js)**:
  - Uses `game.watchToolbelt(...)` + `game.addButtonHint(...)` to annotate toolbar buttons.
  - Binds `1`–`0`, `Alt+1`/`2`/`3`, `q`, `e` (conditional pass-through), and mouse wheel/drag/side-button shortcuts.
  - Consumes `mods.use("redo")` when `redo-mod` is enabled.
  - Extends `TrafficityGameFacade` in [`types.d.ts`](examples/toolbelt-hotkeys-mod/types.d.ts) with `addSlotBadge`.
- **[`examples/redo-mod`](examples/redo-mod/mod.js)**:
  - Reads `game.getUndoApi()` to wrap `applyUndoSubRecord` / `undoLastAction` and maintain a Redo stack.
  - Plays `"placeRoad"` SFX via `game.playSfx(...)` and exposes `{ redo, canRedo, clear }` via `mods.provide("redo", ...)`.
  - Declares its service type in [`types.d.ts`](examples/redo-mod/types.d.ts) so dependent mods get autocomplete on `mods.use("redo")`.
- **[`examples/measuring-grid-mod`](examples/measuring-grid-mod/mod.js)**:
  - Reads `game.getCameraState()` and `game.getConstants()` (`laneWidth`, `lanePointSpacing`) to render a world-aligned grid canvas.
  - Mounts a HUD whose mouse/wheel events call `e.stopPropagation()` so clicking HUD buttons never triggers road placement.
- **[`examples/snap-perf-fix-mod`](examples/snap-perf-fix-mod/mod.js)**:
  - Wraps `game.getSnapApi().snapModule.findBestPointSnap` with per-frame memoization and configures `__trafficityMaxSnapSearchSteps` / `__trafficitySnapSearchStride` / `__trafficitySuppressSnapLog`.

---

## 4. LSP, Autocomplete & Extending Types

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
