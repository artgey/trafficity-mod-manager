import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("snap-perf-fix manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf-8"));
    assert.equal(manifest.id, "snap-perf-fix");
    assert.equal(manifest.entry, "mod.js");
});

test("snap-perf-fix sets search bounds, memoizes unchanged/subpixel calls, and invalidates on revision or move", async () => {
    let origCalls = 0;
    const snapModule = {};
    Object.defineProperty(snapModule, "getNearestLaneCreationPoint", {
        configurable: true,
        enumerable: true,
        get: () => (gs, x, y) => {
            origCalls += 1;
            gs.draftMidpointToMidpointNinetySnapActive = x > 50;
            return { type: "midpoint", x, y };
        },
    });

    let snapConfig = null;
    globalThis.window = {
        TrafficityMods: {
            game: {
                getSnapApi: () => ({ snapModule }),
                configureSnapSearch: (opts) => {
                    snapConfig = { ...opts };
                    return snapConfig;
                },
            },
        },
        addEventListener() {},
    };

    try {
        await import(`./mod.js?t=${Date.now()}`);
        assert.deepEqual(snapConfig, { maxSteps: 5, stride: 3, suppressLog: true });

        const gs = {
            saveState: { worldRevision: 1, roadPlacementElevation: 0, roadPlacementMode: "straight", angleSnappingEnabled: true },
            keysPressed: new Set(),
            draftMidpointToMidpointNinetySnapActive: false,
        };
        const road = { name: "Two lane" };

        const r1 = snapModule.getNearestLaneCreationPoint(gs, 60.1, 20.1, road, null);
        assert.equal(origCalls, 1);
        assert.equal(gs.draftMidpointToMidpointNinetySnapActive, true);

        // Sub-pixel jitter within 0.5 world-unit bucket -> cache hit!
        gs.draftMidpointToMidpointNinetySnapActive = false;
        const r2 = snapModule.getNearestLaneCreationPoint(gs, 60.2, 20.2, road, null);
        assert.equal(origCalls, 1);
        assert.equal(r2, r1);
        assert.equal(gs.draftMidpointToMidpointNinetySnapActive, true);

        // Move mouse -> cache miss
        snapModule.getNearestLaneCreationPoint(gs, 75, 20, road, null);
        assert.equal(origCalls, 2);

        // World revision change -> cache miss
        gs.saveState.worldRevision = 2;
        snapModule.getNearestLaneCreationPoint(gs, 75, 20, road, null);
        assert.equal(origCalls, 3);
    } finally {
        delete globalThis.window;
        delete globalThis.__trafficityMaxSnapSearchSteps;
        delete globalThis.__trafficitySnapSearchStride;
        delete globalThis.__trafficitySuppressSnapLog;
    }
});
