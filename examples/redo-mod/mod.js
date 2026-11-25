// Standalone Redo mod hooking Trafficity's undo journal via TrafficityMods.game.

/**
 * @param {Map<number | string, number | string> | undefined} map
 * @param {number | string} id
 */
const resolveRenamed = (map, id) => {
    if (!map || typeof map.get !== "function") return id;
    let cur = id;
    const seen = new Set();
    while (map.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        const next = map.get(cur);
        if (next === undefined) break;
        cur = next;
    }
    return cur;
};

/**
 * @param {TrafficityUndoSubRecord | null | undefined} subRecord
 * @param {TrafficityGameState | null | undefined} gameState
 * @param {TrafficityUndoHistory | null | undefined} history
 * @returns {TrafficityUndoSubRecord | null}
 */
export const buildRedoSubRecord = (subRecord, gameState, history) => {
    if (!subRecord || subRecord.kind !== "confirm" || !subRecord.record) {
        return null;
    }
    const r = subRecord.record;
    const ss = gameState?.saveState;
    const renames = history?.renames;

    /** @param {Array<{ before: unknown, after: unknown, [key: string]: unknown }> | undefined} arr */
    const swapBeforeAfter = (arr) =>
        Array.isArray(arr) ? arr.map((item) => ({ ...item, before: item.after, after: item.before })) : [];

    const snapshotRemovedLaneSections = (r.createdLaneSections || []).map((item) => {
        const liveId = resolveRenamed(renames?.laneSection, item.id);
        const live = ss?.laneSections?.[String(liveId)];
        if (!live || !live.points) {
            throw new Error(`Missing live laneSection ${liveId} for redo snapshot`);
        }
        return {
            id: item.id,
            links: item.links,
            points: /** @type {{ coords?: unknown, withoutLocks?: () => unknown }} */ (
                typeof live.points.withoutLocks === "function" ? live.points.withoutLocks() : live.points
            ),
        };
    });

    /**
     * @param {Array<{ id: number | string, [key: string]: unknown }> | undefined} arr
     * @param {Record<string, Record<string, unknown>> | undefined} dict
     */
    const snapshotRemovedCrossables = (arr, dict) =>
        (arr || []).map((item) => {
            const liveId = resolveRenamed(renames?.crossable, item.id);
            const live = dict?.[String(liveId)];
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

/** @param {TrafficityGameFacade} [gameFacade] */
export const createRedoController = (gameFacade) => {
    /** @type {Array<{ origEntry: TrafficityUndoEntry, redoSubRecords: TrafficityUndoSubRecord[], moneyDelta: number }>} */
    const redoStack = [];
    /** @type {TrafficitySaveState | null} */
    let lastSaveState = null;
    let lastKnownEntriesLen = 0;
    /** @type {TrafficityUndoModule | null} */
    let hookedModule = null;
    /** @type {TrafficityGameState | null} */
    let capturedGameState = null;
    /** @type {Record<string, unknown> | null} */
    let capturedUndoDeps = null;

    const getGame = () => gameFacade || (typeof window !== "undefined" ? window.TrafficityMods?.game : null) || null;

    const readUndoApi = () => {
        const g = getGame();
        if (g && typeof g.getUndoApi === "function") {
            return g.getUndoApi();
        }
        return {
            undoModule: null,
            undoHistory: null,
            gameState: null,
            undoDeps: null,
        };
    };

    /** @param {TrafficityGameState | null | undefined} gameState */
    const getHistory = (gameState) => {
        const { undoHistory } = readUndoApi();
        if (!gameState || !gameState.saveState || !undoHistory || typeof undoHistory.getUndoHistory !== "function") {
            return null;
        }
        return undoHistory.getUndoHistory(gameState.saveState);
    };

    /** @param {TrafficityGameState | null | undefined} gameState */
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
        /** @type {((gameState: TrafficityGameState, deps: Record<string, unknown>) => string) | undefined} */
        let origUndo;
        try {
            origUndo = mod.undoLastAction;
        } catch {
            // Undo module bindings may still be in TDZ during synchronous init
            return false;
        }
        if (typeof origUndo !== "function") {
            return false;
        }
        const originalUndo = origUndo;
        Object.defineProperty(mod, "undoLastAction", {
            configurable: true,
            enumerable: true,
            value: (/** @type {TrafficityGameState} */ gameState, /** @type {Record<string, unknown>} */ deps) => {
                capturedGameState = gameState;
                capturedUndoDeps = deps;
                const history = syncInvalidation(gameState);
                const topEntry = history && history.entries.length > 0 ? history.entries[history.entries.length - 1] : null;

                /** @type {TrafficityUndoSubRecord[] | null} */
                let redoSubRecords = null;
                if (topEntry && Array.isArray(topEntry.subRecords)) {
                    try {
                        /** @type {TrafficityUndoSubRecord[]} */
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

                const result = originalUndo(gameState, deps);
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

    /** @returns {"unavailable" | "busy" | "nothing" | "redone" | "failed"} */
    const redo = () => {
        installUndoHook();
        const api = readUndoApi();
        const mod = api.undoModule;
        const gameState = api.gameState || capturedGameState;
        const deps = api.undoDeps || capturedUndoDeps;
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
        if (!item) return "nothing";
        try {
            for (const inv of item.redoSubRecords) {
                mod.applyUndoSubRecord(gameState, history, inv, deps);
            }
            history.entries.push(item.origEntry);
            lastKnownEntriesLen = history.entries.length;
            if (typeof item.moneyDelta === "number" && item.moneyDelta !== 0 && gameState.saveState) {
                gameState.saveState.money += item.moneyDelta;
            }
            const g = getGame();
            if (g && typeof g.playSfx === "function") {
                g.playSfx("placeRoad");
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

/**
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 */
export default function setupRedoMod(mods, game) {
    const controller = createRedoController(game);
    if (!controller.installUndoHook() && game && typeof game.on === "function") {
        game.on("ready", () => { controller.installUndoHook(); });
    }

    mods.provide("redo", {
        redo: controller.redo,
        canRedo: controller.canRedo,
        clear: controller.clear,
    });

    mods.bindKey("Ctrl+y", () => { controller.redo(); });
    mods.bindKey("Ctrl+Shift+z", () => { controller.redo(); });
}
