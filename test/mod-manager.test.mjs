import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import { inspectAsarStatus, patchAsar, patchRouterSource, resolveDefaultAsarPath, restoreAsar, verifyRouterHooks } from "../src/patch.mjs";

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
        await fsp.writeFile(
            path.join(modFolder, "settings.toml"),
            '# Keep comment\n[speed]\nlabel = "Speed"\ntype = "number"\nvalue = 2\n',
        );

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
            assert.equal(listJson.mods[0].hasSettings, true);
            assert.equal(listJson.mods[0].config.speed, 2);
            assert.equal(listJson.gameRelease, "trafficity@1.0.0+a7671b7e7a");

            // 1b. Update settings.toml via POST /api/mods/config
            const cfgRes = await fetch(`${baseUrl}/api/mods/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "arrow-pan-mod", config: { speed: 5 } }),
            });
            assert.equal(cfgRes.status, 200);
            const rawToml = await fsp.readFile(path.join(modFolder, "settings.toml"), "utf-8");
            assert.match(rawToml, /^# Keep comment/m);
            assert.match(rawToml, /^value = 5$/m);

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

            // 4. Loader & mod file served with COOP/COEP + Cache-Control: no-store headers
            const loaderRes = await fetch(`${baseUrl}/mods-runtime/loader.js`);
            assert.equal(loaderRes.status, 200);
            assert.equal(loaderRes.headers.get("cross-origin-embedder-policy"), "require-corp");
            assert.equal(loaderRes.headers.get("cache-control"), "no-store");

            const modJsRes = await fetch(`${baseUrl}/mods-runtime/mods/arrow-pan-mod/mod.js`);
            assert.equal(modJsRes.status, 200);
            assert.equal(modJsRes.headers.get("cache-control"), "no-store");
            assert.match(await modJsRes.text(), /mod loaded/);

            // 4b. Expanded MIME types (.wasm)
            await fsp.writeFile(path.join(modFolder, "helper.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
            const wasmRes = await fetch(`${baseUrl}/mods-runtime/mods/arrow-pan-mod/helper.wasm`);
            assert.equal(wasmRes.status, 200);
            assert.equal(wasmRes.headers.get("content-type"), "application/wasm");

            // 4c. Malformed JSON returns 400 JSON instead of unhandled exception
            const badJsonRes = await fetch(`${baseUrl}/api/mods/toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{bad json",
            });
            assert.equal(badJsonRes.status, 400);
            const badJsonBody = await badJsonRes.json();
            assert.match(badJsonBody.error, /Invalid JSON/i);

            // 4d. Broken mod.json reports string `error` matching TrafficityCatalogMod
            const brokenDir = path.join(modsDir, "broken-mod");
            await fsp.mkdir(brokenDir, { recursive: true });
            await fsp.writeFile(path.join(brokenDir, "mod.json"), "{not-json");
            const brokenList = await (await fetch(`${baseUrl}/api/mods`)).json();
            const brokenEntry = brokenList.mods.find((m) => m.id === "broken-mod");
            assert.equal(typeof brokenEntry.error, "string");
            assert.match(brokenEntry.error, /Invalid mod\.json/);

            // 5. Path traversal blocked
            const traversalRes = await fetch(`${baseUrl}/mods-runtime/mods/arrow-pan-mod/../../mods-config.json`);
            assert.equal(traversalRes.status, 404);
        } finally {
            server.closeAllConnections?.();
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
        const modApi = globalThis.window.TrafficityMods;

        assert.deepEqual(modApi.getConfig("nonexistent", { speed: 3, enabled: true }), { speed: 3, enabled: true });
        assert.equal(typeof modApi.defineMod((api) => api), "function");
        assert.equal(game.cycleToolbeltSlot(1), true);
        assert.deepEqual(clicks, ["grid"]);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.XMLHttpRequest;
    }
});

test("patchRouterSource matches renamed minified identifiers across all required Router hooks", () => {
    const mockRouter = [
        "var g=globalThis,req=g.parcelRequireabcd,reg=req.register;",
        'r("lVhdV",function(m,ex){e(m.exports,"playUiSfx",()=>playFn);});',
        'r("f5Ojv",function(m,ex){e(m.exports,"rollBackLastConfirmInOpenGroup",()=>rbFn),e(m.exports,"undoLastAction",()=>undoFn);var p=i("c5qGK"),uh=i("duUfw");let valFn=(e,t,sub)=>"confirm"===sub.kind?1:0,appFn=(e,t,sub,d)=>{"confirm"===sub.kind?1:0};});',
        'fnQ=gs=>{gs.mouseIsDown||gs.isModalDialogOpen||(clr(gs),"undone"===(0,um.undoLastAction)(gs,depBag))};',
        'fn5=(ev,gs)=>{if(fn1(ev,gs),(0,wp.shouldBlockWorldPointer)(gs))return;if(1===ev.button){}};',
        'fn1=(ev,gs)=>{ev.shiftKey?gs.keysPressed.add("shift"):gs.keysPressed.delete("shift")};',
        'fnUdp=gs=>{q1=q2;try{innerUdp(gs)}catch(err){console.log("Failed to update draft lane preview:",err)}};',
        'r("aYVZj",function(m,ex){e(m.exports,"getIntersectionCenterFromRoadEnds",()=>icFn),e(m.exports,"getNearestLaneCreationPoint",()=>gnFn);',
        'return console.log("junction midpoint snap",{a:1});',
        "for(let k=1;k<=30;k++){if(prev&&(prev=(0,pt.getPreviousPoint)(ls,prev)),prev){let k=mk(gs,prev,ptObj.lanesWide,0);if(k&&okFn(gs,sp,k))return k}if(nxt&&(nxt=(0,pt.getNextPoint)(ls,nxt)),nxt){let k=mk(gs,nxt,ptObj.lanesWide,0);if(k&&okFn(gs,sp,k))return k}}});",
    ].join("\n");

    const patched = patchRouterSource(mockRouter);
    const check = verifyRouterHooks(patched);
    assert.equal(check.ok, true, `Missing hooks: ${check.missing.join(", ")}`);
    assert.equal(patched.includes("()=>appFn"), true);
    assert.equal(patched.includes("()=>valFn"), true);
    assert.equal(patched.includes("()=>undoFn"), true);
    assert.equal(patched.includes("globalThis.__trafficityRouterRequire=req;"), true);
    assert.equal(patched.includes("globalThis.__trafficityUndoDeps=depBag;"), true);
    assert.equal(patchRouterSource(patched), patched);
});

test("loader addOverlay isolates click/mousedown/wheel propagation", async () => {
    const elements = [];
    const fakeEl = () => {
        const el = {
            id: "",
            style: {},
            innerHTML: "",
            attached: new Map(),
            addEventListener(type, fn) {
                el.attached.set(type, fn);
            },
            querySelector: () => fakeEl(),
            querySelectorAll: () => [],
        };
        elements.push(el);
        return el;
    };
    globalThis.window = { addEventListener() {} };
    globalThis.document = {
        head: { appendChild() {} },
        body: { appendChild() {} },
        getElementById: () => null,
        createElement: () => fakeEl(),
    };
    globalThis.XMLHttpRequest = class {
        open() {}
        send() {
            this.status = 200;
            this.responseText = JSON.stringify({ mods: [], modsDir: "/tmp/mods" });
        }
    };

    try {
        await import(`../runtime/loader.js?t=${Date.now()}`);
        globalThis.window.TrafficityMods.addOverlay("iso-test", "<button>Hi</button>");
        const overlayHost = elements.find((e) => e.id === "tmod-overlay-iso-test");
        assert.ok(overlayHost);
        for (const evType of ["mousedown", "click", "wheel"]) {
            let stopped = false;
            overlayHost.attached.get(evType)({ stopPropagation() { stopped = true; } });
            assert.equal(stopped, true, `${evType} must stopPropagation`);
        }
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.XMLHttpRequest;
    }
});

const liveAsar = resolveDefaultAsarPath();
test("loader game.on emits ready, cursorModeChange, worldChange, and roadPlaced and unsubscribes cleanly", async () => {
    const winHandlers = new Map();
    let rafCallback = null;
    let cancelledRaf = false;
    const fakeEl = () => ({
        style: {},
        innerHTML: "",
        addEventListener() {},
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
    });

    globalThis.requestAnimationFrame = (cb) => {
        rafCallback = cb;
        return 42;
    };
    globalThis.cancelAnimationFrame = () => {
        cancelledRaf = true;
    };
    globalThis.window = {
        addEventListener(type, fn) {
            winHandlers.set(type, fn);
        },
    };
    globalThis.document = {
        head: { appendChild() {} },
        body: { appendChild() {} },
        getElementById: () => null,
        createElement: () => fakeEl(),
    };
    globalThis.XMLHttpRequest = class {
        open() {}
        send() {
            this.status = 200;
            this.responseText = JSON.stringify({ mods: [], modsDir: "/tmp/mods" });
        }
    };

    try {
        await import(`../runtime/loader.js?t=${Date.now()}`);
        const { game } = globalThis.window.TrafficityMods;
        const modApi = globalThis.window.TrafficityMods;

        assert.deepEqual(modApi.getConfig("nonexistent", { speed: 3, enabled: true }), { speed: 3, enabled: true });
        assert.equal(typeof modApi.defineMod((api) => api), "function");

        let readyCount = 0;
        const modes = [];
        const revs = [];
        const placed = [];

        const offReady = game.on("ready", () => { readyCount += 1; });
        const offMode = game.on("cursorModeChange", (m, prev) => modes.push([m, prev]));
        const offWorld = game.on("worldChange", (r, prev) => revs.push([r, prev]));
        const offPlaced = game.on("roadPlaced", (info) => placed.push(info));

        const entries = [];
        globalThis.__trafficityUndoModule = {};
        globalThis.__trafficityUndoHistory = { getUndoHistory: () => ({ entries }) };
        globalThis.__trafficityGameState = {
            cursorMode: { mode: "default" },
            saveState: { worldRevision: 1, cameraZoom: 2 },
            mapContainer: { position: { x: 100, y: 50 } },
        };

        assert.deepEqual(game.worldToScreen(10, 20), { x: 120, y: 90 });
        assert.deepEqual(game.screenToWorld(120, 90), { x: 10, y: 20 });

        winHandlers.get("trafficity:undo-ready")();
        assert.equal(readyCount, 1);

        // Late ready listener fires via microtask
        let lateReady = 0;
        game.on("ready", () => { lateReady += 1; });
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(lateReady, 1);

        // Frame 1: baseline capture
        rafCallback();
        assert.deepEqual(modes, []);

        // Frame 2: mutate cursorMode, worldRevision, undo entries
        globalThis.__trafficityGameState.cursorMode.mode = "road placement";
        globalThis.__trafficityGameState.saveState.worldRevision = 2;
        entries.push({ subRecords: [] });
        rafCallback();

        assert.deepEqual(modes, [["road placement", "default"]]);
        assert.deepEqual(revs, [[2, 1]]);
        assert.deepEqual(placed, [{ entriesCount: 1, worldRevision: 2 }]);

        offReady();
        offMode();
        offWorld();
        offPlaced();
        assert.equal(cancelledRaf, true);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.XMLHttpRequest;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
        delete globalThis.__trafficityUndoModule;
        delete globalThis.__trafficityUndoHistory;
        delete globalThis.__trafficityGameState;
    }
});

test("live Steam app.asar passes Router hook verification when installed", { skip: !fs.existsSync(liveAsar) }, () => {
    const status = inspectAsarStatus(liveAsar);
    assert.equal(status.found, true);
    assert.ok(status.routerFile);
    if (status.patched) {
        assert.equal(status.hooksOk, true, `Missing hooks: ${status.missingHooks.join(", ")}`);
    } else {
        const routerSrc = asar.extractFile(liveAsar, status.routerFile).toString("utf-8");
        const check = verifyRouterHooks(patchRouterSource(routerSrc));
        assert.equal(check.ok, true, `Missing hooks: ${check.missing.join(", ")}`);
    }
});

test("loader buildings.register wires CustomBuilding into Parcel definition/simulation modules", () => {
    const loaderSource = fs.readFileSync(path.resolve("runtime", "loader.js"), "utf-8");
    const defs = [];
    const routerModules = {
        "4nkf2": { BUILDING_DEFINITIONS: defs, getBuildingDefinition: (t) => { throw new Error(`missing ${t}`); }, getBuildingDefaultColor: () => "#888888" },
        aUbb1: { buildingDisplayName: (t) => t },
        "9nNmt": { getLocalisationLanguage: () => "en" },
        fFJcz: { getBuildingCarCountSpec: () => null, getResidentCarCountForResidentialBuildingType: () => 0, getTotalVehicleCountForBuildingType: () => 0 },
        jnB0a: { buildingHasGetVisitedNeed: () => false },
        "2cbpn": { getSatisfactionWeightForBuildingType: () => 15 },
    };
    const fakeWindow = {
        addEventListener: () => {},
        dispatchEvent: () => {},
        location: { origin: "http://127.0.0.1:1234" },
    };
    const fakeDoc = {
        readyState: "loading",
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        getElementById: () => null,
        createElement: () => ({ style: {}, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] }),
    };
    class FakeXhr {
        open() {}
        send() { this.status = 200; this.responseText = JSON.stringify({ modsDir: "/tmp/mods", mods: [] }); }
    }
    const fn = new Function(
        "window",
        "document",
        "globalThis",
        "XMLHttpRequest",
        "Node",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        loaderSource,
    );
    const fakeGlobal = {
        __trafficityUndoModule: {},
        __trafficityRouterRequire: (id) => routerModules[id] || null,
        dispatchEvent: () => {},
    };
    fn(fakeWindow, fakeDoc, fakeGlobal, FakeXhr, function FakeNode() {}, () => 1, () => {});

    const api = fakeWindow.TrafficityMods;
    assert.ok(api.buildings && typeof api.buildings.CustomBuilding === "function");
    assert.throws(() => new api.buildings.CustomBuilding({ type: "bad", buildingCategory: "spaceship" }), /Invalid buildingCategory/);

    const registered = api.buildings.register({
        type: "mod:test-tower",
        name: "Test Tower",
        buildingCategory: "office",
        width: 120,
        depth: 100,
        satisfactionWeight: 25,
    });
    assert.equal(registered.type, "mod:test-tower");
    assert.equal(defs.length, 1);
    assert.equal(routerModules["4nkf2"].getBuildingDefinition("mod:test-tower").width, 120);
    assert.equal(routerModules.aUbb1.buildingDisplayName("mod:test-tower"), "Test Tower");
    assert.equal(routerModules.jnB0a.buildingHasGetVisitedNeed("mod:test-tower"), true);
    assert.equal(routerModules["2cbpn"].getSatisfactionWeightForBuildingType("mod:test-tower"), 25);
    assert.equal(api.game.MODULES.BUILDING_DEFINITIONS, "4nkf2");
    assert.equal(api.game.requireModule("BUILDING_DEFINITIONS"), routerModules["4nkf2"]);
});

test("loader composable hooks, stacked tooltips, getCursorState, bindKey/onMouse unsubscribe, and addOverlay host return", async () => {
    const loaderSource = await fsp.readFile(path.resolve("runtime", "loader.js"), "utf-8");
    const winListeners = new Map();
    const fakeWindow = {
        addEventListener(type, fn) {
            if (!winListeners.has(type)) winListeners.set(type, new Set());
            winListeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            winListeners.get(type)?.delete(fn);
        },
    };
    const elementsById = new Map();
    const fakeDoc = {
        readyState: "complete",
        head: { appendChild() {} },
        body: {
            appendChild(el) {
                if (el.id) elementsById.set(el.id, el);
            },
        },
        getElementById: (id) => elementsById.get(id) || null,
        createElement: (tag) => ({
            tagName: tag.toUpperCase(),
            id: "",
            style: {},
            innerHTML: "",
            addEventListener() {},
            replaceChildren() {},
            querySelector: () => ({ addEventListener() {}, style: {}, textContent: "" }),
            querySelectorAll: () => [],
        }),
    };
    class FakeXhr {
        open() {}
        send() {
            this.status = 200;
            this.responseText = JSON.stringify({ modsDir: "/tmp/mods", mods: [] });
        }
    }

    const snapMod = {
        getNearestLaneCreationPoint: (_gs, x, y) => ({ type: "absolute", x, y }),
    };
    const placementMod = {
        getRoadConstructionActionWithPlacement: (_gs, s, e) => ({ calls: ["base"], s, e }),
    };
    const tooltipMod = {
        BuildingTypeTooltip: (props) => ({ props: { children: [props.buildingDefinition.type] } }),
    };
    const jsxMod = {
        jsx: (type, props, key) => ({ type, props, key }),
    };
    const routerModules = {
        aYVZj: snapMod,
        hkRbw: placementMod,
        eAKuV: tooltipMod,
        ayMG0: jsxMod,
    };

    const fn = new Function(
        "window",
        "document",
        "globalThis",
        "XMLHttpRequest",
        "Node",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        loaderSource,
    );
    const fakeGlobal = {
        __trafficityUndoModule: {},
        __trafficityGameState: { cursorMode: { mode: "road placement", startPoint: null } },
        __trafficityRouterRequire: (id) => routerModules[id] || null,
        dispatchEvent: () => {},
    };
    fn(fakeWindow, fakeDoc, fakeGlobal, FakeXhr, function FakeNode() {}, () => 1, () => {});

    const api = fakeWindow.TrafficityMods;
    const { game } = api;

    // 1. getCursorState
    assert.deepEqual(game.getCursorState(), { mode: "road placement", startPoint: null });

    // 2. Composable hookRoadSnap & hookRoadPlacement with 2 mods + unsubscribe
    const unsubSnap1 = game.hookRoadSnap((orig) => (gs, x, y) => {
        const res = orig(gs, x, y);
        return { ...res, x: res.x + 10 };
    });
    const unsubSnap2 = game.hookRoadSnap((orig) => (gs, x, y) => {
        const res = orig(gs, x, y);
        return { ...res, y: res.y + 20 };
    });
    assert.deepEqual(snapMod.getNearestLaneCreationPoint({}, 1, 2), { type: "absolute", x: 11, y: 22 });
    unsubSnap1();
    assert.deepEqual(snapMod.getNearestLaneCreationPoint({}, 1, 2), { type: "absolute", x: 1, y: 22 });
    unsubSnap2();
    assert.deepEqual(snapMod.getNearestLaneCreationPoint({}, 1, 2), { type: "absolute", x: 1, y: 2 });

    const unsubPlace1 = game.hookRoadPlacement((orig) => (gs, s, e) => {
        const r = orig(gs, s, e);
        return { ...r, calls: [...r.calls, "mod1"] };
    });
    const unsubPlace2 = game.hookRoadPlacement((orig) => (gs, s, e) => {
        const r = orig(gs, s, e);
        return { ...r, calls: [...r.calls, "mod2"] };
    });
    assert.deepEqual(placementMod.getRoadConstructionActionWithPlacement({}, "s", "e").calls, ["base", "mod1", "mod2"]);
    unsubPlace1();
    unsubPlace2();

    // 3. Stacked addBuildingTooltipLine from two mods
    game.addBuildingTooltipLine("eco-scrubber", "Line 1");
    game.addBuildingTooltipLine("eco-scrubber", () => "Line 2");
    await new Promise((r) => setTimeout(r, 0));
    const rendered = tooltipMod.BuildingTypeTooltip({ buildingDefinition: { type: "eco-scrubber" } });
    assert.equal(rendered.props.children.length, 3);
    assert.equal(rendered.props.children[1].props.children, "Line 1");
    assert.equal(rendered.props.children[2].props.children, "Line 2");

    // 4. bindKey & onMouse return unsubscribe functions
    let keyHits = 0;
    const unbindKey = api.bindKey("Alt+k", () => { keyHits += 1; });
    const keydownListener = [...winListeners.get("keydown")][0];
    keydownListener({ type: "keydown", code: "KeyK", key: "k", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(keyHits, 1);
    unbindKey();
    keydownListener({ type: "keydown", code: "KeyK", key: "k", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(keyHits, 1);

    let wheelHits = 0;
    const unbindWheel = api.onMouse("wheel", () => { wheelHits += 1; });
    assert.equal(winListeners.get("wheel").size, 1);
    unbindWheel();
    assert.equal(winListeners.get("wheel").size, 0);
    assert.equal(wheelHits, 0);

    // 5. addOverlay returns host element synchronously when document.body exists
    const host = api.addOverlay("test-hud", "<span>Hi</span>");
    assert.ok(host);
    assert.equal(host.id, "tmod-overlay-test-hud");
});

test("dev-bridge HTTP endpoints and MCP server handle console logs and eval round-trip", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-devbridge-test-"));
    const rootDir = path.join(tmp, "app");
    const savesDir = path.join(tmp, "userData", "saves");
    await fsp.mkdir(path.join(rootDir, "electron"), { recursive: true });
    await fsp.mkdir(path.join(rootDir, "dist"), { recursive: true });
    await fsp.writeFile(path.join(rootDir, "electron", "mod-loader.js"), "// loader\n");

    const handler = createModRequestHandler({ rootDir, getPlayerSavesDir: async () => savesDir });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!(await handler(req, res, url))) {
            res.statusCode = 404;
            res.end("not found");
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 1. Console push writes dev-bridge.json and populates ring buffer
        const pushRes = await fetch(`${baseUrl}/api/dev/console/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entries: [
                    { ts: 1000, level: "info", text: "boot ok" },
                    { ts: 1001, level: "error", text: "boom error" },
                ],
            }),
        });
        assert.equal(pushRes.status, 200);
        const bridgeFile = path.join(tmp, "userData", "dev-bridge.json");
        assert.equal(fs.existsSync(bridgeFile), true);
        assert.equal(JSON.parse(await fsp.readFile(bridgeFile, "utf8")).url, baseUrl);

        // 2. Query filtered logs
        const errLogs = await (await fetch(`${baseUrl}/api/dev/console?level=error&q=boom`)).json();
        assert.equal(errLogs.entries.length, 1);
        assert.equal(errLogs.entries[0].text, "boom error");

        // 3. Eval round-trip (external POST /api/dev/eval + renderer poll + result)
        const evalPromise = fetch(`${baseUrl}/api/dev/eval`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "1 + 2" }),
        });
        await new Promise((r) => setTimeout(r, 20));
        const polled = await (await fetch(`${baseUrl}/api/dev/eval/poll`)).json();
        assert.equal(polled.items.length, 1);
        assert.equal(polled.items[0].code, "1 + 2");

        await fetch(`${baseUrl}/api/dev/eval/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: polled.items[0].id, ok: true, result: 3 }),
        });
        const evalRes = await (await evalPromise).json();
        assert.deepEqual(evalRes, { ok: true, result: 3 });

        // 4. MCP handler initialize + tools/list
        const { handleMcpRequest } = await import("../src/mcp-server.mjs");
        const initRes = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
        assert.equal(initRes.result.serverInfo.name, "trafficity-dev-bridge");
        const listRes = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        assert.deepEqual(
            listRes.result.tools.map((t) => t.name),
            ["get_console_logs", "eval_in_game"],
        );
    } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("passive disk logger rotates sessions, writes crash snapshots, and readDiskLogs filters them", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-passive-log-"));
    const modsDir = path.join(tmp, "mods");
    const logsDir = path.join(modsDir, "logs");
    const origEnv = process.env.TRAFFICITY_MODS_DIR;
    process.env.TRAFFICITY_MODS_DIR = modsDir;

    try {
        await fsp.mkdir(logsDir, { recursive: true });
        await fsp.writeFile(path.join(logsDir, "latest.log"), "previous session line\n", "utf8");
        for (let i = 0; i < 11; i++) {
            const p = path.join(logsDir, `session-2026-01-01T00-00-${String(i).padStart(2, "0")}.log`);
            await fsp.writeFile(p, `old ${i}\n`, "utf8");
        }

        const { createSessionLogger } = await import("../src/mod-api.cjs");
        const logger = createSessionLogger({ maxSessions: 10, maxBytes: 1024 * 1024 });
        logger.appendSync(modsDir, { ts: Date.now(), level: "info", text: "boot ok" });
        logger.appendSync(modsDir, { ts: Date.now(), level: "error", text: "[Uncaught Error] boom", crash: true });

        const files = await fsp.readdir(logsDir);
        assert.ok(files.includes("latest.log"));
        const archives = files.filter((f) => /^(session|crash)-.+\.log$/i.test(f));
        assert.ok(archives.length <= 10, `expected <= 10 archives, got ${archives.length}`);
        assert.ok(archives.some((f) => f.startsWith("crash-")));

        const { readDiskLogs } = await import("../src/dev-bridge-cli.mjs");
        const latestRes = await readDiskLogs({ modsDir, level: "error" });
        assert.ok(latestRes.lines.some((l) => l.includes("[Uncaught Error] boom")));
        assert.ok(!latestRes.lines.some((l) => l.includes("boot ok")));

        const crashRes = await readDiskLogs({ modsDir, crashes: true });
        assert.ok(crashRes.lines.some((l) => l.includes("Trafficity Crash Snapshot")));
        assert.ok(crashRes.lines.some((l) => l.includes("boot ok")));
    } finally {
        if (origEnv === undefined) delete process.env.TRAFFICITY_MODS_DIR;
        else process.env.TRAFFICITY_MODS_DIR = origEnv;
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});
