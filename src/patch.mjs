import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const STEAM_APP_ID = "5185750";

export const getCandidateSteamRoots = () => {
    if (process.platform === "win32") {
        const roots = [];
        if (process.env["ProgramFiles(x86)"]) roots.push(path.join(process.env["ProgramFiles(x86)"], "Steam"));
        if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, "Steam"));
        roots.push("C:\\Program Files (x86)\\Steam");
        return [...new Set(roots)];
    }
    const home = os.homedir();
    return [
        path.join(home, ".local", "share", "Steam"),
        path.join(home, ".steam", "steam"),
        path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    ];
};

export const resolveDefaultAsarPath = () => {
    if (process.env.TRAFFICITY_GAME_DIR) {
        return path.resolve(process.env.TRAFFICITY_GAME_DIR, "resources", "app.asar");
    }
    const roots = getCandidateSteamRoots();
    for (const root of roots) {
        const candidate = path.join(root, "steamapps", "common", "Trafficity", "resources", "app.asar");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return path.join(roots[0], "steamapps", "common", "Trafficity", "resources", "app.asar");
};

export const resolveDefaultModsDir = () => {
    if (process.env.TRAFFICITY_MODS_DIR) {
        return path.resolve(process.env.TRAFFICITY_MODS_DIR);
    }
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appData, "Trafficity", "mods");
    }
    const roots = getCandidateSteamRoots();
    for (const root of roots) {
        const pfx = path.join(root, "steamapps", "compatdata", STEAM_APP_ID, "pfx");
        if (fs.existsSync(pfx)) {
            return path.join(pfx, "drive_c", "users", "steamuser", "AppData", "Roaming", "Trafficity", "mods");
        }
    }
    return path.join(
        roots[0],
        "steamapps",
        "compatdata",
        STEAM_APP_ID,
        "pfx",
        "drive_c",
        "users",
        "steamuser",
        "AppData",
        "Roaming",
        "Trafficity",
        "mods",
    );
};

const DEFAULT_ASAR_PATH = resolveDefaultAsarPath();

const MARKER = "/* TRAFFICITY_MOD_MANAGER_PATCH */";

export const patchStaticServerSource = (source) => {
    if (source.includes(MARKER)) {
        return source;
    }

    const importAnchor = 'const http = require("node:http");';
    if (!source.includes(importAnchor)) {
        throw new Error("Could not find http import anchor in electron/static-server.js");
    }

    let out = source.replace(
        importAnchor,
        `${MARKER}\n${importAnchor}\nconst { createModRequestHandler } = require("./mod-api.cjs");\nconst { getPlayerSavesDir: getPlayerSavesDirForMods } = require("../player-saves/store");`,
    );

    const listenerAnchor = "const createRequestListener = (rootDir) => {";
    if (!out.includes(listenerAnchor)) {
        throw new Error("Could not find createRequestListener anchor in electron/static-server.js");
    }

    out = out.replace(
        listenerAnchor,
        `${listenerAnchor}\n    const handleModRequest = createModRequestHandler({ rootDir, getPlayerSavesDir: getPlayerSavesDirForMods });`,
    );

    const devSavesAnchor = 'if (url.pathname.startsWith("/dev-saves/")) {';
    if (!out.includes(devSavesAnchor)) {
        throw new Error("Could not find /dev-saves/ anchor in electron/static-server.js");
    }

    out = out.replace(
        devSavesAnchor,
        `if (await handleModRequest(req, res, url)) {\n                return;\n            }\n\n            ${devSavesAnchor}`,
    );

    return out;
};

export const patchPreloadSource = (source) => {
    if (source.includes(MARKER)) {
        return source;
    }

    const anchor = "clearSteamAchievements: (names) => {";
    const endAnchor = "    },\n});";
    const idx = source.indexOf(anchor);
    if (idx === -1) {
        throw new Error("Could not find clearSteamAchievements anchor in electron/preload.js");
    }
    const closeIdx = source.indexOf(endAnchor, idx);
    if (closeIdx === -1) {
        throw new Error("Could not find trafficityDesktop closing brace in electron/preload.js");
    }

    const insertion = `    },\n    ${MARKER}\n    openModsFolder: () => {\n        return ipcRenderer.invoke("open-mods-folder");\n    },\n    reloadGame: () => {\n        ipcRenderer.send("reload-game");\n    },\n});`;
    return source.slice(0, closeIdx) + insertion + source.slice(closeIdx + endAnchor.length);
};

export const patchMainSource = (source) => {
    if (source.includes(MARKER)) {
        return source;
    }

    const anchor = "main();";
    const idx = source.lastIndexOf(anchor);
    if (idx === -1) {
        throw new Error("Could not find main() anchor in electron/main.js");
    }

    const ipcBlock = `${MARKER}
const { resolveModsDir } = require("./mod-api.cjs");
const toWineHostPath = (winPath) => {
    if (/^[a-zA-Z]:[\\\\/]/.test(winPath)) {
        const drive = winPath[0].toLowerCase();
        const rest = winPath.slice(3).replace(/\\\\/g, "/");
        if (drive === "z") {
            return "/" + rest;
        }
        if (drive === "c" && process.env.WINEPREFIX) {
            return process.env.WINEPREFIX.replace(/\\/$/, "") + "/drive_c/" + rest;
        }
    }
    return null;
};
ipcMain.handle("open-mods-folder", async () => {
    const modsDir = await resolveModsDir(getPlayerSavesDir);
    const isWine =
        process.platform === "win32" &&
        Boolean(process.env.WINEPREFIX || process.env.STEAM_COMPAT_DATA_PATH);
    if (isWine) {
        return {
            ok: false,
            wine: true,
            modsDir,
            hostPath: toWineHostPath(modsDir),
        };
    }
    const err = await shell.openPath(modsDir);
    return {
        ok: !err,
        wine: false,
        modsDir,
        hostPath: process.platform === "linux" ? modsDir : null,
        error: err || null,
    };
});
ipcMain.on("reload-game", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
    }
});

`;
    return source.slice(0, idx) + ipcBlock + source.slice(idx);
};

export const patchIndexHtmlSource = (source) => {
    if (source.includes("/mods-runtime/loader.js")) {
        return source;
    }

    const anchor = '<script type="module"';
    if (!source.includes(anchor)) {
        throw new Error("Could not find <script type=\"module\" anchor in dist/index.html");
    }

    return source.replace(anchor, `<script src="/mods-runtime/loader.js"></script> ${anchor}`);
};

export const REQUIRED_ROUTER_HOOKS = [
    ["routerRequire", "__trafficityRouterRequire="],
    ["playUiSfx", "__trafficityPlayUiSfx="],
    ["undoModule", "__trafficityUndoModule="],
    ["undoHistory", "__trafficityUndoHistory="],
    ["undoDeps", "__trafficityUndoDeps="],
    ["gameState", "__trafficityGameState="],
    ["snapModule", "__trafficitySnapModule="],
    ["snapSearchBounds", "__trafficityMaxSnapSearchSteps"],
    ["snapLogGuard", "__trafficitySuppressSnapLog"],
];

export const verifyRouterHooks = (source) => {
    const hooks = {};
    const missing = [];
    for (const [name, needle] of REQUIRED_ROUTER_HOOKS) {
        const present = source.includes(needle);
        hooks[name] = present;
        if (!present) missing.push(name);
    }
    return { ok: missing.length === 0, missing, hooks };
};

export const patchRouterSource = (source) => {
    if (source.includes(MARKER)) {
        return source;
    }

    let out = `${MARKER}\n${source}`;

    const reqRegex =
        /var ([A-Za-z0-9_$]+)=globalThis,([A-Za-z0-9_$]+)=\1\.parcelRequire[A-Za-z0-9_$]+,([A-Za-z0-9_$]+)=\2\.register;/;
    if (reqRegex.test(out)) {
        out = out.replace(reqRegex, "$&globalThis.__trafficityRouterRequire=$2;");
    }

    const sfxRegex =
        /r\("lVhdV",function\(([A-Za-z0-9_$]+),[A-Za-z0-9_$]+\)\{e\(\1\.exports,"playUiSfx",\(\)=>([A-Za-z0-9_$]+)\);/;
    if (sfxRegex.test(out)) {
        out = out.replace(sfxRegex, "$&globalThis.__trafficityPlayUiSfx=(...args)=>$2(...args);");
    }

    const f5Regex =
        /r\("f5Ojv",function\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{e\(\1\.exports,"rollBackLastConfirmInOpenGroup",\(\)=>([A-Za-z0-9_$]+)\),e\(\1\.exports,"undoLastAction",\(\)=>([A-Za-z0-9_$]+)\);/;
    if (f5Regex.test(out)) {
        const f5Start = out.indexOf('r("f5Ojv",');
        const f5Slice = f5Start !== -1 ? out.slice(f5Start, f5Start + 12000) : "";
        const applyMatch = f5Slice.match(
            /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$]+,[A-Za-z0-9_$]+,([A-Za-z0-9_$]+),[A-Za-z0-9_$]+\)=>\{"confirm"===\2\.kind\?/,
        );
        const validateMatch = f5Slice.match(
            /([A-Za-z0-9_$]+)=\([A-Za-z0-9_$]+,[A-Za-z0-9_$]+,([A-Za-z0-9_$]+)\)=>"confirm"===\2\.kind\?/,
        );
        const applyName = applyMatch ? applyMatch[1] : "L";
        const validateName = validateMatch ? validateMatch[1] : "I";
        out = out.replace(
            f5Regex,
            `r("f5Ojv",function($1,$2){e($1.exports,"rollBackLastConfirmInOpenGroup",()=>$3),e($1.exports,"undoLastAction",()=>$4),e($1.exports,"applyUndoSubRecord",()=>${applyName}),e($1.exports,"validateUndoSubRecord",()=>${validateName});globalThis.__trafficityUndoModule=$1.exports;globalThis.dispatchEvent&&queueMicrotask(()=>globalThis.dispatchEvent(new CustomEvent("trafficity:undo-ready")));`,
        );
    }

    const undoHistoryRegex = /([A-Za-z0-9_$]+)=i\("c5qGK"\),([A-Za-z0-9_$]+)=i\("duUfw"\);/;
    if (undoHistoryRegex.test(out)) {
        out = out.replace(undoHistoryRegex, "$&globalThis.__trafficityUndoHistory=$2;");
    }

    const eqRegex =
        /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)=>\{\2\.mouseIsDown\|\|\2\.isModalDialogOpen\|\|\(([A-Za-z0-9_$]+)\(\2\),"undone"===\(0,([A-Za-z0-9_$]+)\.undoLastAction\)\(\2,([A-Za-z0-9_$]+)\)/;
    if (eqRegex.test(out)) {
        out = out.replace(
            eqRegex,
            '$1=$2=>{globalThis.__trafficityGameState=$2;globalThis.__trafficityUndoDeps=$5;$2.mouseIsDown||$2.isModalDialogOpen||($3($2),"undone"===(0,$4.undoLastAction)($2,$5)',
        );
    }

    const e5Regex =
        /([A-Za-z0-9_$]+)=\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)=>\{if\(([A-Za-z0-9_$]+)\(\2,\3\),\(0,([A-Za-z0-9_$]+)\.shouldBlockWorldPointer\)\(\3\)\)return;if\(1===\2\.button\)/;
    if (e5Regex.test(out)) {
        out = out.replace(
            e5Regex,
            "$1=($2,$3)=>{globalThis.__trafficityGameState=$3;if($4($2,$3),(0,$5.shouldBlockWorldPointer)($3))return;if(1===$2.button)",
        );
    }

    const e1Regex =
        /([A-Za-z0-9_$]+)=\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)=>\{\2\.shiftKey\?\3\.keysPressed\.add\("shift"\):\3\.keysPressed\.delete\("shift"\)\}/;
    if (e1Regex.test(out)) {
        out = out.replace(
            e1Regex,
            '$1=($2,$3)=>{globalThis.__trafficityGameState=$3;$2.shiftKey?$3.keysPressed.add("shift"):$3.keysPressed.delete("shift")}',
        );
    }

    const udpRegex =
        /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)=>\{([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+);try\{([A-Za-z0-9_$]+)\(\2\)\}catch\(([A-Za-z0-9_$]+)\)\{console\.log\("Failed to update draft lane preview:",\6\)/;
    if (udpRegex.test(out)) {
        out = out.replace(
            udpRegex,
            '$1=$2=>{globalThis.__trafficityGameState=$2;$3=$4;try{$5($2)}catch($6){console.log("Failed to update draft lane preview:",$6)',
        );
    }

    const ayRegex =
        /r\("aYVZj",function\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{e\(\1\.exports,"getIntersectionCenterFromRoadEnds",\(\)=>([A-Za-z0-9_$]+)\),/;
    if (ayRegex.test(out)) {
        out = out.replace(
            ayRegex,
            'r("aYVZj",function($1,$2){globalThis.__trafficitySnapModule=$1.exports;e($1.exports,"getIntersectionCenterFromRoadEnds",()=>$3),',
        );
    }

    const emRegex =
        /for\(let ([A-Za-z0-9_$]+)=1;\1<=30;\1\+\+\)\{if\(([A-Za-z0-9_$]+)&&\(\2=\(0,([A-Za-z0-9_$]+)\.getPreviousPoint\)\(([A-Za-z0-9_$]+),\2\)\),\2\)\{let \1=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),\2,([A-Za-z0-9_$]+)\.lanesWide,0\);if\(\1&&([A-Za-z0-9_$]+)\(\6,([A-Za-z0-9_$]+),\1\)\)return \1\}if\(([A-Za-z0-9_$]+)&&\(\10=\(0,\3\.getNextPoint\)\(\4,\10\)\),\10\)\{let \1=\5\(\6,\10,\7\.lanesWide,0\);if\(\1&&\8\(\6,\9,\1\)\)return \1\}\}/;
    if (emRegex.test(out)) {
        out = out.replace(
            emRegex,
            "const _maxSteps=globalThis.__trafficityMaxSnapSearchSteps??30,_stride=globalThis.__trafficitySnapSearchStride??1;for(let $1=1;$1<=_maxSteps;$1++){for(let _k=0;_k<_stride&&$2;_k++)$2=(0,$3.getPreviousPoint)($4,$2);if($2){let $1=$5($6,$2,$7.lanesWide,0);if($1&&$8($6,$9,$1))return $1}for(let _k=0;_k<_stride&&$10;_k++)$10=(0,$3.getNextPoint)($4,$10);if($10){let $1=$5($6,$10,$7.lanesWide,0);if($1&&$8($6,$9,$1))return $1}}",
        );
    }

    const snapLogRegex = /return console\.log\("junction midpoint snap",\{/;
    if (snapLogRegex.test(out)) {
        out = out.replace(snapLogRegex, 'return !globalThis.__trafficitySuppressSnapLog&&console.log("junction midpoint snap",{');
    }

    return out;
};

export const applyPatchesToExtractedDir = async (extractedDir) => {
    const modApiSrc = path.join(PROJECT_ROOT, "src", "mod-api.cjs");
    const tomlSrc = path.join(PROJECT_ROOT, "src", "toml.cjs");
    const loaderSrc = path.join(PROJECT_ROOT, "runtime", "loader.js");

    await fsp.copyFile(modApiSrc, path.join(extractedDir, "electron", "mod-api.cjs"));
    await fsp.copyFile(tomlSrc, path.join(extractedDir, "electron", "toml.cjs"));
    await fsp.copyFile(loaderSrc, path.join(extractedDir, "electron", "mod-loader.js"));

    const targets = [
        ["electron/static-server.js", patchStaticServerSource],
        ["electron/preload.js", patchPreloadSource],
        ["electron/main.js", patchMainSource],
        ["dist/index.html", patchIndexHtmlSource],
    ];

    for (const [relPath, patchFn] of targets) {
        const fullPath = path.join(extractedDir, relPath);
        const orig = await fsp.readFile(fullPath, "utf-8");
        const next = patchFn(orig);
        if (next !== orig) {
            await fsp.writeFile(fullPath, next, "utf-8");
        }
    }

    const distDir = path.join(extractedDir, "dist");
    if (fs.existsSync(distDir)) {
        for (const name of await fsp.readdir(distDir)) {
            if (/^Router\..*\.js$/.test(name)) {
                const routerPath = path.join(distDir, name);
                const orig = await fsp.readFile(routerPath, "utf-8");
                const next = patchRouterSource(orig);
                const check = verifyRouterHooks(next);
                if (!check.ok) {
                    throw new Error(`Router patch incomplete for ${name}; missing hooks: ${check.missing.join(", ")}`);
                }
                if (next !== orig) {
                    await fsp.writeFile(routerPath, next, "utf-8");
                }
            }
        }
    }
};

export const patchAsar = async (asarPath) => {
    if (!fs.existsSync(asarPath)) {
        throw new Error(`app.asar not found at: ${asarPath}`);
    }

    const backupPath = `${asarPath}.bak`;
    asar.uncache(asarPath);

    let alreadyPatched = false;
    try {
        const currentMain = asar.extractFile(asarPath, "electron/main.js").toString("utf-8");
        alreadyPatched = currentMain.includes(MARKER);
    } catch {
        alreadyPatched = false;
    }

    if (!alreadyPatched) {
        await fsp.copyFile(asarPath, backupPath);
        console.log(`Created backup: ${backupPath}`);
    } else if (!fs.existsSync(backupPath)) {
        throw new Error(`app.asar is already patched but backup is missing at: ${backupPath}`);
    } else {
        await fsp.copyFile(backupPath, asarPath);
    }

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "trafficity-asar-"));
    const tempAsar = `${asarPath}.tmp`;
    try {
        asar.uncache(asarPath);
        asar.extractAll(asarPath, tempDir);
        await applyPatchesToExtractedDir(tempDir);
        await asar.createPackageWithOptions(tempDir, tempAsar, {
            unpackDir: "node_modules/steamworks.js",
        });
        await fsp.rename(tempAsar, asarPath);
        asar.uncache(asarPath);
        console.log(`Successfully patched: ${asarPath}`);
    } finally {
        await fsp.rm(tempAsar, { force: true });
        await fsp.rm(`${tempAsar}.unpacked`, { recursive: true, force: true });
        await fsp.rm(tempDir, { recursive: true, force: true });
    }
};

export const restoreAsar = async (asarPath) => {
    const backupPath = `${asarPath}.bak`;
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup not found at: ${backupPath}`);
    }
    await fsp.copyFile(backupPath, asarPath);
    asar.uncache(asarPath);
    console.log(`Restored original app.asar from: ${backupPath}`);
};

export const inspectAsarStatus = (asarPath) => {
    const gameDir = path.resolve(path.dirname(asarPath), "..");
    const backupPath = `${asarPath}.bak`;
    const modsDir = resolveDefaultModsDir();
    const base = {
        found: fs.existsSync(asarPath),
        asarPath,
        gameDir,
        backupExists: fs.existsSync(backupPath),
        patched: false,
        gameRelease: null,
        routerFile: null,
        hooksOk: false,
        missingHooks: [],
        modsDir,
    };

    if (!base.found) {
        return base;
    }

    try {
        asar.uncache(asarPath);
        const mainJs = asar.extractFile(asarPath, "electron/main.js").toString("utf-8");
        base.patched = mainJs.includes(MARKER);

        try {
            const errJson = JSON.parse(asar.extractFile(asarPath, "dist/error-reporting.json").toString("utf-8"));
            if (typeof errJson.release === "string") {
                base.gameRelease = errJson.release;
            }
        } catch {
            // ignore
        }

        const files = asar.listPackage(asarPath);
        const routerEntry = files.find((f) => /^\/dist\/Router\..*\.js$/.test(f));
        if (routerEntry) {
            base.routerFile = routerEntry.slice(1);
            const routerSrc = asar.extractFile(asarPath, base.routerFile).toString("utf-8");
            const check = verifyRouterHooks(routerSrc);
            base.hooksOk = check.ok;
            base.missingHooks = check.missing;
        }
    } catch (err) {
        base.error = err && err.message ? err.message : String(err);
    }

    return base;
};

const parseArgs = (argv) => {
    let asarPath = DEFAULT_ASAR_PATH;
    let restore = false;
    let status = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--restore") {
            restore = true;
        } else if (arg === "--status") {
            status = true;
        } else if (arg === "--asar" && argv[i + 1]) {
            asarPath = path.resolve(argv[++i]);
        } else if (arg === "--game-dir" && argv[i + 1]) {
            asarPath = path.resolve(argv[++i], "resources", "app.asar");
        }
    }

    return { asarPath, restore, status };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { asarPath, restore, status } = parseArgs(process.argv.slice(2));
    if (status) {
        console.log(JSON.stringify(inspectAsarStatus(asarPath), null, 2));
    } else if (restore) {
        await restoreAsar(asarPath);
    } else {
        await patchAsar(asarPath);
        if (process.env.TRAFFICITY_SKIP_EXAMPLE_SYNC !== "1") {
            const { syncExampleMods } = await import("./registry.mjs");
            const summary = await syncExampleMods({ modsDir: resolveDefaultModsDir() });
            console.log(
                `Synced examples (installed: ${summary.installed.length}, updated: ${summary.updated.length}, unchanged: ${summary.unchanged.length}, deduplicated: ${summary.deduplicated})`,
            );
        }
    }
}
