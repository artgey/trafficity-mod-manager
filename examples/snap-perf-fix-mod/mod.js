const CACHE_LIMIT = 32;

/** @param {TrafficityRoadPointRef | null | undefined} startPoint */
export const fingerprintStartPoint = (startPoint) => {
    if (!startPoint) return "none";
    if (startPoint.type === "absolute") {
        return `abs:${startPoint.x},${startPoint.y},${startPoint.elevation},${startPoint.lanesWide}`;
    }
    if (startPoint.locator) {
        return `${startPoint.type}:${startPoint.locator.laneSectionId}:${startPoint.locator.pointIndex}:${startPoint._gluedToLocatorOn || ""}`;
    }
    if (Array.isArray(startPoint.spanEndLocators) && startPoint.spanEndLocators.length >= 2) {
        return `mid:${startPoint.spanEndLocators[0].laneSectionId}:${startPoint.spanEndLocators[0].pointIndex}:${startPoint.spanEndLocators[1].laneSectionId}:${startPoint.spanEndLocators[1].pointIndex}`;
    }
    return String(startPoint.type || "unknown");
};

/** @param {number | undefined} cameraZoom */
const quantizeStepForZoom = (cameraZoom) => {
    const z = Math.max(0.25, Number(cameraZoom) || 1);
    return Math.max(2, Math.min(8, 2 / z));
};

/**
 * @template T
 */
const createLruWorldCache = () => {
    /** @type {TrafficitySaveState | null | undefined} */
    let lastSaveState = null;
    /** @type {number | null} */
    let lastRevision = null;
    /** @type {Map<string, T>} */
    const map = new Map();

    /** @param {TrafficitySaveState | null | undefined} saveState */
    const sync = (saveState) => {
        const rev = saveState?.worldRevision ?? -1;
        if (saveState !== lastSaveState || rev !== lastRevision) {
            map.clear();
            lastSaveState = saveState;
            lastRevision = rev;
        }
    };

    return {
        /**
         * @param {TrafficitySaveState | null | undefined} saveState
         * @param {string} key
         * @returns {T | undefined}
         */
        get(saveState, key) {
            sync(saveState);
            if (!map.has(key)) return undefined;
            const val = map.get(key);
            if (val !== undefined) {
                map.delete(key);
                map.set(key, val);
            }
            return val;
        },
        /**
         * @param {TrafficitySaveState | null | undefined} saveState
         * @param {string} key
         * @param {T} val
         */
        set(saveState, key, val) {
            sync(saveState);
            if (map.has(key)) map.delete(key);
            else if (map.size >= CACHE_LIMIT) {
                const oldest = map.keys().next().value;
                if (oldest !== undefined) map.delete(oldest);
            }
            map.set(key, val);
        },
        clear() {
            map.clear();
            lastSaveState = null;
            lastRevision = null;
        },
    };
};

/**
 * @param {TrafficityGameFacade} game
 * @param {{ maxSteps?: number, stride?: number }} [options]
 */
export const createSnapPerfController = (game, options = {}) => {
    const maxSteps = options.maxSteps ?? 3;
    const stride = options.stride ?? 4;
    let hooked = false;
    /** @type {ReturnType<typeof createLruWorldCache<{ result: TrafficityRoadPointRef | null, ninetySnapActive: boolean }>>} */
    const snapCache = createLruWorldCache();
    /** @type {ReturnType<typeof createLruWorldCache<TrafficityRoundaboutResult>>} */
    const roundaboutCache = createLruWorldCache();
    /** @type {ReturnType<typeof createLruWorldCache<TrafficityRoadConstructionResult>>} */
    const placementCache = createLruWorldCache();

    const applyTuning = () => {
        if (game && typeof game.configureSnapSearch === "function") {
            game.configureSnapSearch({ maxSteps, stride, suppressLog: true });
        }
    };

    const installHook = () => {
        applyTuning();
        if (hooked || !game) return hooked;
        hooked = true;

        if (typeof game.hookRoadSnap === "function") {
            game.hookRoadSnap((origGetNearestPoint) => (gameState, worldX, worldY, roadDefinition, startPoint) => {
                const saveState = gameState?.saveState;
                const step = quantizeStepForZoom(saveState?.cameraZoom);
                const cacheKey = [
                    Math.round(worldX / step),
                    Math.round(worldY / step),
                    roadDefinition?.name ?? "",
                    saveState?.roadPlacementElevation ?? 0,
                    saveState?.roadPlacementMode ?? "",
                    saveState?.angleSnappingEnabled ? 1 : 0,
                    gameState?.keysPressed?.has?.("shift") ? 1 : 0,
                    fingerprintStartPoint(startPoint),
                ].join("|");

                const cached = snapCache.get(saveState, cacheKey);
                if (cached !== undefined) {
                    if (gameState) {
                        gameState.draftMidpointToMidpointNinetySnapActive = cached.ninetySnapActive;
                    }
                    return cached.result;
                }

                const result = origGetNearestPoint(gameState, worldX, worldY, roadDefinition, startPoint);
                snapCache.set(saveState, cacheKey, {
                    result,
                    ninetySnapActive: Boolean(gameState?.draftMidpointToMidpointNinetySnapActive),
                });
                return result;
            });
        }

        if (typeof game.hookRoundaboutPlacement === "function") {
            game.hookRoundaboutPlacement((origGetRoundabout) => (gameState, center, roundaboutSize) => {
                const saveState = gameState?.saveState;
                const step = quantizeStepForZoom(saveState?.cameraZoom);
                const cacheKey = [
                    Math.round((center?.x ?? 0) / step),
                    Math.round((center?.y ?? 0) / step),
                    roundaboutSize ?? "",
                    saveState?.roadPlacementElevation ?? 0,
                    saveState?.drivingSide ?? "",
                    saveState?.difficultyMode ?? "",
                    saveState?.angleSnappingEnabled ? 1 : 0,
                ].join("|");

                const cached = roundaboutCache.get(saveState, cacheKey);
                if (cached !== undefined) return cached;

                const result = origGetRoundabout(gameState, center, roundaboutSize);
                roundaboutCache.set(saveState, cacheKey, result);
                return result;
            });
        }

        if (typeof game.hookRoadPlacement === "function") {
            game.hookRoadPlacement((origGetPlacement) => (gameState, startPoint, endPoint) => {
                const saveState = gameState?.saveState;
                const cacheKey = [
                    fingerprintStartPoint(startPoint),
                    fingerprintStartPoint(endPoint),
                    saveState?.roadPlacementMode ?? "",
                    saveState?.roadPlacementElevation ?? 0,
                    saveState?.drivingSide ?? "",
                    saveState?.difficultyMode ?? "",
                    saveState?.angleSnappingEnabled ? 1 : 0,
                    saveState?.money ?? 0,
                ].join("|");

                const cached = placementCache.get(saveState, cacheKey);
                if (cached !== undefined) return cached;

                const result = origGetPlacement(gameState, startPoint, endPoint);
                placementCache.set(saveState, cacheKey, result);
                return result;
            });
        }

        return true;
    };

    const clearCache = () => {
        snapCache.clear();
        roundaboutCache.clear();
        placementCache.clear();
    };

    return { applyTuning, installHook, clearCache };
};

/**
 * @param {TrafficityModsApi} _mods
 * @param {TrafficityGameFacade} game
 */
export default function setupSnapPerfFix(_mods, game) {
    const controller = createSnapPerfController(game);
    controller.installHook();
}
