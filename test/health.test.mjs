import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import { runHealthCheck } from "../src/health.mjs";
import { scaffoldMod } from "../src/mod-tools.mjs";
import { patchAsar } from "../src/patch.mjs";

const MOCK_MAIN_JS = `
const { app, ipcMain, shell } = require("electron");
const { getPlayerSavesDir } = require("../player-saves/store");
let mainWindow = null;
const main = async () => {};
main();
`;

const MOCK_PRELOAD_JS = `
contextBridge.exposeInMainWorld("trafficityDesktop", {
    clearSteamAchievements: (names) => {
        ipcRenderer.send("steam-clear-achievements", names);
    },
});
`;

const MOCK_STATIC_SERVER_JS = `
const http = require("node:http");
const createRequestListener = (rootDir) => {
    return async (req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/dev-saves/")) {
            return;
        }
    };
};
`;

const MOCK_ROUTER_JS = [
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

test("runHealthCheck reports pass on healthy patched gameDir and scaffolded modsDir", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-health-ok-"));
    const gameDir = path.join(tmp, "game");
    const srcDir = path.join(tmp, "asar-src");
    const modsDir = path.join(tmp, "mods");

    try {
        await fsp.mkdir(path.join(srcDir, "electron"), { recursive: true });
        await fsp.mkdir(path.join(srcDir, "dist"), { recursive: true });
        await fsp.mkdir(path.join(gameDir, "resources"), { recursive: true });
        await fsp.writeFile(path.join(srcDir, "electron", "main.js"), MOCK_MAIN_JS);
        await fsp.writeFile(path.join(srcDir, "electron", "preload.js"), MOCK_PRELOAD_JS);
        await fsp.writeFile(path.join(srcDir, "electron", "static-server.js"), MOCK_STATIC_SERVER_JS);
        await fsp.writeFile(path.join(srcDir, "dist", "index.html"), '<html><head><script type="module" src="/assets/index.js"></script></head><body></body></html>');
        await fsp.writeFile(path.join(srcDir, "dist", "Router.test.js"), MOCK_ROUTER_JS);
        await fsp.writeFile(path.join(srcDir, "dist", "error-reporting.json"), JSON.stringify({ release: "1.0.0-test" }));

        const asarPath = path.join(gameDir, "resources", "app.asar");
        await asar.createPackage(srcDir, asarPath);
        await patchAsar(asarPath);

        await scaffoldMod({ id: "healthy-mod", targetDir: modsDir });

        const report = await runHealthCheck({ gameDir, modsDir, checkRemote: false });
        assert.equal(report.ok, true);
        assert.equal(report.errors, 0);
        assert.equal(report.warnings, 0);
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("runHealthCheck flags missing gameDir and broken mod.json", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-health-bad-"));
    const modsDir = path.join(tmp, "mods");

    try {
        await fsp.mkdir(path.join(modsDir, "broken-mod"), { recursive: true });
        await fsp.writeFile(path.join(modsDir, "broken-mod", "mod.json"), "{ not valid json");

        const report = await runHealthCheck({
            gameDir: path.join(tmp, "missing-game"),
            modsDir,
            checkRemote: false,
        });
        assert.equal(report.ok, false);
        assert.ok(report.errors >= 2);
        const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
        assert.equal(byId["game-install"].status, "fail");
        assert.equal(byId["mods-validation"].status, "fail");
        assert.equal(byId["mods-workspace"].fixAction, "sync-types");
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});
