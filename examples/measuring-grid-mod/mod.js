export const GRANULARITY_PRESETS = [
    { kind: "step", mult: 1, majorEvery: 5, label: "1× Step" },
    { kind: "step", mult: 2, majorEvery: 5, label: "2× Step" },
    { kind: "step", mult: 5, majorEvery: 4, label: "5× Step" },
    { kind: "lane", mult: 1, majorEvery: 4, label: "1× Lane" },
    { kind: "lane", mult: 2, majorEvery: 4, label: "2× Lane" },
    { kind: "lane", mult: 4, majorEvery: 4, label: "4× Lane" },
    { kind: "lane", mult: 8, majorEvery: 4, label: "8× Lane" },
];

/**
 * @param {number} value
 * @param {number} stepWorld
 */
export const snapWorldCoord = (value, stepWorld) => {
    if (!stepWorld || stepWorld <= 0) return value;
    return Math.round(value / stepWorld) * stepWorld;
};

/**
 * @param {{ camX: number, camY: number, zoom: number, width: number, height: number, stepWorld: number, majorEvery?: number }} params
 */
export const computeGridLines = ({ camX, camY, zoom, width, height, stepWorld, majorEvery = 4 }) => {
    if (!zoom || zoom <= 0 || !stepWorld || stepWorld <= 0 || width <= 0 || height <= 0) {
        return { vertical: [], horizontal: [], effectiveStepWorld: stepWorld };
    }

    // Automatically double stepWorld if minor lines would be denser than 4px on screen
    let effectiveStep = stepWorld;
    while (effectiveStep * zoom < 4) {
        effectiveStep *= 2;
    }

    const worldLeft = -camX / zoom;
    const worldRight = (width - camX) / zoom;
    const worldTop = -camY / zoom;
    const worldBottom = (height - camY) / zoom;

    const startIx = Math.floor(worldLeft / effectiveStep);
    const endIx = Math.ceil(worldRight / effectiveStep);
    const startIy = Math.floor(worldTop / effectiveStep);
    const endIy = Math.ceil(worldBottom / effectiveStep);

    const vertical = [];
    for (let ix = startIx; ix <= endIx; ix++) {
        const sx = ix * effectiveStep * zoom + camX;
        vertical.push({ pos: sx, major: ix % majorEvery === 0 });
    }

    const horizontal = [];
    for (let iy = startIy; iy <= endIy; iy++) {
        const sy = iy * effectiveStep * zoom + camY;
        horizontal.push({ pos: sy, major: iy % majorEvery === 0 });
    }

    return { vertical, horizontal, effectiveStepWorld: effectiveStep };
};

/**
 * @param {TrafficityGameFacade} game
 * @param {{ getConfig: (id: string) => Record<string, unknown>, setConfig: (id: string, cfg: Record<string, unknown>) => Promise<void> | void, addOverlay?: TrafficityModsApi["addOverlay"] }} configApi
 */
export const createMeasuringGridController = (game, configApi) => {
    const saved = configApi.getConfig("measuring-grid") || {};
    let enabled = Boolean(saved.enabled);
    let snapEnabled = Boolean(saved.snapEnabled);
    let presetIndex =
        typeof saved.presetIndex === "number" && saved.presetIndex >= 0 && saved.presetIndex < GRANULARITY_PRESETS.length
            ? saved.presetIndex
            : 0; // Default: 1x road step (LANE_POINT_SPACING = 3)

    /** @type {number | null} */
    let rafId = null;
    /** @type {HTMLCanvasElement | null} */
    let canvas = null;
    /** @type {HTMLElement | null} */
    let hud = null;
    let snapHookInstalled = false;

    const saveState = () => {
        configApi.setConfig("measuring-grid", { enabled, snapEnabled, presetIndex });
    };

    const getPreset = () => GRANULARITY_PRESETS[presetIndex];

    const getStepWorld = () => {
        const constants = game.getConstants ? game.getConstants() : { laneWidth: 20, lanePointSpacing: 3 };
        const preset = getPreset();
        const base = preset.kind === "step" ? constants.lanePointSpacing : constants.laneWidth;
        return base * preset.mult;
    };

    const installSnapHook = () => {
        if (snapHookInstalled || typeof game.hookRoadSnap !== "function") {
            return snapHookInstalled;
        }
        snapHookInstalled = true;
        game.hookRoadSnap((prevFn) => (gameState, x, y, roadDef, startPoint) => {
            const res = prevFn(gameState, x, y, roadDef, startPoint);
            if (!snapEnabled || !res || res.type !== "absolute" || typeof res.x !== "number" || typeof res.y !== "number") {
                return res;
            }
            const step = getStepWorld();
            return {
                ...res,
                x: snapWorldCoord(res.x, step),
                y: snapWorldCoord(res.y, step),
            };
        });
        return true;
    };

    const ensureCanvas = () => {
        const pixiHost = document.getElementById("pixi");
        const targetHost = pixiHost || document.body;
        if (!targetHost) return null;

        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = "tmod-measuring-grid-canvas";
        }
        if (canvas.parentElement !== targetHost) {
            targetHost.appendChild(canvas);
        }
        return canvas;
    };

    const updateHud = () => {
        if (!hud) return;
        const toggleBtn = hud.querySelector("#tmod-grid-toggle");
        const snapBtn = hud.querySelector("#tmod-grid-snap");
        const label = hud.querySelector("#tmod-grid-label");
        const preset = getPreset();
        const step = getStepWorld();
        if (toggleBtn) {
            toggleBtn.textContent = enabled ? `Grid ${preset.label}` : "Grid Off";
            toggleBtn.classList.toggle("tmod-grid-on", enabled);
        }
        if (snapBtn) {
            snapBtn.textContent = snapEnabled ? "Snap On" : "Snap Off";
            snapBtn.classList.toggle("tmod-grid-on", snapEnabled);
        }
        if (label) {
            label.textContent = `${step}u`;
        }
    };

    const drawFrame = () => {
        if (!enabled) {
            rafId = null;
            return;
        }
        const c = ensureCanvas();
        const cam = game.getCameraState ? game.getCameraState() : null;
        if (c && cam) {
            const dpr = window.devicePixelRatio || 1;
            const cssW = Math.max(1, Math.round(cam.width));
            const cssH = Math.max(1, Math.round(cam.height));
            const pxW = Math.round(cssW * dpr);
            const pxH = Math.round(cssH * dpr);
            if (c.width !== pxW || c.height !== pxH) {
                c.width = pxW;
                c.height = pxH;
            }
            const ctx = c.getContext("2d");
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, cssW, cssH);

                const preset = getPreset();
                const { vertical, horizontal } = computeGridLines({
                    camX: cam.x,
                    camY: cam.y,
                    zoom: cam.zoom,
                    width: cssW,
                    height: cssH,
                    stepWorld: getStepWorld(),
                    majorEvery: preset.majorEvery,
                });

                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
                for (const l of vertical) {
                    if (!l.major) {
                        const x = Math.round(l.pos) + 0.5;
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, cssH);
                    }
                }
                for (const l of horizontal) {
                    if (!l.major) {
                        const y = Math.round(l.pos) + 0.5;
                        ctx.moveTo(0, y);
                        ctx.lineTo(cssW, y);
                    }
                }
                ctx.stroke();

                ctx.beginPath();
                ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
                for (const l of vertical) {
                    if (l.major) {
                        const x = Math.round(l.pos) + 0.5;
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, cssH);
                    }
                }
                for (const l of horizontal) {
                    if (l.major) {
                        const y = Math.round(l.pos) + 0.5;
                        ctx.moveTo(0, y);
                        ctx.lineTo(cssW, y);
                    }
                }
                ctx.stroke();
            }
        }
        rafId = requestAnimationFrame(drawFrame);
    };

    const syncLoop = () => {
        if (enabled) {
            if (canvas) canvas.style.display = "block";
            if (rafId === null) {
                rafId = requestAnimationFrame(drawFrame);
            }
        } else {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (canvas) canvas.style.display = "none";
        }
        updateHud();
    };

    const toggle = () => {
        enabled = !enabled;
        saveState();
        syncLoop();
        return enabled;
    };

    const toggleSnap = () => {
        installSnapHook();
        snapEnabled = !snapEnabled;
        saveState();
        updateHud();
        return snapEnabled;
    };

    /** @param {number} delta */
    const stepPreset = (delta) => {
        const next = Math.max(0, Math.min(GRANULARITY_PRESETS.length - 1, presetIndex + delta));
        if (next !== presetIndex) {
            presetIndex = next;
            saveState();
            updateHud();
        }
        return presetIndex;
    };

    const mountHud = () => {
        if (hud || !document.body) return;
        const container = document.createElement("div");
        container.id = "tmod-measuring-grid-hud";
        container.innerHTML = `
            <button id="tmod-grid-toggle" title="Toggle Measuring Grid (Alt+G)">Grid Off</button>
            <button id="tmod-grid-snap" title="Toggle Road Grid Snap (Alt+S)">Snap Off</button>
            <button id="tmod-grid-minus" title="Finer Grid ([)">-</button>
            <span id="tmod-grid-label">3u</span>
            <button id="tmod-grid-plus" title="Coarser Grid (])">+</button>
        `;
        container.querySelector("#tmod-grid-toggle")?.addEventListener("click", toggle);
        container.querySelector("#tmod-grid-snap")?.addEventListener("click", toggleSnap);
        container.querySelector("#tmod-grid-minus")?.addEventListener("click", () => { stepPreset(-1); });
        container.querySelector("#tmod-grid-plus")?.addEventListener("click", () => { stepPreset(1); });

        if (typeof configApi.addOverlay === "function") {
            configApi.addOverlay("measuring-grid", container);
        } else {
            document.body.appendChild(container);
        }
        hud = container;
        syncLoop();
    };

    return {
        toggle,
        toggleSnap,
        stepPreset,
        installSnapHook,
        mountHud,
        isEnabled: () => enabled,
        isSnapEnabled: () => snapEnabled,
        getPresetIndex: () => presetIndex,
        getPreset,
        getStepWorld,
    };
};

/**
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 */
export default function setupMeasuringGrid(mods, game) {
    const controller = createMeasuringGridController(game, {
        getConfig: (id) => mods.getConfig(id),
        setConfig: (id, cfg) => mods.setConfig(id, cfg),
        addOverlay: (id, content) => mods.addOverlay(id, content),
    });

    controller.installSnapHook();

    if (typeof document !== "undefined") {
        if (document.body) controller.mountHud();
        else window.addEventListener("DOMContentLoaded", () => controller.mountHud(), { once: true });
    }

    mods.bindKey("Alt+g", () => { controller.toggle(); });
    mods.bindKey("Alt+s", () => { controller.toggleSnap(); });
    mods.bindKey("BracketLeft", () => { controller.stepPreset(-1); });
    mods.bindKey("BracketRight", () => { controller.stepPreset(1); });
}
