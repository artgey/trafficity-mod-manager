import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("measuring-grid manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf-8"));
    assert.equal(manifest.id, "measuring-grid");
    assert.equal(manifest.entry, "mod.js");
    assert.deepEqual(manifest.styles, ["style.css"]);
});

test("measuring-grid uses road step presets (3u), snaps absolute points with Alt+S, and computes grid lines", async () => {
    const bindings = new Map();
    const savedConfigs = [];
    let currentCfg = { enabled: false, snapEnabled: false, presetIndex: 0 };

    const snapModule = {
        getNearestLaneCreationPoint: (_gs, x, y) => ({ type: "absolute", x, y }),
    };

    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.document = {
        body: null,
        getElementById: () => null,
    };
    globalThis.window = {
        TrafficityMods: {
            bindKey: (combo, handler) => bindings.set(combo, handler),
            getConfig: () => currentCfg,
            setConfig: (_id, cfg) => {
                currentCfg = cfg;
                savedConfigs.push(cfg);
            },
            game: {
                getConstants: () => ({ laneWidth: 20, lanePointSpacing: 3 }),
                getCameraState: () => ({ x: 0, y: 0, zoom: 1, width: 100, height: 100 }),
                getSnapApi: () => ({ snapModule }),
            },
        },
        addEventListener() {},
    };

    try {
        const { computeGridLines, GRANULARITY_PRESETS } = await import(`./mod.js?t=${Date.now()}`);

        assert.equal(bindings.has("Alt+g"), true);
        assert.equal(bindings.has("Alt+s"), true);
        assert.equal(bindings.has("BracketLeft"), true);
        assert.equal(bindings.has("BracketRight"), true);

        // Toggle ON (default presetIndex=0 -> 1x road step = 3u)
        assert.equal(bindings.get("Alt+g")(), true);
        assert.equal(savedConfigs.at(-1).enabled, true);
        assert.equal(savedConfigs.at(-1).presetIndex, 0);

        // Step coarser ']' -> 2x step (6u), 5x step (15u), 1x lane (20u)
        assert.equal(bindings.get("BracketRight")(), 1);
        assert.equal(GRANULARITY_PRESETS[1].mult, 2);
        assert.equal(bindings.get("BracketRight")(), 2);
        assert.equal(bindings.get("BracketRight")(), 3);
        assert.equal(GRANULARITY_PRESETS[3].kind, "lane");

        // Enable snapping (Alt+S) at 1x lane = 20u
        assert.equal(bindings.get("Alt+s")(), true);
        const snapped = snapModule.getNearestLaneCreationPoint({}, 27.4, 33.1);
        assert.equal(snapped.x, 20);
        assert.equal(snapped.y, 40);

        // Compute grid lines at 3u road step with zoom=2 (6px per cell -> no auto-coarsen)
        const lines = computeGridLines({ camX: 0, camY: 0, zoom: 2, width: 60, height: 60, stepWorld: 3, majorEvery: 5 });
        assert.equal(lines.effectiveStepWorld, 3);
        assert.equal(lines.vertical[0].pos, 0);
        assert.equal(lines.vertical[0].major, true);
        assert.equal(lines.vertical[1].pos, 6);
        assert.equal(lines.vertical[1].major, false);

        // Auto-coarsen when zoomed far out (< 4px per cell)
        const zoomedOut = computeGridLines({ camX: 0, camY: 0, zoom: 0.5, width: 100, height: 100, stepWorld: 3 });
        assert.equal(zoomedOut.effectiveStepWorld, 12);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});
