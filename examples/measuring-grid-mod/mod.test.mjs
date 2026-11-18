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

test("measuring-grid computes world-aligned lines, toggles with Alt+G, and adjusts granularity with [ and ]", async () => {
    const bindings = new Map();
    const savedConfigs = [];
    let currentCfg = { enabled: false, presetIndex: 2 };

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
                getConstants: () => ({ laneWidth: 14, lanePointSpacing: 10 }),
                getCameraState: () => ({ x: 0, y: 0, zoom: 1, width: 100, height: 100 }),
            },
        },
        addEventListener() {},
    };

    try {
        const { computeGridLines, GRANULARITY_PRESETS } = await import(`./mod.js?t=${Date.now()}`);

        assert.equal(bindings.has("Alt+g"), true);
        assert.equal(bindings.has("BracketLeft"), true);
        assert.equal(bindings.has("BracketRight"), true);

        // Toggle ON (default presetIndex=2 -> 2x LANE_WIDTH = 28)
        assert.equal(bindings.get("Alt+g")(), true);
        assert.equal(savedConfigs.at(-1).enabled, true);
        assert.equal(savedConfigs.at(-1).presetIndex, 2);

        // Step finer '[' and coarser ']'
        assert.equal(bindings.get("BracketLeft")(), 1);
        assert.equal(GRANULARITY_PRESETS[1], 1);
        assert.equal(bindings.get("BracketRight")(), 2);
        assert.equal(bindings.get("BracketRight")(), 3);

        // Compute grid lines
        const lines = computeGridLines({ camX: 0, camY: 0, zoom: 1, width: 100, height: 100, stepWorld: 28 });
        assert.equal(lines.effectiveStepWorld, 28);
        assert.equal(lines.vertical[0].pos, 0);
        assert.equal(lines.vertical[0].major, true);
        assert.equal(lines.vertical[1].pos, 28);
        assert.equal(lines.vertical[1].major, false);

        // Auto-coarsen when zoomed far out (< 8px per cell)
        const zoomedOut = computeGridLines({ camX: 0, camY: 0, zoom: 0.1, width: 100, height: 100, stepWorld: 28 });
        assert.equal(zoomedOut.effectiveStepWorld, 112);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.requestAnimationFrame;
        delete globalThis.cancelAnimationFrame;
    }
});
