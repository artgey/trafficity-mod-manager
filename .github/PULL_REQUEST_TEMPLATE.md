### Submitting a Mod to the Community Registry

1. Package your mod locally using `npm run pack-mod <mod-dir>` (or **Pack & Publish** in Mod Studio). This builds `<id>.zip` and prints a ready-to-paste `registry.json` entry with `sha256` and `modloaderVersion`.
2. Upload `<id>.zip` to a public **GitHub Release** in your repository.
3. Paste the generated entry into `registry.json` (updating `downloadUrl` to your GitHub Release `.zip` link) and open a Pull Request!

#### Checklist
- [ ] `mod.json` is valid (`id`, `name`, `version`, `modloaderVersion`) and `id` is unique in `registry.json`
- [ ] Tested locally with `node --test` (or in-game via `F9`)
- [ ] `downloadUrl` points to a public GitHub Release `.zip` matching `sha256`
