const getModApi = () => (typeof window !== "undefined" ? window.TrafficityMods : null);
const CACHE_LIMIT = 32;

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

const quantizeStepForZoom = (cameraZoom) => {
    const z = Math.max(0.25, Number(cameraZoom) || 1);
    return Math.max(2, Math.min(8, 2 / z));
};

const createLruWorldCache = () => {
    let lastSaveState = null;
    let lastRevision = null;
    const map = new Map();

    const sync = (saveState) => {
        const rev = saveState?.worldRevision ?? -1;
        if (saveState !== lastSaveState || rev !== lastRevision) {
            map.clear();
            lastSaveState = saveState;
            lastRevision = rev;
        }
    };

    return {
        get(saveState, key) {
            sync(saveState);
            if (!map.has(key)) return undefined;
            const val = map.get(key);
            map.delete(key);
            map.set(key, val);
            return val;
        },
        set(saveState, key, val) {
            sync(saveState);
            if (map.has(key)) map.delete(key);
            else if (map.size >= CACHE_LIMIT) map.delete(map.keys().next().value);
            map.set(key, val);
        },
        clear() {
            map.clear();
            lastSaveState = null;
            lastRevision = null;
        },
    };
};

export const createSnapPerfController = (options = {}) => {
    const maxSteps = options.maxSteps ?? 3;
    const stride = options.stride ?? 4;
    let hookedModule = null;
    let hookedRoundaboutModule = null;
    let hookedPlacementModule = null;
    const snapCache = createLruWorldCache();
    const roundaboutCache = createLruWorldCache();
    const placementCache = createLruWorldCache();

    const applyTuning = () => {
        const modApi = getModApi();
        if (modApi && modApi.game && typeof modApi.game.configureSnapSearch === "function") {
            modApi.game.configureSnapSearch({ maxSteps, stride, suppressLog: true });
        }
    };

    const readSnapModule = () => {
        const modApi = getModApi();
        if (modApi && modApi.game && typeof modApi.game.getSnapApi === "function") {
            return modApi.game.getSnapApi().snapModule;
        }
        return null;
    };

    const installHook = () => {
        applyTuning();
        const modApi = getModApi();
        const snapModule = readSnapModule();
        let didHook = false;

        if (snapModule && hookedModule !== snapModule && typeof snapModule.getNearestLaneCreationPoint === "function") {
            const originalGetNearestPoint = snapModule.getNearestLaneCreationPoint;
            Object.defineProperty(snapModule, "getNearestLaneCreationPoint", {
                configurable: true,
                enumerable: true,
                value: (gameState, worldX, worldY, roadDefinition, startPoint) => {
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

                    const result = originalGetNearestPoint(gameState, worldX, worldY, roadDefinition, startPoint);
                    snapCache.set(saveState, cacheKey, {
                        result,
                        ninetySnapActive: Boolean(gameState?.draftMidpointToMidpointNinetySnapActive),
                    });
                    return result;
                },
            });
            hookedModule = snapModule;
            didHook = true;
        }

        if (modApi?.game?.hookRoundaboutPlacement && !hookedRoundaboutModule) {
            hookedRoundaboutModule = true;
            modApi.game.hookRoundaboutPlacement((origGetRoundabout) => (gameState, center, roundaboutSize) => {
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
            didHook = true;
        }

        if (modApi?.game?.hookRoadPlacement && !hookedPlacementModule) {
            hookedPlacementModule = true;
            modApi.game.hookRoadPlacement((origGetPlacement) => (gameState, startPoint, endPoint) => {
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
            didHook = true;
        }

        return didHook || (hookedModule === snapModule && Boolean(snapModule));
    };

    const clearCache = () => {
        snapCache.clear();
        roundaboutCache.clear();
        placementCache.clear();
    };

    return { applyTuning, installHook, clearCache };
};

const modApi = getModApi();
if (modApi) {
    const controller = createSnapPerfController();
    controller.applyTuning();
    if (!controller.installHook()) {
        if (modApi.game && typeof modApi.game.on === "function") {
            modApi.game.on("ready", () => controller.installHook());
        } else {
            window.addEventListener("load", () => controller.installHook(), { once: true });
        }
    }
}
