// Standalone Redo mod hooking Trafficity's f5Ojv undo journal via TrafficityMods.game.
const getMods = () => (typeof window !== "undefined" ? window.TrafficityMods : null);

const resolveRenamed = (map, id) => {
    if (!map || typeof map.get !== "function") return id;
    let cur = id;
    const seen = new Set();
    while (map.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = map.get(cur);
    }
    return cur;
};

export const buildRedoSubRecord = (subRecord, gameState, history) => {
    if (!subRecord || subRecord.kind !== "confirm" || !subRecord.record) {
        return null;
    }
    const r = subRecord.record;
    const ss = gameState?.saveState;
    const renames = history?.renames;

    const swapBeforeAfter = (arr) =>
        Array.isArray(arr) ? arr.map((item) => ({ ...item, before: item.after, after: item.before })) : [];

    const snapshotRemovedLaneSections = (r.createdLaneSections || []).map((item) => {
        const liveId = resolveRenamed(renames?.laneSection, item.id);
        const live = ss?.laneSections?.[liveId];
        if (!live || !live.points) {
            throw new Error(`Missing live laneSection ${liveId} for redo snapshot`);
        }
        return {
            id: item.id,
            links: item.links,
            points: typeof live.points.withoutLocks === "function" ? live.points.withoutLocks() : live.points,
        };
    });

    const snapshotRemovedCrossables = (arr, dict) =>
        (arr || []).map((item) => {
            const liveId = resolveRenamed(renames?.crossable, item.id);
            const live = dict?.[liveId];
            return live ? { ...live, id: item.id } : item;
        });

    const newCreatedLaneSections = (r.removedLaneSections || []).map((item) => ({
        id: item.id,
        links: item.links,
        coords: item.points?.coords ?? null,
    }));

    return {
        kind: "confirm",
        record: {
            ...r,
            createdLaneSections: newCreatedLaneSections,
            removedLaneSections: snapshotRemovedLaneSections,
            createdJunctions: r.removedJunctions || [],
            removedJunctions: snapshotRemovedCrossables(r.createdJunctions, ss?.junctions),
            createdIntersections: r.removedIntersections || [],
            removedIntersections: snapshotRemovedCrossables(r.createdIntersections, ss?.intersections),
            changedLaneSections: swapBeforeAfter(r.changedLaneSections),
            changedJunctions: swapBeforeAfter(r.changedJunctions),
            changedIntersections: swapBeforeAfter(r.changedIntersections),
            changedBuildingTargets: swapBeforeAfter(r.changedBuildingTargets),
        },
    };
};

export const createRedoController = () => {
    const redoStack = [];
    let lastSaveState = null;
    let lastKnownEntriesLen = 0;
    let hookedModule = null;

    const readUndoApi = () => {
        const m = getMods();
        if (m && m.game && typeof m.game.getUndoApi === "function") {
            return m.game.getUndoApi();
        }
        return {
            undoModule: null,
            undoHistory: null,
            gameState: null,
            undoDeps: null,
        };
    };

    const getHistory = (gameState) => {
        const { undoHistory } = readUndoApi();
        if (!gameState || !gameState.saveState || !undoHistory || typeof undoHistory.getUndoHistory !== "function") {
            return null;
        }
        return undoHistory.getUndoHistory(gameState.saveState);
    };

    const syncInvalidation = (gameState) => {
        if (!gameState || !gameState.saveState) return null;
        const history = getHistory(gameState);
        if (!history) return null;
        if (lastSaveState !== gameState.saveState) {
            redoStack.length = 0;
            lastSaveState = gameState.saveState;
            lastKnownEntriesLen = history.entries.length;
        } else if (history.entries.length !== lastKnownEntriesLen) {
            redoStack.length = 0;
            lastKnownEntriesLen = history.entries.length;
        }
        return history;
    };

    const installUndoHook = () => {
        const { undoModule: mod } = readUndoApi();
        if (!mod || hookedModule === mod) {
            return hookedModule === mod && Boolean(mod);
        }
        let origUndo;
        try {
            origUndo = mod.undoLastAction;
        } catch {
            // f5Ojv module bindings may still be in TDZ during synchronous init
            return false;
        }
        if (typeof origUndo !== "function") {
            return false;
        }
        Object.defineProperty(mod, "undoLastAction", {
            configurable: true,
            enumerable: true,
            value: (gameState, deps) => {
                globalThis.__trafficityGameState = gameState;
                globalThis.__trafficityUndoDeps = deps;
                const history = syncInvalidation(gameState);
                const topEntry = history && history.entries.length > 0 ? history.entries[history.entries.length - 1] : null;

                let redoSubRecords = null;
                if (topEntry && Array.isArray(topEntry.subRecords)) {
                    try {
                        const built = [];
                        for (const sub of topEntry.subRecords) {
                            const rSub = buildRedoSubRecord(sub, gameState, history);
                            if (!rSub) {
                                built.length = 0;
                                break;
                            }
                            built.push(rSub);
                        }
                        if (built.length > 0) redoSubRecords = built;
                    } catch (err) {
                        console.warn("[redo-mod] Snapshot skipped:", err);
                    }
                }

                const result = origUndo(gameState, deps);
                if (result === "undone" && topEntry && history) {
                    if (redoSubRecords) {
                        redoStack.push({
                            origEntry: topEntry,
                            redoSubRecords,
                            moneyDelta: topEntry.moneyDelta || 0,
                        });
                    }
                    lastKnownEntriesLen = history.entries.length;
                }
                return result;
            },
        });
        hookedModule = mod;
        return true;
    };

    const redo = () => {
        installUndoHook();
        const { undoModule: mod, gameState, undoDeps: deps } = readUndoApi();
        if (!gameState || !deps || !mod || typeof mod.applyUndoSubRecord !== "function") {
            return "unavailable";
        }
        if (gameState.mouseIsDown || gameState.isModalDialogOpen) {
            return "busy";
        }
        const history = syncInvalidation(gameState);
        if (!history || history.openGroup !== null || redoStack.length === 0) {
            return "nothing";
        }

        const item = redoStack.pop();
        try {
            for (const inv of item.redoSubRecords) {
                mod.applyUndoSubRecord(gameState, history, inv, deps);
            }
            history.entries.push(item.origEntry);
            lastKnownEntriesLen = history.entries.length;
            if (typeof item.moneyDelta === "number" && item.moneyDelta !== 0) {
                gameState.saveState.money += item.moneyDelta;
            }
            const m = getMods();
            if (m && m.game && typeof m.game.playSfx === "function") {
                m.game.playSfx("placeRoad");
            }
            if (typeof gameState.requestUiRefresh === "function") {
                gameState.requestUiRefresh();
            }
            return "redone";
        } catch (err) {
            console.error("[redo-mod] Redo failed:", err);
            redoStack.length = 0;
            return "failed";
        }
    };

    return {
        installUndoHook,
        redo,
        canRedo: () => redoStack.length > 0,
        clear: () => {
            redoStack.length = 0;
        },
    };
};

const mods = getMods();
if (mods) {
    const controller = createRedoController();
    if (!controller.installUndoHook()) {
        if (mods.game && typeof mods.game.on === "function") {
            mods.game.on("ready", () => controller.installUndoHook());
        } else {
            const onReady = () => controller.installUndoHook();
            window.addEventListener("trafficity:undo-ready", onReady);
            window.addEventListener("load", onReady, { once: true });
        }
    }

    mods.provide("redo", {
        redo: controller.redo,
        canRedo: controller.canRedo,
        clear: controller.clear,
    });

    mods.bindKey("Ctrl+y", () => controller.redo());
    mods.bindKey("Ctrl+Shift+z", () => controller.redo());
}
