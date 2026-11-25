# 05 — Reload Game Binary / Symbol Screen

## Symptom
Clicking **Reload Game** in the `F9` Mod Manager drawer sometimes replaces the entire Electron window with raw binary gibberish (e.g. `@?D+@(...`) containing `U+FFFD` replacement characters.

## Root Cause
Electron caches the `resources/app.asar` archive header table (file path → byte offset & byte length) **in memory at process startup**.

1. Trafficity's production static server (`electron/static-server.js`) serves `dist/index.html` using `fsp.readFile(path.join(app.getAppPath(), "dist/index.html"))`.
2. When `npm run patch` (or any rebuild) overwrites `resources/app.asar` on disk **while Trafficity is still running**, the running Electron process retains the **old ASAR byte offsets**.
3. Clicking **Reload Game** requests `dist/index.html` from the still-running `prodServer`. Electron reads the **old offset/length** from the **newly written `app.asar`**, landing in the middle of a compressed binary asset (`.ogg`, `.mp4`, `.ttf`, `.png`).
4. `static-server.js` sets `Content-Type: text/html; charset=utf-8` based on the `.html` extension and sends those binary bytes to Chromium, which renders them as garbled symbols.

## Why `loadURL(prodServer.url + "/?t=...")` Did Not Eliminate It
Navigating via `mainWindow.loadURL(...)` avoids Chromium cache bugs, but `prodServer` is still inside the same Electron process with the stale in-memory ASAR header table.

## Potential Fixes
1. **Cache `dist/index.html` (or detect `app.asar` mtime change) in `electron/static-server.js` / `electron/main.js`**:
   - At server startup, record `fs.statSync(asarPath).mtimeMs`.
   - On `reload-game` IPC, if `app.asar`'s `mtimeMs` has changed since startup, relaunch Electron cleanly (`app.relaunch(); app.exit(0);`) instead of calling `loadURL` / `reloadIgnoringCache`.
2. **Operational rule**: Always close Trafficity before running `npm run patch` (or trigger a full process relaunch when `app.asar` changed).
