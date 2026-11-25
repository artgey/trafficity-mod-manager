---
name: mod-dx-audit
description: Audit runtime/, examples/, types/, and docs/ for cryptic game-internal leaks (raw Parcel IDs, requireRouterModule/requireModule in examples, untyped unknown/any returns in trafficity-mods.d.ts, and missing high-level domain wrappers).
---

# Modding API & Developer-Experience (DX) Audit Skill

Run this audit whenever adding new APIs to `runtime/loader.js` or creating/updating mods in `examples/`.

## Audit Checklist

### 1. Scan for Raw Internal Leaks in `examples/` and `runtime/`
Search for cryptic Parcel IDs, raw internal bridges, and internal module names leaking into example mods:

```bash
rg -n "requireRouterModule|requireModule|__trafficity" examples/ runtime/
```

**Pass Criteria:**
- **`examples/*/*.js`:** Zero `requireRouterModule` calls, zero raw 5-character Parcel IDs, and zero `globalThis.__trafficity*` reads. Example mods should only use self-explanatory domain methods on `mods.*` / `game.*` (e.g., `game.setSelectionRadiusRing(...)`, `game.addBuildingTooltipLine(...)`, `game.onPollutionDiffusion(...)`).
- **`runtime/loader.js`:** Any Parcel IDs live exclusively inside `ROUTER_MODULES` (`game.MODULES`) and are accessed internally via `ROUTER_MODULES.*`.

### 2. Check TypeScript Autocomplete Coverage (`types/trafficity-mods.d.ts` & `examples/*/mod.js`)
Inspect `types/trafficity-mods.d.ts` and `examples/*/mod.js` for unannotated fields or untyped parameters/returns:

```bash
rg -n "\bany\b" types/trafficity-mods.d.ts
rg -n "export default" examples/*/mod.js
```

- **Every** property and method on **every** public interface in `types/trafficity-mods.d.ts` (including helper/domain interfaces like `TrafficitySaveState`, `TrafficityBuildingRecord`, `TrafficityBuildingDefinition`, `TrafficityPollutionGrid`, `TrafficityPixiGraphics`, etc.) **must** have a `/** ... */` JSDoc annotation so IDE hover tooltips explain every attribute.
- Public types in `types/trafficity-mods.d.ts` should use concrete interfaces (`TrafficityGameState`, `TrafficitySaveState`, `TrafficityBuildingRecord`, `TrafficityPollutionGrid`, `TrafficityPixiGraphics`, etc.) instead of bare `any`.
- Every `export default` mod entrypoint in `examples/*/mod.js` **must** be typed via `mods.defineMod(...)` or JSDoc `@param {TrafficityModsApi} mods` / `@param {TrafficityGameFacade} game` so `mods` and `game` are never implicitly `any`.
- `game.requireModule<K extends TrafficityModuleName>(name: K)` **must** return `TrafficityModuleMap[K] | null` (typed per module) rather than `unknown`.

### 3. Check Cognitive Load ("Can a Modder Understand This Without Reading `app.asar`?")
For every hook or helper used in `examples/`:
- Ask: *"Would a modder know what module `X` does or which module owns function `Y` without reverse-engineering `Router.*.js`?"*
- If the answer is **no** (e.g., knowing `eqevD` owns selection rings, `eAKuV` + `ayMG0` own building tooltips, `gs8fX` owns pollution diffusion, or `cghJ1` owns zoom stroke width), **wrap it as a named domain helper on `game.*`** in `runtime/loader.js` and document it in `types/trafficity-mods.d.ts`, `docs/api.html`, and `MODDING.md`.

### 4. Verify After Fixes
Run:
```bash
npm test
```
Ensure `tsc -p jsconfig.json --noEmit` and all unit tests pass with `0` failures.
