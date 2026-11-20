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
2. Run `npm test` (which includes `tsc -p jsconfig.json --noEmit`) after documentation and type updates.
