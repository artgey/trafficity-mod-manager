import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import { patchAsar, patchRouterSource, restoreAsar } from "../src/patch.mjs";

const require = createRequire(import.meta.url);
const { createModRequestHandler } = require("../src/mod-api.cjs");

test("patchAsar patches mock app.asar idempotently and restoreAsar reverts it", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-patch-test-"));
    try {
        const srcDir = path.join(tmp, "src-asar");
        await fsp.mkdir(path.join(srcDir, "electron"), { recursive: true });
        await fsp.mkdir(path.join(srcDir, "dist"), { recursive: true });
        await fsp.mkdir(path.join(srcDir, "player-saves"), { recursive: true });

        await fsp.writeFile(
            path.join(srcDir, "electron", "static-server.js"),
            [
                'const http = require("node:http");',
                "const createRequestListener = (rootDir) => {",
                "    return async (req, res) => {",
                '        const url = new URL(req.url || "/", "http://127.0.0.1");',
                '        if (url.pathname.startsWith("/dev-saves/")) {',
                "            return;",
                "        }",
                "    };",
                "};",
            ].join("\n"),
        );

        await fsp.writeFile(
            path.join(srcDir, "electron", "preload.js"),
            [
                'contextBridge.exposeInMainWorld("trafficityDesktop", {',
                "    clearSteamAchievements: (names) => {",
                '        ipcRenderer.send("steam-clear-achievements", names);',
                "    },",
                "});",
            ].join("\n"),
        );

        await fsp.writeFile(
            path.join(srcDir, "electron", "main.js"),
            [
                'const { app, ipcMain, shell } = require("electron");',
                "const { getPlayerSavesDir } = require(\"../player-saves/store\");",
                "let mainWindow = null;",
                "const main = async () => {};",
                "main();",
            ].join("\n"),
        );

        await fsp.writeFile(
            path.join(srcDir, "dist", "index.html"),
            '<!DOCTYPE html><html><head></head><body><script type="module" src="/transit-city-game.abc.js"></script></body></html>',
        );

        const asarPath = path.join(tmp, "app.asar");
        await asar.createPackage(srcDir, asarPath);
        const origBytes = await fsp.readFile(asarPath);

        await patchAsar(asarPath);
        assert.equal(fs.existsSync(`${asarPath}.bak`), true);

        // Idempotent second run
        await patchAsar(asarPath);

        const verifyDir = path.join(tmp, "verify-asar");
        asar.extractAll(asarPath, verifyDir);

        const html = await fsp.readFile(path.join(verifyDir, "dist", "index.html"), "utf-8");
        assert.match(html, /<script src="\/mods-runtime\/loader\.js"><\/script>\s*<script type="module"/);
        assert.equal(fs.existsSync(path.join(verifyDir, "electron", "mod-api.cjs")), true);
        assert.equal(fs.existsSync(path.join(verifyDir, "electron", "mod-loader.js")), true);

        await restoreAsar(asarPath);
        const restoredBytes = await fsp.readFile(asarPath);
        assert.deepEqual(restoredBytes, origBytes);
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("mod-api serves mod catalog, toggles state, and blocks path traversal", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-api-test-"));
    const prevEnv = process.env.TRAFFICITY_MODS_DIR;
    const modsDir = path.join(tmp, "userData", "mods");
    process.env.TRAFFICITY_MODS_DIR = modsDir;

    try {
        const rootDir = path.join(tmp, "app");
        await fsp.mkdir(path.join(rootDir, "electron"), { recursive: true });
        await fsp.mkdir(path.join(rootDir, "dist"), { recursive: true });
        await fsp.writeFile(path.join(rootDir, "electron", "mod-loader.js"), "console.log('loader');");
        await fsp.writeFile(
            path.join(rootDir, "dist", "error-reporting.json"),
            JSON.stringify({ release: "trafficity@1.0.0+a7671b7e7a" }),
        );

        const modFolder = path.join(modsDir, "arrow-pan-mod");
        await fsp.mkdir(modFolder, { recursive: true });
        await fsp.writeFile(
            path.join(modFolder, "mod.json"),
            JSON.stringify({
                id: "arrow-pan-mod",
                name: "Arrow Pan",
                version: "1.0.0",
                entry: "mod.js",
            }),
        );
        await fsp.writeFile(path.join(modFolder, "mod.js"), "console.log('mod loaded');");

        const handler = createModRequestHandler({
            rootDir,
            getPlayerSavesDir: async () => path.join(tmp, "userData", "saves"),
        });

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || "/", "http://127.0.0.1");
            const handled = await handler(req, res, url);
            if (!handled) {
                res.statusCode = 404;
                res.end("not handled");
            }
        });

        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}`;

        try {
            // 1. Initial list (disabled by default) + gameRelease
            const listRes = await fetch(`${baseUrl}/api/mods`);
            assert.equal(listRes.status, 200);
            const listJson = await listRes.json();
            assert.equal(listJson.mods.length, 1);
            assert.equal(listJson.mods[0].enabled, false);
            assert.equal(listJson.gameRelease, "trafficity@1.0.0+a7671b7e7a");

            // 2. Toggle on
            const toggleRes = await fetch(`${baseUrl}/api/mods/toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "arrow-pan-mod", enabled: true }),
            });
            assert.equal(toggleRes.status, 200);

            // 3. Enabled filter returns it
            const enabledRes = await fetch(`${baseUrl}/api/mods?enabled=1`);
            const enabledJson = await enabledRes.json();
            assert.equal(enabledJson.mods.length, 1);
            assert.equal(enabledJson.mods[0].id, "arrow-pan-mod");

            // 4. Loader & mod file served with COOP/COEP headers
            const loaderRes = await fetch(`${baseUrl}/mods-runtime/loader.js`);
            assert.equal(loaderRes.status, 200);
            assert.equal(loaderRes.headers.get("cross-origin-embedder-policy"), "require-corp");

            const modJsRes = await fetch(`${baseUrl}/mods-runtime/mods/arrow-pan-mod/mod.js`);
            assert.equal(modJsRes.status, 200);
            assert.match(await modJsRes.text(), /mod loaded/);

            // 5. Path traversal blocked
            const traversalRes = await fetch(`${baseUrl}/mods-runtime/mods/arrow-pan-mod/../../mods-config.json`);
            assert.equal(traversalRes.status, 404);
        } finally {
            server.close();
        }
    } finally {
        if (prevEnv === undefined) delete process.env.TRAFFICITY_MODS_DIR;
        else process.env.TRAFFICITY_MODS_DIR = prevEnv;
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("loader cycleToolbeltSlot skips exhausted and disabled slots", async () => {
    const clicks = [];
    const makeBtn = (id, { selected = false, exhausted = false, disabled = false } = {}) => {
        const hostClasses = new Set(exhausted ? ["game-multi-button", "building-toolbar-button--exhausted"] : ["game-multi-button"]);
        const btnClasses = new Set(selected ? ["game-multi-button-option", "game-multi-button-option-selected"] : ["game-multi-button-option"]);
        const host = {
            classList: { contains: (c) => hostClasses.has(c) },
        };
        return {
            tagName: "BUTTON",
            disabled,
            classList: { contains: (c) => btnClasses.has(c) },
            closest: (sel) => (sel === ".game-multi-button" ? host : null),
            click: () => clicks.push(id),
        };
    };

    const slots = [
        makeBtn("road-1", { selected: true }),
        makeBtn("house-0", { exhausted: true }),
        makeBtn("mine-0", { disabled: true }),
        makeBtn("grid"),
    ];

    const row = {
        children: slots.map((btn) => ({
            tagName: "DIV",
            classList: { contains: () => false },
            querySelectorAll: () => [btn],
        })),
    };

    globalThis.XMLHttpRequest = class {
        open() {}
        send() {
            this.status = 200;
            this.responseText = JSON.stringify({ modsDir: "", mods: [] });
        }
    };
    globalThis.document = {
        readyState: "loading",
        querySelector: (sel) => (sel === ".road-toolbar-buttons-row" ? row : null),
    };
    globalThis.window = {
        addEventListener() {},
    };

    try {
        await import(`../runtime/loader.js?t=${Date.now()}`);
        const { game } = globalThis.window.TrafficityMods;
        assert.equal(game.cycleToolbeltSlot(1), true);
        assert.deepEqual(clicks, ["grid"]);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.XMLHttpRequest;
    }
});

test("patchRouterSource matches renamed undoLastAction export symbols", () => {
    const mockRouter = [
        "var n=globalThis,i=n.parcelRequireeccb,r=i.register;",
        'r("f5Ojv",function(t,n){e(t.exports,"rollBackLastConfirmInOpenGroup",()=>C),e(t.exports,"undoLastAction",()=>T);var p=i("c5qGK"),f=i("duUfw");});',
    ].join("\n");
    const patched = patchRouterSource(mockRouter);
    assert.equal(patched.includes("__trafficityRouterRequire"), true);
    assert.equal(patched.includes("__trafficityUndoModule"), true);
    assert.equal(patched.includes("()=>T"), true);
    assert.equal(patched.includes("__trafficityUndoHistory"), true);
    assert.equal(patchRouterSource(patched), patched);
});
