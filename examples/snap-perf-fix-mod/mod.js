const getModApi = () => (typeof window !== "undefined" ? window.TrafficityMods : null);

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

export const createSnapPerfController = (options = {}) => {
    const maxSteps = options.maxSteps ?? 5;
    const stride = options.stride ?? 3;
    let hookedModule = null;
    let snapCache = null;

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
        const snapModule = readSnapModule();
        if (!snapModule || hookedModule === snapModule || typeof snapModule.getNearestLaneCreationPoint !== "function") {
            return false;
        }
        const originalGetNearestPoint = snapModule.getNearestLaneCreationPoint;
        Object.defineProperty(snapModule, "getNearestLaneCreationPoint", {
            configurable: true,
            enumerable: true,
            value: (gameState, worldX, worldY, roadDefinition, startPoint) => {
                const saveState = gameState?.saveState;
                const cacheKey = [
                    Math.round(worldX * 2),
                    Math.round(worldY * 2),
                    saveState?.worldRevision ?? -1,
                    roadDefinition?.name ?? "",
                    saveState?.roadPlacementElevation ?? 0,
                    saveState?.roadPlacementMode ?? "",
                    saveState?.angleSnappingEnabled ? 1 : 0,
                    gameState?.keysPressed?.has?.("shift") ? 1 : 0,
                    fingerprintStartPoint(startPoint),
                ].join("|");

                if (snapCache && snapCache.saveState === saveState && snapCache.cacheKey === cacheKey) {
                    if (gameState) {
                        gameState.draftMidpointToMidpointNinetySnapActive = snapCache.ninetySnapActive;
                    }
                    return snapCache.result;
                }

                const result = originalGetNearestPoint(gameState, worldX, worldY, roadDefinition, startPoint);
                snapCache = {
                    saveState,
                    cacheKey,
                    result,
                    ninetySnapActive: Boolean(gameState?.draftMidpointToMidpointNinetySnapActive),
                };
                return result;
            },
        });
        hookedModule = snapModule;
        return true;
    };

    const clearCache = () => {
        snapCache = null;
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
