const getMods = () => (typeof window !== "undefined" ? window.TrafficityMods : null);

export const fingerprintStartPoint = (sp) => {
    if (!sp) return "none";
    if (sp.type === "absolute") return `abs:${sp.x},${sp.y},${sp.elevation},${sp.lanesWide}`;
    if (sp.locator) return `${sp.type}:${sp.locator.laneSectionId}:${sp.locator.pointIndex}:${sp._gluedToLocatorOn || ""}`;
    if (Array.isArray(sp.spanEndLocators) && sp.spanEndLocators.length >= 2) {
        return `mid:${sp.spanEndLocators[0].laneSectionId}:${sp.spanEndLocators[0].pointIndex}:${sp.spanEndLocators[1].laneSectionId}:${sp.spanEndLocators[1].pointIndex}`;
    }
    return String(sp.type || "unknown");
};

export const createSnapPerfController = (options = {}) => {
    const maxSteps = options.maxSteps ?? 5;
    const stride = options.stride ?? 3;
    let hookedModule = null;
    let cache = null;

    const applyTuning = () => {
        globalThis.__trafficityMaxSnapSearchSteps = maxSteps;
        globalThis.__trafficitySnapSearchStride = stride;
        globalThis.__trafficitySuppressSnapLog = true;
    };

    const readSnapModule = () => {
        const m = getMods();
        if (m && m.game && typeof m.game.getSnapApi === "function") {
            return m.game.getSnapApi().snapModule;
        }
        return globalThis.__trafficitySnapModule || null;
    };

    const installHook = () => {
        applyTuning();
        const mod = readSnapModule();
        if (!mod || hookedModule === mod || typeof mod.getNearestLaneCreationPoint !== "function") {
            return false;
        }
        const origFn = mod.getNearestLaneCreationPoint;
        Object.defineProperty(mod, "getNearestLaneCreationPoint", {
            configurable: true,
            enumerable: true,
            value: (gameState, x, y, roadDef, startPoint) => {
                const ss = gameState?.saveState;
                const key = [
                    Math.round(x * 2),
                    Math.round(y * 2),
                    ss?.worldRevision ?? -1,
                    roadDef?.name ?? "",
                    ss?.roadPlacementElevation ?? 0,
                    ss?.roadPlacementMode ?? "",
                    ss?.angleSnappingEnabled ? 1 : 0,
                    gameState?.keysPressed?.has?.("shift") ? 1 : 0,
                    fingerprintStartPoint(startPoint),
                ].join("|");

                if (cache && cache.saveState === ss && cache.key === key) {
                    if (gameState) {
                        gameState.draftMidpointToMidpointNinetySnapActive = cache.ninetySnapActive;
                    }
                    return cache.result;
                }

                const result = origFn(gameState, x, y, roadDef, startPoint);
                cache = {
                    saveState: ss,
                    key,
                    result,
                    ninetySnapActive: Boolean(gameState?.draftMidpointToMidpointNinetySnapActive),
                };
                return result;
            },
        });
        hookedModule = mod;
        return true;
    };

    const clearCache = () => {
        cache = null;
    };

    return { applyTuning, installHook, clearCache };
};

const mods = getMods();
if (mods) {
    const controller = createSnapPerfController();
    controller.applyTuning();
    if (!controller.installHook()) {
        const timer = setInterval(() => {
            if (controller.installHook()) {
                clearInterval(timer);
            }
        }, 100);
        window.addEventListener("load", () => {
            if (controller.installHook()) {
                clearInterval(timer);
            }
        }, { once: true });
    }
}
