import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const resolveDefaultAsarPath = () => {
    if (process.platform === "win32") {
        const progFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        return path.join(progFilesX86, "Steam", "steamapps", "common", "Trafficity", "resources", "app.asar");
    }
    return path.join(os.homedir(), ".local/share/Steam/steamapps/common/Trafficity/resources/app.asar");
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

export const patchRouterSource = (source) => {
    if (source.includes(MARKER)) {
        return source;
    }

    let out = `${MARKER}\n${source}`;

    const reqAnchor = "r=i.register;";
    if (out.includes(reqAnchor)) {
        out = out.replace(reqAnchor, `${reqAnchor}globalThis.__trafficityRouterRequire=i;`);
    }

    const sfxAnchor = 'r("lVhdV",function(n,r){e(n.exports,"playUiSfx",()=>y);';
    if (out.includes(sfxAnchor)) {
        out = out.replace(sfxAnchor, `${sfxAnchor}globalThis.__trafficityPlayUiSfx=(...args)=>y(...args);`);
    }

    const f5Regex = /r\("f5Ojv",function\(t,n\)\{e\(t\.exports,"rollBackLastConfirmInOpenGroup",\(\)=>([A-Za-z0-9_$]+)\),e\(t\.exports,"undoLastAction",\(\)=>([A-Za-z0-9_$]+)\);/;
    if (f5Regex.test(out)) {
        out = out.replace(
            f5Regex,
            'r("f5Ojv",function(t,n){e(t.exports,"rollBackLastConfirmInOpenGroup",()=>$1),e(t.exports,"undoLastAction",()=>$2),e(t.exports,"applyUndoSubRecord",()=>L),e(t.exports,"validateUndoSubRecord",()=>I);globalThis.__trafficityUndoModule=t.exports;globalThis.dispatchEvent&&globalThis.dispatchEvent(new CustomEvent("trafficity:undo-ready"));',
        );
    }

    const undoHistoryAnchor = 'p=i("c5qGK"),f=i("duUfw");';
    if (out.includes(undoHistoryAnchor)) {
        out = out.replace(undoHistoryAnchor, `${undoHistoryAnchor}globalThis.__trafficityUndoHistory=f;`);
    }

    const eqAnchor = 'eQ=e=>{e.mouseIsDown||e.isModalDialogOpen||(eq(e),"undone"===(0,X.undoLastAction)(e,ej)';
    if (out.includes(eqAnchor)) {
        out = out.replace(
            eqAnchor,
            'eQ=e=>{globalThis.__trafficityGameState=e;globalThis.__trafficityUndoDeps=ej;e.mouseIsDown||e.isModalDialogOpen||(eq(e),"undone"===(0,X.undoLastAction)(e,ej)',
        );
    }

    const e5Anchor = "e5=(e,t)=>{if(e1(e,t),(0,ep.shouldBlockWorldPointer)(t))return;";
    if (out.includes(e5Anchor)) {
        out = out.replace(
            e5Anchor,
            "e5=(e,t)=>{globalThis.__trafficityGameState=t;if(e1(e,t),(0,ep.shouldBlockWorldPointer)(t))return;",
        );
    }

    const e1Anchor = 'e1=(e,t)=>{e.shiftKey?t.keysPressed.add("shift"):t.keysPressed.delete("shift")}';
    if (out.includes(e1Anchor)) {
        out = out.replace(
            e1Anchor,
            'e1=(e,t)=>{globalThis.__trafficityGameState=t;e.shiftKey?t.keysPressed.add("shift"):t.keysPressed.delete("shift")}',
        );
    }

    const udpAnchor = "e_=e=>{Q=q;try{eR(e)}";
    if (out.includes(udpAnchor)) {
        out = out.replace(udpAnchor, "e_=e=>{globalThis.__trafficityGameState=e;Q=q;try{eR(e)}");
    }

    const ayAnchor = 'r("aYVZj",function(t,n){e(t.exports,"getIntersectionCenterFromRoadEnds",()=>_),';
    if (out.includes(ayAnchor)) {
        out = out.replace(
            ayAnchor,
            'r("aYVZj",function(t,n){globalThis.__trafficitySnapModule=t.exports;e(t.exports,"getIntersectionCenterFromRoadEnds",()=>_),',
        );
    }

    const emAnchor =
        "for(let i=1;i<=30;i++){if(l&&(l=(0,m.getPreviousPoint)(a,l)),l){let i=es(e,l,n.lanesWide,0);if(i&&eg(e,t,i))return i}if(d&&(d=(0,m.getNextPoint)(a,d)),d){let i=es(e,d,n.lanesWide,0);if(i&&eg(e,t,i))return i}}";
    if (out.includes(emAnchor)) {
        out = out.replace(
            emAnchor,
            "const _maxSteps=globalThis.__trafficityMaxSnapSearchSteps??30,_stride=globalThis.__trafficitySnapSearchStride??1;for(let i=1;i<=_maxSteps;i++){for(let _k=0;_k<_stride&&l;_k++)l=(0,m.getPreviousPoint)(a,l);if(l){let i=es(e,l,n.lanesWide,0);if(i&&eg(e,t,i))return i}for(let _k=0;_k<_stride&&d;_k++)d=(0,m.getNextPoint)(a,d);if(d){let i=es(e,d,n.lanesWide,0);if(i&&eg(e,t,i))return i}}",
        );
    }

    const snapLogAnchor = 'return console.log("junction midpoint snap",{';
    if (out.includes(snapLogAnchor)) {
        out = out.replace(snapLogAnchor, 'return !globalThis.__trafficitySuppressSnapLog&&console.log("junction midpoint snap",{');
    }

    return out;
};

export const applyPatchesToExtractedDir = async (extractedDir) => {
    const modApiSrc = path.join(PROJECT_ROOT, "src", "mod-api.cjs");
    const loaderSrc = path.join(PROJECT_ROOT, "runtime", "loader.js");

    await fsp.copyFile(modApiSrc, path.join(extractedDir, "electron", "mod-api.cjs"));
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

const parseArgs = (argv) => {
    let asarPath = DEFAULT_ASAR_PATH;
    let restore = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--restore") {
            restore = true;
        } else if (arg === "--asar" && argv[i + 1]) {
            asarPath = path.resolve(argv[++i]);
        } else if (arg === "--game-dir" && argv[i + 1]) {
            asarPath = path.resolve(argv[++i], "resources", "app.asar");
        }
    }

    return { asarPath, restore };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { asarPath, restore } = parseArgs(process.argv.slice(2));
    if (restore) {
        await restoreAsar(asarPath);
    } else {
        await patchAsar(asarPath);
    }
}
