# Trafficity Mod Manager

Lightweight in-game Mod Manager, pre-bundle Mod Loader, and `app.asar` patcher for **Trafficity** (Steam App ID `5185750`).

## Quick Start

```bash
cd ~/code/trafficity-mod-manager
npm install
npm run patch
```

To revert Trafficity back to stock:

```bash
npm run restore
```

(If Steam updates Trafficity, simply run `npm run patch` again. Your mods in `AppData/Roaming/Trafficity/mods` are preserved.)

## In-Game Usage

- Press **`F9`** (or click the **`Mods`** pill in the bottom-right corner) to open the Mod Manager drawer.
- Toggle mods on/off, click **Open Mods Folder**, and click **Reload Game** to apply changes.

## Easy Mod Format

Create a folder inside `mods/` (e.g., `arrow-pan-mod/`) containing a `mod.json`:

```json
{
  "id": "arrow-pan-mod",
  "name": "Arrow Keys Camera Pan",
  "version": "1.0.0",
  "author": "You",
  "description": "Remaps Arrow keys to WASD.",
  "keybindings": {
    "ArrowUp": "KeyW",
    "ArrowDown": "KeyS",
    "ArrowLeft": "KeyA",
    "ArrowRight": "KeyD"
  },
  "entry": "mod.js",
  "styles": ["style.css"]
}
```

- **`keybindings`**: Declarative `fromCode -> toCode` key remapping (zero JS needed).
- **`entry`**: Optional ES module (`mod.js`) with access to `window.TrafficityMods`:
  - `TrafficityMods.remapKey(fromCode, toCode)`
  - `TrafficityMods.bindKey(combo, handler)` (e.g., `"Ctrl+R"`, `"Space"`)
  - `TrafficityMods.onMouse(type, handler)`
  - `TrafficityMods.getConfig(modId)` / `TrafficityMods.setConfig(modId, obj)`
  - `TrafficityMods.addOverlay(id, htmlOrNode)`
