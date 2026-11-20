---
trigger: always_on
---

# Documentation Sync Rule

Whenever you modify a core file (`src/**`, `runtime/**`, `ui/**`, `examples/**`, `package.json`, `.github/**`) or introduce/change an API, CLI command, UI workflow, or game-hook pattern:

1. Check and update all affected documentation files before finishing:
   - `README.md` (features, CLI commands, UI workflows, setup)
   - `MODDING.md` (mod authoring patterns, examples, `settings.toml`, types)
   - `docs/api.html` (public `TrafficityMods` / `game` APIs; keep emoji-free)
   - `types/trafficity-mods.d.ts` (TypeScript/LSP declarations & JSDoc)
   - `AGENTS.md` / `GAME_BINDINGS.md` (repo architecture, game build history, keybindings)
2. Whenever the patcher or modloader version is updated (`package.json`, `runtime/loader.js`), also update the version labels in the UI (`Backend::m_modloaderVersion` fallback / header) and update `modloaderVersion` in `examples/*/mod.json` and `registry.json` if the example mods are compatible.
3. Run `npm test` (which includes `tsc -p jsconfig.json --noEmit`) after documentation and type updates.
