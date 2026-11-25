import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("redo-mod manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf-8"));
    assert.equal(manifest.id, "redo-mod");
    assert.equal(manifest.entry, "mod.js");
});

test("redo-mod snapshots live laneSections, plays placeRoad sfx via game facade, and provides redo service", async () => {
    const services = new Map();
    const bindings = new Map();
    const applied = [];
    const sfxPlayed = [];

    const history = {
        openGroup: null,
        renames: { laneSection: new Map(), crossable: new Map(), building: new Map() },
        entries: [
            {
                moneyDelta: -100,
                subRecords: [
                    {
                        kind: "confirm",
                        record: {
                            createdLaneSections: [{ id: "ls1", links: { a: 1 } }],
                            removedLaneSections: [],
                            createdJunctions: [],
                            removedJunctions: [{ id: "j1" }],
                            createdIntersections: [],
                            removedIntersections: [],
                            changedLaneSections: [{ id: "ls2", before: { a: 1 }, after: { a: 2 } }],
                            changedJunctions: [],
                            changedIntersections: [],
                            changedBuildingTargets: [],
                        },
                    },
                ],
            },
        ],
    };

    const livePoints = { coords: [0, 0, 10, 10], withoutLocks: () => ({ coords: [0, 0, 10, 10], unlocked: true }) };
    const gameState = {
        mouseIsDown: false,
        isModalDialogOpen: false,
        saveState: {
            money: 900,
            laneSections: {
                ls1: { id: "ls1", points: livePoints },
            },
            junctions: {},
            intersections: {},
        },
        requestUiRefresh() {},
    };

    const undoHistory = {
        getUndoHistory: () => history,
    };

    const undoMod = {};
    Object.defineProperty(undoMod, "undoLastAction", {
        configurable: true,
        enumerable: true,
        get: () => () => {
            history.entries.pop();
            delete gameState.saveState.laneSections.ls1;
            gameState.saveState.money += 100;
            return "undone";
        },
    });
    undoMod.applyUndoSubRecord = (_gs, _hist, sub) => {
        applied.push(sub);
    };

    const mockGame = {
        on: () => () => {},
        getUndoApi: () => ({
            undoModule: undoMod,
            undoHistory,
            gameState,
            undoDeps: { dep: true },
        }),
        playSfx: (name) => sfxPlayed.push(name),
    };
    const mockMods = {
        provide: (name, api) => services.set(name, api),
        bindKey: (combo, handler) => bindings.set(combo, handler),
        game: mockGame,
    };

    const { default: setupRedoMod, buildRedoSubRecord } = await import(`./mod.js?t=${Date.now()}`);
    setupRedoMod(mockMods, mockGame);
    const redoSvc = services.get("redo");
    assert.ok(redoSvc);
    assert.equal(redoSvc.canRedo(), false);
    assert.equal(bindings.has("Ctrl+y"), true);

    // Perform undo via hooked module
    assert.equal(undoMod.undoLastAction(gameState, { dep: true }), "undone");
    assert.equal(history.entries.length, 0);
    assert.equal(redoSvc.canRedo(), true);

    // Perform redo
    assert.equal(redoSvc.redo(), "redone");
    assert.equal(redoSvc.canRedo(), false);
    assert.equal(history.entries.length, 1);
    assert.equal(gameState.saveState.money, 900);
    assert.deepEqual(sfxPlayed, ["placeRoad"]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].record.removedLaneSections[0].points.unlocked, true);
    assert.deepEqual(applied[0].record.createdJunctions, [{ id: "j1" }]);
    assert.deepEqual(applied[0].record.changedLaneSections, [{ id: "ls2", before: { a: 2 }, after: { a: 1 } }]);

    assert.equal(buildRedoSubRecord({ kind: "buildings placed" }, gameState, history), null);
});
