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

test("snap-perf-fix sets tighter search bounds, zoom-aware LRU caches snap, roundabout & road-placement, and invalidates on revision", async () => {
    let origSnapCalls = 0;
    let origRoundaboutCalls = 0;
    let origPlacementCalls = 0;
    const snapModule = {};
    Object.defineProperty(snapModule, "getNearestLaneCreationPoint", {
        configurable: true,
        enumerable: true,
        get: () => (gs, x, y) => {
            origSnapCalls += 1;
            gs.draftMidpointToMidpointNinetySnapActive = x > 50;
            return { type: "midpoint", x, y };
        },
    });

    const roundaboutMod = {};
    Object.defineProperty(roundaboutMod, "getPlaceRoundaboutResultForSize", {
        configurable: true,
        enumerable: true,
        get: () => (_gs, center, size) => {
            origRoundaboutCalls += 1;
            return { result: { center, size }, radius: 40 };
        },
    });

    const placementMod = {};
    Object.defineProperty(placementMod, "getRoadConstructionActionWithPlacement", {
        configurable: true,
        enumerable: true,
        get: () => (_gs, startPt, endPt) => {
            origPlacementCalls += 1;
            return { constructionAction: { exists: true, startPt, endPt }, draftRoadPlacement: { isPlacementBlocked: false } };
        },
    });

    let snapConfig = null;
    globalThis.window = {
        TrafficityMods: {
            game: {
                getSnapApi: () => ({ snapModule }),
                requireRouterModule: (id) => (id === "8lnVn" ? roundaboutMod : id === "hkRbw" ? placementMod : null),
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
        assert.deepEqual(snapConfig, { maxSteps: 3, stride: 4, suppressLog: true });

        const gs = {
            saveState: {
                worldRevision: 1,
                cameraZoom: 0.5, // step = 4u
                roadPlacementElevation: 0,
                roadPlacementMode: "straight",
                angleSnappingEnabled: true,
            },
            keysPressed: new Set(),
            draftMidpointToMidpointNinetySnapActive: false,
        };
        const road = { name: "Two lane" };

        const r1 = snapModule.getNearestLaneCreationPoint(gs, 60.1, 20.1, road, null);
        assert.equal(origSnapCalls, 1);
        assert.equal(gs.draftMidpointToMidpointNinetySnapActive, true);

        // Jitter within 4u zoom-aware bucket -> cache hit!
        gs.draftMidpointToMidpointNinetySnapActive = false;
        const r2 = snapModule.getNearestLaneCreationPoint(gs, 61.2, 21.2, road, null);
        assert.equal(origSnapCalls, 1);
        assert.equal(r2, r1);
        assert.equal(gs.draftMidpointToMidpointNinetySnapActive, true);

        // Move mouse -> cache miss; move back -> LRU hit!
        snapModule.getNearestLaneCreationPoint(gs, 80, 20, road, null);
        assert.equal(origSnapCalls, 2);
        snapModule.getNearestLaneCreationPoint(gs, 60.1, 20.1, road, null);
        assert.equal(origSnapCalls, 2);

        // Roundabout placement memoization
        const rb1 = roundaboutMod.getPlaceRoundaboutResultForSize(gs, { x: 100, y: 100 }, "small");
        const rb2 = roundaboutMod.getPlaceRoundaboutResultForSize(gs, { x: 101, y: 100.5 }, "small");
        assert.equal(origRoundaboutCalls, 1);
        assert.equal(rb2, rb1);

        // Road-to-roundabout placement memoization (hkRbw)
        const sPt = { type: "absolute", x: 0, y: 0, elevation: 0, lanesWide: 4 };
        const ePt = { type: "midpoint", locator: { laneSectionId: 9, pointIndex: 12 } };
        const p1 = placementMod.getRoadConstructionActionWithPlacement(gs, sPt, ePt);
        const p2 = placementMod.getRoadConstructionActionWithPlacement(gs, sPt, ePt);
        assert.equal(origPlacementCalls, 1);
        assert.equal(p2, p1);

        // World revision change -> invalidates all caches
        gs.saveState.worldRevision = 2;
        snapModule.getNearestLaneCreationPoint(gs, 80, 20, road, null);
        roundaboutMod.getPlaceRoundaboutResultForSize(gs, { x: 100, y: 100 }, "small");
        placementMod.getRoadConstructionActionWithPlacement(gs, sPt, ePt);
        assert.equal(origSnapCalls, 3);
        assert.equal(origRoundaboutCalls, 2);
        assert.equal(origPlacementCalls, 2);
    } finally {
        delete globalThis.window;
        delete globalThis.__trafficityMaxSnapSearchSteps;
        delete globalThis.__trafficitySnapSearchStride;
        delete globalThis.__trafficitySuppressSnapLog;
    }
});
