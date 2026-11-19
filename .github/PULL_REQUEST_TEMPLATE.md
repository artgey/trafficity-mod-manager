### Submitting a Mod to the Community Registry

1. Host your mod `.zip` on a public **GitHub Release** in your own repository (the `.zip` should contain `mod.json` at its root or inside a single folder).
2. Add your entry to `registry.json` with:
   - `id`, `name`, `version`, `author`, `description`
   - `dependencies` / `optionalDependencies` (if any)
   - `downloadUrl` (direct `.zip` link from your GitHub Release)
   - `sha256` (optional but recommended: `sha256sum your-mod.zip`)
3. Open a Pull Request!

#### Checklist
- [ ] `mod.json` is valid and `id` is unique in `registry.json`
- [ ] Tested locally with `node --test` (or in-game via `F9`)
- [ ] `downloadUrl` points to a public GitHub Release `.zip`
