---
name: trafficity-update-sync
description: End-to-end workflow for inspecting a new Trafficity Steam update in app.asar, diffing changed bundles/Parcel modules against app.asar.bak, verifying patcher hooks and loader/example module IDs, re-patching app.asar, running health/tests, and syncing AGENTS.md.
---

# Trafficity Game Update & Sync Workflow

Use this skill whenever Trafficity receives a Steam update (or when `node src/patch.mjs --status` shows `"patched": false` with a new `gameRelease` or `routerFile`).

## 1. Check Current Status & Release Metadata (Read-Only)

Run the patch status check and inspect `dist/error-reporting.json` + `/dist/` JS/CSS/HTML files inside `app.asar`:

```bash
node src/patch.mjs --status
```

```bash
node -e '
import("./src/patch.mjs").then(({ resolveDefaultAsarPath, inspectAsarStatus }) => {
  const asar = require("@electron/asar");
  const asarPath = resolveDefaultAsarPath();
  console.log(inspectAsarStatus(asarPath));
  console.log("error-reporting.json:", asar.extractFile(asarPath, "dist/error-reporting.json").toString("utf8"));
  console.log("dist files:", asar.listPackage(asarPath).filter(f => f.startsWith("/dist/") && /\.(js|css|html|json)$/.test(f)));
});
'
```

## 2. Diff Against `app.asar.bak` (What Changed in the Game)

If `app.asar.bak` exists from the previous game version, compare added/removed files, `electron/*.js` changes, and Parcel module diffs in `dist/Router.*.js`:

```bash
node -e '
const asar = require("@electron/asar");
const newAsar = "/home/dyri0n/.local/share/Steam/steamapps/common/Trafficity/resources/app.asar";
const oldAsar = newAsar + ".bak";
const oldFiles = asar.listPackage(oldAsar);
const newFiles = asar.listPackage(newAsar);
console.log("Added:", newFiles.filter(f => !oldFiles.includes(f)));
console.log("Removed:", oldFiles.filter(f => !newFiles.includes(f)));

const oldRouter = oldFiles.find(f => /^\/dist\/Router\.[^.]+\.js$/.test(f)).slice(1);
const newRouter = newFiles.find(f => /^\/dist\/Router\.[^.]+\.js$/.test(f)).slice(1);
const parseMods = (src) => {
  const re = /r\("([^"]+)",function\(/g;
  const list = [];
  let m;
  while ((m = re.exec(src)) !== null) list.push({ id: m[1], start: m.index });
  return new Map(list.map((entry, i) => [entry.id, src.slice(entry.start, i + 1 < list.length ? list[i + 1].start : src.length)]));
};
const oldMods = parseMods(asar.extractFile(oldAsar, oldRouter).toString("utf8"));
const newMods = parseMods(asar.extractFile(newAsar, newRouter).toString("utf8"));
for (const [id, body] of newMods) {
  if (!oldMods.has(id)) console.log("NEW module:", id, [...body.matchAll(/e\([^,]+,"([^"]+)"/g)].map(m => m[1]));
  else if (oldMods.get(id) !== body) console.log("CHANGED module:", id, `${oldMods.get(id).length}->${body.length}`, [...body.matchAll(/e\([^,]+,"([^"]+)"/g)].map(m => m[1]).slice(0, 6));
}
for (const id of oldMods.keys()) if (!newMods.has(id)) console.log("REMOVED module:", id);
'
```

## 3. Dry-Run Patchers & Verify Parcel Module IDs

Before modifying `app.asar`, dry-run all 5 file patchers (`patchStaticServerSource`, `patchPreloadSource`, `patchMainSource`, `patchIndexHtmlSource`, `patchRouterSource` + `verifyRouterHooks`) and verify every Parcel module ID referenced by `runtime/loader.js` and `examples/`:

- **Main-thread Router module IDs (`runtime/loader.js` & `examples/`):**
  `4nkf2`, `aUbb1`, `fFJcz`, `jnB0a`, `2cbpn`, `6whda`, `gh1Od`, `XfMqf`, `eicwU`, `3cebA`, `4rhnu`, `bLlTJ`, `8xl7d`, `5x7Vi`, `d9GJQ`, `bTgKI`, `f5Ojv`, `lVhdV` (plus progression modules `aigC5`, `a3oY4`, `9colC`).
- **Worker module IDs (`car-worker`, `happiness-worker`, `pathfinding-worker`):**
  Bootstrap `,l("fHJ87")`, plus `aS4Aq` (`getBuildingDefinition`), `6hect` (`buildingHasGetVisitedNeed`), and `3baQI` (`getBuildingCarCountSpec` in `happiness-worker`).

If any `REQUIRED_ROUTER_HOOKS` check or module ID fails:
1. Search the new `Router.*.js` / worker bundle by export symbol name (e.g. `e(t.exports,"BUILDING_DEFINITIONS"` or `Building definition not found for type`) to find the new Parcel ID or minified pattern.
2. Fix `src/patch.mjs` regexes (using `$1`, `$2` captures — never hardcoding single-letter minified names) or update module IDs in `runtime/loader.js` / `examples/` before patching.

## 4. Version Bump Assessment & Interactive Confirmation

Assess whether the modloader version (`MAJOR.MINOR.PATCH`) needs a bump based on Steps 2–3 and any uncommitted modloader changes:

- **Major (`X.0.0`):** Do **not** change.
- **Minor (`1.X.0`):** Recommend when the game update **breaks** patcher hooks / Parcel module IDs or **adds major new game systems** requiring modloader adaptation.
- **Patch (`1.4.X`):** Recommend when **fixing bugs** or **adding new features** to the modloader release (e.g., new `TrafficityMods` APIs or fixes alongside a non-breaking game update).
- **No bump:** Recommend when the game update is **100% non-breaking** and no modloader code changed.

**Always present the findings in chat first** (what changed in `app.asar`, whether hooks/module IDs broke, and whether modloader features/fixes were added) and **ask the user interactively (`ask_question`)** before bumping:
- Options: Recommended choice (`No bump` / `Patch` / `Minor`) + the alternatives.
- If bumping, update all version references across `package.json`, `runtime/loader.js` (`api.version`), `ui/Backend.h` (`m_modloaderVersion`), `registry.json`, and `examples/*/mod.json` (plus any version assertions in tests, and rebuild `ui` if `ui/Backend.h` changed).

## 5. Patch `app.asar` & Run Full Verification

```bash
npm run patch
npm run status
npm run health
npm test
```

Ensure:
- `npm run patch` refreshes `app.asar.bak` with the new stock `app.asar`, reports `9/9` hooks present, and syncs bundled `examples/` mods via `syncExampleMods()` (deduplicating matching `mod.json` `id` folders, replacing outdated/modified example code while preserving user `settings.toml` configs, and skipping unchanged ones).
- `npm run health` passes.
- `npm test` (`tsc -p jsconfig.json --noEmit && node --test test/*.test.mjs examples/*/*.test.mjs`) passes with `0` failures.

## 6. Sync Documentation

1. Append the new build entry under **Parcel Update History & Resilience** in `AGENTS.md` (release string, `Router.*.js` hash, notable new/changed modules, hook & module-ID verification status).
2. If any public APIs, keybindings, or example mods changed, sync `MODDING.md`, `GAME_BINDINGS.md`, `docs/api.html`, and `types/trafficity-mods.d.ts`.
