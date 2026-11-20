(() => {
    if (window.TrafficityMods) {
        return;
    }

    const SYNTHETIC_FLAG = "__trafficityModSynthetic";
    const keyBindings = [];
    const mouseBindings = [];
    const services = new Map();
    let catalog = { modsDir: "", mods: [] };
    let dependencyWarnings = new Map();

    const codeToKeyInfo = (code) => {
        if (/^Key([A-Z])$/.test(code)) {
            const ch = code.slice(3).toLowerCase();
            return { key: ch, keyCode: ch.toUpperCase().charCodeAt(0) };
        }
        if (/^Digit([0-9])$/.test(code)) {
            const d = code.slice(5);
            return { key: d, keyCode: d.charCodeAt(0) };
        }
        const table = {
            Space: { key: " ", keyCode: 32 },
            Enter: { key: "Enter", keyCode: 13 },
            Escape: { key: "Escape", keyCode: 27 },
            Tab: { key: "Tab", keyCode: 9 },
            Backspace: { key: "Backspace", keyCode: 8 },
            ArrowUp: { key: "ArrowUp", keyCode: 38 },
            ArrowDown: { key: "ArrowDown", keyCode: 40 },
            ArrowLeft: { key: "ArrowLeft", keyCode: 37 },
            ArrowRight: { key: "ArrowRight", keyCode: 39 },
            ShiftLeft: { key: "Shift", keyCode: 16 },
            ShiftRight: { key: "Shift", keyCode: 16 },
            ControlLeft: { key: "Control", keyCode: 17 },
            ControlRight: { key: "Control", keyCode: 17 },
            AltLeft: { key: "Alt", keyCode: 18 },
            AltRight: { key: "Alt", keyCode: 18 },
        };
        if (table[code]) {
            return table[code];
        }
        if (/^F([1-9]|1[0-2])$/.test(code)) {
            return { key: code, keyCode: 111 + Number(code.slice(1)) };
        }
        return { key: code, keyCode: 0 };
    };

    const isEditableTarget = (target) => {
        if (!target || typeof target !== "object") {
            return false;
        }
        const tag = (target.tagName || "").toUpperCase();
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable);
    };

    const parseCombo = (combo) => {
        const parts = String(combo)
            .split("+")
            .map((p) => p.trim())
            .filter(Boolean);
        const spec = { ctrl: false, shift: false, alt: false, meta: false, code: "", rawKey: "" };
        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower === "ctrl" || lower === "control") spec.ctrl = true;
            else if (lower === "shift") spec.shift = true;
            else if (lower === "alt") spec.alt = true;
            else if (lower === "meta" || lower === "cmd" || lower === "win") spec.meta = true;
            else if (part.length === 1 && /[a-z]/i.test(part)) {
                spec.code = `Key${part.toUpperCase()}`;
                spec.rawKey = part.toLowerCase();
            } else if (part.length === 1 && /[0-9]/.test(part)) {
                spec.code = `Digit${part}`;
                spec.rawKey = part;
            } else {
                spec.code = part;
                spec.rawKey = part;
            }
        }
        return spec;
    };

    const matchesCombo = (event, spec) => {
        const keyMatch =
            event.code === spec.code ||
            event.key === spec.code ||
            (spec.rawKey && typeof event.key === "string" && event.key.toLowerCase() === spec.rawKey.toLowerCase());
        return (
            event.ctrlKey === spec.ctrl &&
            event.shiftKey === spec.shift &&
            event.altKey === spec.alt &&
            event.metaKey === spec.meta &&
            keyMatch
        );
    };

    const dispatchSyntheticKey = (toCode, overrideKeyInfo, modifiers = {}) => {
        const info = overrideKeyInfo || codeToKeyInfo(toCode);
        const cloned = new KeyboardEvent("keydown", {
            key: info.key,
            code: toCode,
            ctrlKey: Boolean(modifiers.ctrlKey),
            shiftKey: Boolean(modifiers.shiftKey),
            altKey: Boolean(modifiers.altKey),
            metaKey: Boolean(modifiers.metaKey),
            repeat: false,
            bubbles: true,
            cancelable: true,
        });
        if (info.keyCode) {
            try {
                Object.defineProperty(cloned, "keyCode", { get: () => info.keyCode });
                Object.defineProperty(cloned, "which", { get: () => info.keyCode });
            } catch {
                // ignore if non-configurable
            }
        }
        cloned[SYNTHETIC_FLAG] = true;
        window.dispatchEvent(cloned);
    };

    const onKeyEvent = (event) => {
        if (event[SYNTHETIC_FLAG]) {
            return;
        }

        if (event.type === "keydown" && event.code === "F9" && !event.repeat) {
            event.preventDefault();
            event.stopImmediatePropagation();
            toggleManagerDrawer();
            return;
        }

        if (!isEditableTarget(event.target) && event.type === "keydown") {
            for (const binding of keyBindings) {
                if (matchesCombo(event, binding.spec)) {
                    const result = binding.handler(event);
                    if (result !== false) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }
                    return;
                }
            }
        }
    };

    window.addEventListener("keydown", onKeyEvent, true);

    const resolveClickable = (el) => {
        if (!el) return null;
        if (el.tagName === "BUTTON") return el;
        return (typeof el.querySelector === "function" && el.querySelector("button.game-multi-button-option, button")) || el;
    };

    const getToolbeltSlots = () => {
        const row = document.querySelector(".road-toolbar-buttons-row");
        if (!row || !row.children) return [];
        const buttons = [];
        for (const child of row.children) {
            if (
                child.classList &&
                (child.classList.contains("road-toolbar-buttons-divider") ||
                    child.classList.contains("road-toolbar-compact-tools"))
            ) {
                continue;
            }
            if (child.tagName === "BUTTON") {
                buttons.push(child);
            } else if (typeof child.querySelectorAll === "function") {
                for (const btn of child.querySelectorAll("button.game-multi-button-option")) {
                    buttons.push(btn);
                }
            }
        }
        return buttons;
    };

    const selectionRadiusRings = new Map();
    const buildingTooltipLines = new Map();
    const pollutionDiffusionHandlers = new Set();
    const hookedRoundaboutModules = new WeakSet();
    const hookedRoadPlacementModules = new WeakSet();
    let selectionRadiusHooked = false;
    let tooltipHooked = false;
    let pollutionDiffusionHooked = false;

    const ensureSelectionRadiusHook = () => {
        if (selectionRadiusHooked) return;
        const ringMod = game.requireModule("POLLUTION_RADIUS_UI");
        if (!ringMod || typeof ringMod.setBuildingPollutionRadiusSelectionGraphic !== "function") return;
        selectionRadiusHooked = true;
        const origSetRing = ringMod.setBuildingPollutionRadiusSelectionGraphic;
        overrideExport(ringMod, "setBuildingPollutionRadiusSelectionGraphic", (gameState, buildingId) => {
            const building = gameState?.saveState?.buildings?.[buildingId];
            const cfg = building ? selectionRadiusRings.get(building.type) : null;
            if (cfg && typeof gameState?.setWorldSelectionGraphic === "function") {
                const graphic = game.createDashedCircle(
                    building.footprint.centerX,
                    building.footprint.centerY,
                    cfg.radius,
                    {
                        color: cfg.color ?? 0x00e5ff,
                        alpha: cfg.alpha ?? 0.85,
                        strokeWidth: game.getZoomAwareStrokeWidth(gameState.saveState?.cameraZoom),
                    },
                );
                if (graphic) {
                    gameState.setWorldSelectionGraphic(graphic);
                    return;
                }
            }
            origSetRing(gameState, buildingId);
        });
    };

    const ensureTooltipHook = () => {
        if (tooltipHooked) return;
        const tooltipMod = game.requireModule("BUILDING_TOOLTIP_UI");
        const jsxMod = game.requireModule("REACT_JSX");
        if (!tooltipMod || typeof tooltipMod.BuildingTypeTooltip !== "function" || !jsxMod?.jsx) return;
        tooltipHooked = true;
        const origTooltip = tooltipMod.BuildingTypeTooltip;
        overrideExport(tooltipMod, "BuildingTypeTooltip", (props) => {
            const el = origTooltip(props);
            const bType = props?.buildingDefinition?.type;
            const entry = bType ? buildingTooltipLines.get(bType) : null;
            if (!entry || !el?.props) return el;
            const text = typeof entry.textOrProvider === "function"
                ? entry.textOrProvider(props.buildingDefinition)
                : entry.textOrProvider;
            if (!text) return el;
            const descLine = jsxMod.jsx("div", {
                className: "building-type-tooltip-line",
                style: entry.style ?? { maxWidth: "220px", whiteSpace: "normal", lineHeight: "1.3", opacity: "0.85" },
                children: text,
            }, `tmod-tip-${bType}`);
            const prevChildren = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
            return { ...el, props: { ...el.props, children: [...prevChildren, descLine] } };
        });
    };

    const ensurePollutionDiffusionHook = () => {
        if (pollutionDiffusionHooked) return;
        const difMod = game.requireModule("POLLUTION_DIFFUSION");
        if (!difMod || typeof difMod.updatePollutionDiffusion !== "function") return;
        pollutionDiffusionHooked = true;
        const origDiffuse = difMod.updatePollutionDiffusion;
        overrideExport(difMod, "updatePollutionDiffusion", (pollutionGrid) => {
            origDiffuse(pollutionGrid);
            const saveState = globalThis.__trafficityGameState?.saveState;
            const { cellSize } = game.getPollutionConfig();
            for (const handler of pollutionDiffusionHandlers) {
                handler(pollutionGrid, {
                    saveState,
                    cellSize,
                    getBuildingDefinition: game.getBuildingDefinition,
                });
            }
        });
    };

    /** Official map of human-readable module names to Trafficity Parcel module IDs. */
    const ROUTER_MODULES = Object.freeze({
        // Buildings
        BUILDING_DEFINITIONS: "4nkf2",
        BUILDING_DISPLAY_NAMES: "aUbb1",
        BUILDING_VEHICLE_SPECS: "fFJcz",
        BUILDING_VISITED_NEEDS: "jnB0a",
        BUILDING_SATISFACTION_WEIGHTS: "2cbpn",
        BUILDING_PLACEMENT: "6whda",
        BUILDING_DELETION: "gh1Od",
        BUILDING_GRAPHICS: "XfMqf",
        BUILDING_PREVIEW_UI: "iPOHp",
        BUILDING_TOOLTIP_UI: "eAKuV",
        BUILDING_VIEW_PANEL_UI: "aelWA",
        // Roads & Snapping
        ROAD_CONSTANTS: "bTgKI",
        ROAD_SNAP: "aYVZj",
        ROAD_PLACEMENT: "hkRbw",
        ROAD_CONSTRUCTION: "h0N8S",
        ROUNDABOUT_PLACEMENT: "8lnVn",
        // Environment & Progression
        POLLUTION_FROM_BUILDINGS: "5x7Vi",
        POLLUTION_GRID: "d9GJQ",
        POLLUTION_DIFFUSION: "gs8fX",
        POLLUTION_RADIUS_UI: "eqevD",
        LEVEL_PROGRESSION: "aigC5",
        SCENARIOS: "a3oY4",
        DIFFICULTY_MODES: "9colC",
        // Camera, Audio, Graphics & UI Frameworks
        CAMERA: "cghJ1",
        UI_SFX: "lVhdV",
        SOUND_LIBRARY: "8thuK",
        MUSIC_CONTROLLER: "1JlYf",
        I18N: "9nNmt",
        PIXI_CONTAINER: "eicwU",
        PIXI_GRAPHICS: "3cebA",
        PIXI_SPRITE: "4rhnu",
        PIXI_TEXTURE: "bLlTJ",
        PIXI_CANVAS_SOURCE: "8xl7d",
        REACT_JSX: "ayMG0",
    });

    const game = {
        MODULES: ROUTER_MODULES,
        requireRouterModule: (id) => {
            try {
                return typeof globalThis.__trafficityRouterRequire === "function"
                    ? globalThis.__trafficityRouterRequire(id)
                    : null;
            } catch {
                return null;
            }
        },
        requireModule: (nameOrId) => {
            const resolved = ROUTER_MODULES[nameOrId] || nameOrId;
            return game.requireRouterModule(resolved);
        },
        pressButton: (target) => {
            const el = document.querySelector(`[data-tutorial-target="${target}"]`);
            const btn = resolveClickable(el);
            if (btn && typeof btn.click === "function") {
                btn.click();
                return true;
            }
            return false;
        },
        isButtonSelected: (target) => {
            const el = document.querySelector(`[data-tutorial-target="${target}"]`);
            const btn = resolveClickable(el);
            return Boolean(btn && btn.classList && btn.classList.contains("game-multi-button-option-selected"));
        },
        getToolbeltSlots,
        selectToolbeltSlot: (index) => {
            const slots = getToolbeltSlots();
            if (slots[index] && typeof slots[index].click === "function") {
                slots[index].click();
                return true;
            }
            return false;
        },
        cycleToolbeltSlot: (delta) => {
            const slots = getToolbeltSlots();
            if (slots.length === 0) return false;
            const isSlotAvailable = (btn) => {
                if (!btn || btn.disabled) return false;
                const host = typeof btn.closest === "function" ? btn.closest(".game-multi-button") : null;
                if (host && host.classList && host.classList.contains("building-toolbar-button--exhausted")) {
                    return false;
                }
                if (btn.classList && btn.classList.contains("building-toolbar-button--exhausted")) {
                    return false;
                }
                return true;
            };
            const currentIdx = slots.findIndex(
                (btn) => btn.classList && btn.classList.contains("game-multi-button-option-selected"),
            );
            const step = delta >= 0 ? 1 : -1;
            let idx = currentIdx === -1 ? (step > 0 ? -1 : 0) : currentIdx;
            for (let tries = 0; tries < slots.length; tries++) {
                idx = (idx + step + slots.length) % slots.length;
                if (isSlotAvailable(slots[idx]) && typeof slots[idx].click === "function") {
                    slots[idx].click();
                    return true;
                }
            }
            return false;
        },
        getCursorMode: () => {
            const gs = globalThis.__trafficityGameState;
            return gs && gs.cursorMode ? gs.cursorMode.mode : null;
        },
        isIdle: () => {
            const gs = globalThis.__trafficityGameState;
            if (gs && gs.cursorMode) {
                return gs.cursorMode.mode === "default";
            }
            return !document.querySelector(".road-toolbar-buttons-row .game-multi-button-option-selected");
        },
        sendSyntheticMouse: (type, init = {}) => {
            const target = document.querySelector("#pixi canvas") || document.body || window;
            const ev = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                ...init,
            });
            ev[SYNTHETIC_FLAG] = true;
            target.dispatchEvent(ev);
        },
        sendSyntheticWheel: (init = {}) => {
            const target = document.querySelector("#pixi canvas") || document.body || window;
            const ev = new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                view: window,
                ...init,
            });
            ev[SYNTHETIC_FLAG] = true;
            target.dispatchEvent(ev);
        },
        watchToolbelt: (callback) => {
            if (typeof callback !== "function") return () => {};
            let rafPending = false;
            const run = () => {
                callback(getToolbeltSlots());
            };
            const schedule = () => {
                if (rafPending) return;
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false;
                    run();
                });
            };
            const start = () => {
                run();
                const observer = new MutationObserver(schedule);
                observer.observe(document.body, { childList: true, subtree: true });
                return () => observer.disconnect();
            };
            if (document.body) {
                return start();
            }
            let stopFn = () => {};
            window.addEventListener(
                "DOMContentLoaded",
                () => {
                    stopFn = start();
                },
                { once: true },
            );
            return () => stopFn();
        },
        addSlotBadge: (slotBtn, label) => {
            if (!slotBtn) return;
            const host = (typeof slotBtn.closest === "function" && slotBtn.closest(".game-multi-button")) || slotBtn;
            if (typeof getComputedStyle === "function" && getComputedStyle(host).position === "static") {
                host.style.position = "relative";
            }
            let badge = host.querySelector(":scope > .tmod-slot-badge");
            if (!badge) {
                badge = document.createElement("span");
                badge.className = "tmod-slot-badge";
                host.appendChild(badge);
            }
            if (badge.textContent !== String(label)) {
                badge.textContent = String(label);
            }
        },
        addButtonHint: (target, label) => {
            const el = document.querySelector(`[data-tutorial-target="${target}"]`);
            if (!el) return;
            if (typeof getComputedStyle === "function" && getComputedStyle(el).position === "static") {
                el.style.position = "relative";
            }
            let hint = el.querySelector(":scope > .tmod-hint-badge");
            if (!hint) {
                hint = document.createElement("span");
                hint.className = "tmod-hint-badge";
                el.appendChild(hint);
            }
            if (hint.textContent !== String(label)) {
                hint.textContent = String(label);
            }
        },
        playSfx: (name) => {
            if (typeof globalThis.__trafficityPlayUiSfx === "function") {
                globalThis.__trafficityPlayUiSfx(name);
                return true;
            }
            const sfxMod = game.requireModule("UI_SFX");
            if (sfxMod && typeof sfxMod.playUiSfx === "function") {
                sfxMod.playUiSfx(name);
                return true;
            }
            return false;
        },
        setSpeed: (mode) => {
            if (mode === "pause" || mode === "stop") {
                dispatchSyntheticKey("Space", { key: " ", keyCode: 32 });
            } else if (mode === "normal") {
                dispatchSyntheticKey("Digit1", { key: "1", keyCode: 49 });
            } else if (mode === "fast") {
                dispatchSyntheticKey("Digit2", { key: "2", keyCode: 50 });
            }
        },
        undo: () => {
            dispatchSyntheticKey("KeyZ", { key: "z", keyCode: 90 }, { ctrlKey: true });
        },
        cancel: () => {
            dispatchSyntheticKey("Escape", { key: "Escape", keyCode: 27 });
        },
        getUndoApi: () => ({
            undoModule: globalThis.__trafficityUndoModule || null,
            undoHistory: globalThis.__trafficityUndoHistory || null,
            gameState: globalThis.__trafficityGameState || null,
            undoDeps: globalThis.__trafficityUndoDeps || null,
        }),
        getSnapApi: () => ({
            snapModule: globalThis.__trafficitySnapModule || game.requireModule("ROAD_SNAP") || null,
        }),
        configureSnapSearch: ({ maxSteps, stride, suppressLog } = {}) => {
            if (typeof maxSteps === "number") globalThis.__trafficityMaxSnapSearchSteps = maxSteps;
            if (typeof stride === "number") globalThis.__trafficitySnapSearchStride = stride;
            if (typeof suppressLog === "boolean") globalThis.__trafficitySuppressSnapLog = suppressLog;
            return {
                maxSteps: globalThis.__trafficityMaxSnapSearchSteps ?? 30,
                stride: globalThis.__trafficitySnapSearchStride ?? 1,
                suppressLog: Boolean(globalThis.__trafficitySuppressSnapLog),
            };
        },
        getCameraState: () => {
            const gameState = globalThis.__trafficityGameState;
            if (!gameState || !gameState.mapContainer || !gameState.saveState) return null;
            return {
                x: gameState.mapContainer.position.x,
                y: gameState.mapContainer.position.y,
                zoom: gameState.saveState.cameraZoom,
                width: gameState.renderer?.screen?.width || window.innerWidth,
                height: gameState.renderer?.screen?.height || window.innerHeight,
            };
        },
        worldToScreen: (worldX, worldY) => {
            const camera = game.getCameraState();
            if (!camera || !camera.zoom) return null;
            return {
                x: worldX * camera.zoom + camera.x,
                y: worldY * camera.zoom + camera.y,
            };
        },
        screenToWorld: (screenX, screenY) => {
            const camera = game.getCameraState();
            if (!camera || !camera.zoom) return null;
            return {
                x: (screenX - camera.x) / camera.zoom,
                y: (screenY - camera.y) / camera.zoom,
            };
        },
        getConstants: () => {
            const constantsModule = game.requireModule("ROAD_CONSTANTS");
            return {
                laneWidth: constantsModule && typeof constantsModule.LANE_WIDTH === "number" ? constantsModule.LANE_WIDTH : 20,
                lanePointSpacing:
                    constantsModule && typeof constantsModule.LANE_POINT_SPACING === "number"
                        ? constantsModule.LANE_POINT_SPACING
                        : 3,
            };
        },
        getZoomAwareStrokeWidth: (zoom) => {
            const z = typeof zoom === "number" ? zoom : (globalThis.__trafficityGameState?.saveState?.cameraZoom ?? 1);
            const camMod = game.requireModule("CAMERA");
            return camMod && typeof camMod.getZoomAwareStrokeWidth === "function"
                ? camMod.getZoomAwareStrokeWidth(z)
                : 2;
        },
        createDashedCircle: (cx, cy, radius, options = {}) => {
            const gfxMod = game.requireModule("PIXI_GRAPHICS");
            if (!gfxMod?.Graphics) return null;
            const g = new gfxMod.Graphics();
            const dashLen = options.dashLength ?? 28;
            const gapLen = options.gapLength ?? 18;
            const circumference = 2 * Math.PI * radius;
            let dist = 0;
            let draw = true;
            while (dist < circumference) {
                const next = Math.min(dist + (draw ? dashLen : gapLen), circumference);
                if (draw) {
                    const a0 = dist / radius;
                    const a1 = next / radius;
                    const steps = Math.max(2, Math.ceil(((a1 - a0) * radius) / 6));
                    for (let i = 0; i <= steps; i++) {
                        const a = a0 + (i / steps) * (a1 - a0);
                        const x = cx + Math.cos(a) * radius;
                        const y = cy + Math.sin(a) * radius;
                        if (i === 0) g.moveTo(x, y);
                        else g.lineTo(x, y);
                    }
                }
                dist = next;
                draw = !draw;
            }
            const strokeWidth = options.strokeWidth ?? game.getZoomAwareStrokeWidth();
            g.stroke({ width: strokeWidth, color: options.color ?? 0x00e5ff, alpha: options.alpha ?? 0.85 });
            return g;
        },
        getBuildingDefinition: (type) => {
            const defsMod = game.requireModule("BUILDING_DEFINITIONS");
            if (!defsMod || typeof defsMod.getBuildingDefinition !== "function") return null;
            try {
                return defsMod.getBuildingDefinition(type);
            } catch {
                return null;
            }
        },
        getPollutionConfig: () => {
            const gridMod = game.requireModule("POLLUTION_GRID");
            return {
                cellSize: gridMod && typeof gridMod.POLLUTION_CELL_SIZE === "number" ? gridMod.POLLUTION_CELL_SIZE : 40,
            };
        },
        setSelectionRadiusRing: (buildingType, options) => {
            if (!buildingType || !options || !(options.radius > 0)) return;
            selectionRadiusRings.set(buildingType, { ...options });
            game.on("ready", ensureSelectionRadiusHook);
        },
        addBuildingTooltipLine: (buildingType, textOrProvider, style) => {
            if (!buildingType || !textOrProvider) return;
            buildingTooltipLines.set(buildingType, { textOrProvider, style });
            game.on("ready", ensureTooltipHook);
        },
        onPollutionDiffusion: (handler) => {
            if (typeof handler !== "function") return () => {};
            pollutionDiffusionHandlers.add(handler);
            game.on("ready", ensurePollutionDiffusionHook);
            return () => pollutionDiffusionHandlers.delete(handler);
        },
        hookRoundaboutPlacement: (wrapperFactory) => {
            if (typeof wrapperFactory !== "function") return;
            const apply = () => {
                const mod = game.requireModule("ROUNDABOUT_PLACEMENT");
                if (!mod || typeof mod.getPlaceRoundaboutResultForSize !== "function" || hookedRoundaboutModules.has(mod)) return;
                hookedRoundaboutModules.add(mod);
                const wrapped = wrapperFactory(mod.getPlaceRoundaboutResultForSize);
                if (typeof wrapped === "function") {
                    overrideExport(mod, "getPlaceRoundaboutResultForSize", wrapped);
                }
            };
            game.on("ready", apply);
        },
        hookRoadPlacement: (wrapperFactory) => {
            if (typeof wrapperFactory !== "function") return;
            const apply = () => {
                const mod = game.requireModule("ROAD_PLACEMENT");
                if (!mod || typeof mod.getRoadConstructionActionWithPlacement !== "function" || hookedRoadPlacementModules.has(mod)) return;
                hookedRoadPlacementModules.add(mod);
                const wrapped = wrapperFactory(mod.getRoadConstructionActionWithPlacement);
                if (typeof wrapped === "function") {
                    overrideExport(mod, "getRoadConstructionActionWithPlacement", wrapped);
                }
            };
            game.on("ready", apply);
        },
        getGameRelease: () => catalog.gameRelease || null,
    };

    const gameListeners = new Map();
    let readyEmitted = Boolean(globalThis.__trafficityUndoModule && globalThis.__trafficityGameState);
    let lastCursorMode = null;
    let lastWorldRevision = null;
    let lastUndoLen = null;
    let eventRafId = null;

    const emitGameEvent = (name, ...args) => {
        const set = gameListeners.get(name);
        if (!set) return;
        for (const fn of [...set]) {
            try {
                fn(...args);
            } catch (err) {
                console.error(`[TrafficityMods] Error in game.on("${name}") handler:`, err);
            }
        }
    };

    const hasWatchedStateListeners = () =>
        ["cursorModeChange", "worldChange", "roadPlaced"].some((k) => {
            const set = gameListeners.get(k);
            return set && set.size > 0;
        });

    const pollGameEvents = () => {
        eventRafId = null;
        if (!hasWatchedStateListeners()) return;

        const gs = globalThis.__trafficityGameState;
        if (gs) {
            const mode = gs.cursorMode ? gs.cursorMode.mode : null;
            if (lastCursorMode !== null && mode !== lastCursorMode) {
                emitGameEvent("cursorModeChange", mode, lastCursorMode);
            }
            lastCursorMode = mode;

            const rev = gs.saveState && typeof gs.saveState.worldRevision === "number" ? gs.saveState.worldRevision : null;
            if (lastWorldRevision !== null && rev !== null && rev !== lastWorldRevision) {
                emitGameEvent("worldChange", rev, lastWorldRevision);
            }
            if (rev !== null) lastWorldRevision = rev;

            const undoHist = globalThis.__trafficityUndoHistory;
            if (gs.saveState && undoHist && typeof undoHist.getUndoHistory === "function") {
                const hist = undoHist.getUndoHistory(gs.saveState);
                const len = hist && Array.isArray(hist.entries) ? hist.entries.length : null;
                if (lastUndoLen !== null && len !== null && len > lastUndoLen) {
                    emitGameEvent("roadPlaced", { entriesCount: len, worldRevision: rev });
                }
                if (len !== null) lastUndoLen = len;
            }
        }

        if (typeof requestAnimationFrame === "function") {
            eventRafId = requestAnimationFrame(pollGameEvents);
        }
    };

    const ensureReady = () => {
        if (readyEmitted) return;
        if (globalThis.__trafficityUndoModule || globalThis.__trafficityGameState) {
            readyEmitted = true;
            emitGameEvent("ready");
        }
    };
    window.addEventListener("trafficity:undo-ready", ensureReady, { once: true });
    window.addEventListener("load", ensureReady, { once: true });

    game.on = (event, handler) => {
        if (!event || typeof handler !== "function") return () => {};
        let set = gameListeners.get(event);
        if (!set) {
            set = new Set();
            gameListeners.set(event, set);
        }
        set.add(handler);
        if (event === "ready") {
            ensureReady();
            if (readyEmitted) queueMicrotask(() => set.has(handler) && handler());
        } else if (eventRafId === null && typeof requestAnimationFrame === "function") {
            eventRafId = requestAnimationFrame(pollGameEvents);
        }
        return () => {
            set.delete(handler);
            if (!hasWatchedStateListeners() && eventRafId !== null && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(eventRafId);
                eventRafId = null;
            }
        };
    };

    const BUILDING_CATEGORIES = new Set(["residential", "commercial", "office", "industrial"]);
    const BUILDING_POLLUTION_LEVELS = new Set(["none", "low", "medium", "high"]);
    const BUILDING_RESOURCES = new Set(["food", "copper", "iron", "steel", "cpg"]);
    const BUILDING_TERRAINS = new Set(["water", "land", "mountain", "void", "sand", "grass", "wasteland", "deepwasteland"]);
    const BUILDING_CATEGORY_COLORS = { residential: "#78CC51", commercial: "#3997e4", office: "#9b59d0", industrial: "#e8bd2c" };

    const overrideExport = (mod, key, value) => {
        if (!mod || typeof mod !== "object") return;
        Object.defineProperty(mod, key, { value, writable: true, configurable: true, enumerable: true });
    };

    /** Declarative definition and lifecycle hooks for a custom Trafficity building type. */
    class CustomBuilding {
        constructor(config) {
            if (!config || typeof config.type !== "string" || !config.type.trim()) {
                throw new Error("CustomBuilding requires a non-empty `type` string.");
            }
            if (!BUILDING_CATEGORIES.has(config.buildingCategory)) {
                throw new Error(`Invalid buildingCategory "${config.buildingCategory}".`);
            }
            const pollutionOutput = config.pollutionOutput ?? "none";
            if (!BUILDING_POLLUTION_LEVELS.has(pollutionOutput)) {
                throw new Error(`Invalid pollutionOutput "${pollutionOutput}".`);
            }
            const width = Number(config.width ?? 110);
            const depth = Number(config.depth ?? 90);
            if (!(width > 0 && depth > 0)) {
                throw new Error("Building `width` and `depth` must be positive numbers.");
            }
            if (config.requiredTerrain && !BUILDING_TERRAINS.has(config.requiredTerrain)) {
                throw new Error(`Invalid requiredTerrain "${config.requiredTerrain}".`);
            }
            if (config.forbiddenTerrain && !BUILDING_TERRAINS.has(config.forbiddenTerrain)) {
                throw new Error(`Invalid forbiddenTerrain "${config.forbiddenTerrain}".`);
            }
            if (config.mineTerrain && config.mineTerrain !== "mountain" && config.mineTerrain !== "water") {
                throw new Error(`Invalid mineTerrain "${config.mineTerrain}".`);
            }
            const inputs = [...(config.inputs ?? [])];
            const outputs = [...(config.outputs ?? [])];
            for (const r of [...inputs, ...outputs]) {
                if (!BUILDING_RESOURCES.has(r)) throw new Error(`Invalid resource "${r}".`);
            }
            if (config.garage && (typeof config.garage.entrance !== "number" || typeof config.garage.exit !== "number" || !(config.garage.effectiveCapacity > 0))) {
                throw new Error("`garage` requires numeric `{ entrance, exit, effectiveCapacity > 0 }`.");
            }

            this.type = config.type.trim();
            this.name = config.name ?? this.type;
            this.localizedNames = config.localizedNames ?? null;
            this.buildingCategory = config.buildingCategory;
            this.buildingColors = Array.isArray(config.buildingColors) && config.buildingColors.length > 0
                ? [...config.buildingColors]
                : [BUILDING_CATEGORY_COLORS[this.buildingCategory]];
            this.width = width;
            this.depth = depth;
            this.pollutionOutput = pollutionOutput;
            this.pollutionAffectsHappiness = Boolean(config.pollutionAffectsHappiness ?? this.buildingCategory === "residential");
            this.garage = config.garage ? { ...config.garage } : null;
            this.parkingSpaces = this.garage
                ? []
                : Array.isArray(config.parkingSpaces) ? [...config.parkingSpaces] : [Math.round(width / 2)];
            this.inputs = inputs;
            this.outputs = outputs;
            this.vanCapacity = typeof config.vanCapacity === "number" ? config.vanCapacity : undefined;
            this.truckCapacity = config.truckCapacity ? { ...config.truckCapacity } : undefined;
            this.requiredTerrain = config.requiredTerrain;
            this.forbiddenTerrain = config.forbiddenTerrain;
            this.mineTerrain = config.mineTerrain;
            this.labelY = config.labelY;
            this.vehicles = config.vehicles ?? null;
            this.needsVisited = typeof config.needsVisited === "boolean" ? config.needsVisited : this.buildingCategory !== "residential";
            this.satisfactionWeight = typeof config.satisfactionWeight === "number"
                ? config.satisfactionWeight
                : this.buildingCategory === "industrial" ? 20 : 15;
            this.defaultQuota = typeof config.defaultQuota === "number" ? config.defaultQuota : 0;
            this._extrusionFactory = typeof config.getExtrusions === "function"
                ? config.getExtrusions
                : (w, d) => [{
                    points: [
                        { x: 4, y: Math.min(20, d * 0.25), height: config.extrusionHeight ?? 35 },
                        { x: 4, y: d - 4, height: config.extrusionHeight ?? 35 },
                        { x: w - 4, y: d - 4, height: config.extrusionHeight ?? 35 },
                        { x: w - 4, y: Math.min(20, d * 0.25), height: config.extrusionHeight ?? 35 },
                    ],
                    roofDarkness: 0,
                }];
            this._hooks = {
                onPlace: config.onPlace ?? null,
                onDelete: config.onDelete ?? null,
                onSelect: config.onSelect ?? null,
                onRenderWorld: config.onRenderWorld ?? null,
            };
        }

        toWorkerSafeDefinition() {
            const def = {
                type: this.type,
                buildingCategory: this.buildingCategory,
                buildingColors: [...this.buildingColors],
                pollutionOutput: this.pollutionOutput,
                width: this.width,
                depth: this.depth,
                parkingSpaces: [...this.parkingSpaces],
                inputs: [...this.inputs],
                outputs: [...this.outputs],
            };
            if (this.pollutionAffectsHappiness) def.pollutionAffectsHappiness = true;
            if (this.garage) {
                def.parkingGarageEntrance = this.garage.entrance;
                def.parkingGarageExit = this.garage.exit;
                def.parkingGarageEffectiveCapacity = this.garage.effectiveCapacity;
            }
            if (this.vanCapacity !== undefined) def.vanCapacity = this.vanCapacity;
            if (this.truckCapacity !== undefined) def.truckCapacity = { ...this.truckCapacity };
            if (this.requiredTerrain !== undefined) def.requiredTerrain = this.requiredTerrain;
            if (this.forbiddenTerrain !== undefined) def.forbiddenTerrain = this.forbiddenTerrain;
            if (this.mineTerrain !== undefined) def.mineTerrain = this.mineTerrain;
            if (this.labelY !== undefined) def.labelY = this.labelY;
            return def;
        }

        toMainDefinition() {
            return { ...this.toWorkerSafeDefinition(), getExtrusions: (w, d) => this._extrusionFactory(w, d, this) };
        }

        getDisplayName(lang = "en") {
            return this.localizedNames ? (this.localizedNames[lang] ?? this.localizedNames.en ?? this.name) : this.name;
        }

        getTotalVehicleCount() {
            if (!this.vehicles) return 0;
            if ("cars" in this.vehicles) return this.vehicles.cars || 0;
            let total = 0;
            for (const map of [this.vehicles.trucks, this.vehicles.vans]) {
                if (map) for (const n of Object.values(map)) total += n;
            }
            return total;
        }
    }

    const customBuildings = new Map();
    let buildingHooksAttached = false;
    let workerHookInstalled = false;
    let lastSelectedBuildingId = null;

    const injectBuildingsIntoWorkerSource = (source, entries) => {
        const bootAnchor = ',l("fHJ87")';
        const idx = source.lastIndexOf(bootAnchor);
        if (idx === -1) return source;
        const injection = `,(() => {
            const entries = ${JSON.stringify(entries)};
            const byType = new Map(entries.map((x) => [x.def.type, x]));
            const setExp = (m, k, v) => Object.defineProperty(m, k, { value: v, writable: true, configurable: true, enumerable: true });
            const defMod = l("aS4Aq");
            const origGetDef = defMod.getBuildingDefinition;
            setExp(defMod, "getBuildingDefinition", (t) => byType.has(t) ? byType.get(t).def : origGetDef(t));
            try {
                const visMod = l("6hect");
                const origVis = visMod.buildingHasGetVisitedNeed;
                setExp(visMod, "buildingHasGetVisitedNeed", (t) => byType.has(t) ? Boolean(byType.get(t).needsVisited) : origVis(t));
            } catch {}
            try {
                const carMod = l("3baQI");
                if (carMod && typeof carMod.getBuildingCarCountSpec === "function") {
                    const oSpec = carMod.getBuildingCarCountSpec;
                    const oRes = carMod.getResidentCarCountForResidentialBuildingType;
                    const oTot = carMod.getTotalVehicleCountForBuildingType;
                    setExp(carMod, "getBuildingCarCountSpec", (t) => byType.has(t) ? byType.get(t).vehicles : oSpec(t));
                    setExp(carMod, "getResidentCarCountForResidentialBuildingType", (t) => {
                        const hit = byType.get(t);
                        return hit ? (hit.vehicles && "cars" in hit.vehicles ? hit.vehicles.cars : 0) : oRes(t);
                    });
                    setExp(carMod, "getTotalVehicleCountForBuildingType", (t) => {
                        const hit = byType.get(t);
                        if (!hit) return oTot(t);
                        const v = hit.vehicles;
                        if (!v) return 0;
                        if ("cars" in v) return v.cars || 0;
                        let n = 0;
                        for (const o of [v.trucks, v.vans]) if (o) for (const c of Object.values(o)) n += c;
                        return n;
                    });
                }
            } catch {}
        })()`;
        return source.slice(0, idx) + injection + source.slice(idx);
    };

    const installWorkerBuildingHook = () => {
        if (workerHookInstalled || typeof window.Worker !== "function") return;
        workerHookInstalled = true;
        const NativeWorker = window.Worker;
        window.Worker = function PatchedTrafficityWorker(scriptURL, options) {
            const urlStr = String(scriptURL);
            const isGameWorker = !options?.type && (
                urlStr.includes("car-worker") || urlStr.includes("happiness-worker") || urlStr.includes("pathfinding-worker")
            );
            if (!isGameWorker || customBuildings.size === 0 || typeof XMLHttpRequest !== "function") {
                return new NativeWorker(scriptURL, options);
            }
            try {
                const xhr = new XMLHttpRequest();
                xhr.open("GET", urlStr, false);
                xhr.send(null);
                if (xhr.status >= 200 && xhr.status < 300) {
                    const payload = [...customBuildings.values()].map((b) => ({
                        def: b.toWorkerSafeDefinition(),
                        vehicles: b.vehicles,
                        needsVisited: b.needsVisited,
                    }));
                    const patched = injectBuildingsIntoWorkerSource(xhr.responseText, payload);
                    const blobUrl = URL.createObjectURL(new Blob([patched], { type: "application/javascript" }));
                    return new NativeWorker(blobUrl, options);
                }
            } catch (err) {
                console.warn("[TrafficityMods] Worker building patch fallback:", err);
            }
            return new NativeWorker(scriptURL, options);
        };
        window.Worker.prototype = NativeWorker.prototype;
    };
    installWorkerBuildingHook();

    const attachMainBuildingHooks = () => {
        if (buildingHooksAttached || customBuildings.size === 0) return;
        const defsMod = game.requireModule("BUILDING_DEFINITIONS");
        if (!defsMod || !Array.isArray(defsMod.BUILDING_DEFINITIONS)) return;
        buildingHooksAttached = true;

        const upsertMain = (b) => {
            const def = b.toMainDefinition();
            const idx = defsMod.BUILDING_DEFINITIONS.findIndex((d) => d.type === b.type);
            if (idx !== -1) defsMod.BUILDING_DEFINITIONS[idx] = def;
            else defsMod.BUILDING_DEFINITIONS.push(def);
        };
        for (const b of customBuildings.values()) upsertMain(b);

        const origGetDef = defsMod.getBuildingDefinition;
        const origGetColor = defsMod.getBuildingDefaultColor;
        overrideExport(defsMod, "getBuildingDefinition", (t) => customBuildings.has(t) ? customBuildings.get(t).toMainDefinition() : origGetDef(t));
        overrideExport(defsMod, "getBuildingDefaultColor", (t) => customBuildings.has(t) ? customBuildings.get(t).buildingColors[0] : origGetColor(t));

        const displayMod = game.requireModule("BUILDING_DISPLAY_NAMES");
        const i18nMod = game.requireModule("I18N");
        if (displayMod?.buildingDisplayName) {
            const origName = displayMod.buildingDisplayName;
            overrideExport(displayMod, "buildingDisplayName", (t) => {
                const b = customBuildings.get(t);
                if (!b) return origName(t);
                const lang = typeof i18nMod?.getLocalisationLanguage === "function" ? i18nMod.getLocalisationLanguage() : "en";
                return b.getDisplayName(lang);
            });
        }

        const carSpecMod = game.requireModule("BUILDING_VEHICLE_SPECS");
        if (carSpecMod) {
            const oSpec = carSpecMod.getBuildingCarCountSpec;
            const oRes = carSpecMod.getResidentCarCountForResidentialBuildingType;
            const oTot = carSpecMod.getTotalVehicleCountForBuildingType;
            overrideExport(carSpecMod, "getBuildingCarCountSpec", (t) => customBuildings.has(t) ? customBuildings.get(t).vehicles : oSpec(t));
            overrideExport(carSpecMod, "getResidentCarCountForResidentialBuildingType", (t) => {
                const b = customBuildings.get(t);
                return b ? (b.vehicles && "cars" in b.vehicles ? b.vehicles.cars : 0) : oRes(t);
            });
            overrideExport(carSpecMod, "getTotalVehicleCountForBuildingType", (t) => customBuildings.has(t) ? customBuildings.get(t).getTotalVehicleCount() : oTot(t));
        }

        const visitedMod = game.requireModule("BUILDING_VISITED_NEEDS");
        if (visitedMod?.buildingHasGetVisitedNeed) {
            const oVis = visitedMod.buildingHasGetVisitedNeed;
            overrideExport(visitedMod, "buildingHasGetVisitedNeed", (t) => customBuildings.has(t) ? customBuildings.get(t).needsVisited : oVis(t));
        }

        const satMod = game.requireModule("BUILDING_SATISFACTION_WEIGHTS");
        if (satMod?.getSatisfactionWeightForBuildingType) {
            const oSat = satMod.getSatisfactionWeightForBuildingType;
            overrideExport(satMod, "getSatisfactionWeightForBuildingType", (t) => customBuildings.has(t) ? customBuildings.get(t).satisfactionWeight : oSat(t));
        }

        const placeMod = game.requireModule("BUILDING_PLACEMENT");
        if (placeMod) {
            const finalizePlaced = (st, prevIds, deps) => {
                for (const [id, rec] of Object.entries(st.saveState?.buildings || {})) {
                    if (prevIds.has(id)) continue;
                    const b = customBuildings.get(rec.type);
                    if (!b) continue;
                    if (b.buildingCategory === "residential" && b.vehicles && "cars" in b.vehicles && b.vehicles.cars > 0) {
                        if (!b.garage) {
                            for (let i = 0; i < Math.min(b.vehicles.cars, b.parkingSpaces.length); i++) {
                                deps?.spawnOutdoorResidentialCar?.(rec.id, rec.type, rec.footprint, i, st);
                            }
                        }
                    }
                    b._hooks.onPlace?.(st, rec, { placementDeps: deps }, b);
                }
            };
            const oPlace = placeMod.placeBuildingsFromFootprints;
            const oRestore = placeMod.restoreBuildingsAtFootprints;
            overrideExport(placeMod, "placeBuildingsFromFootprints", (st, typeName, fps, deps, sfx) => {
                const prev = new Set(Object.keys(st.saveState?.buildings || {}));
                const res = oPlace(st, typeName, fps, deps, sfx);
                finalizePlaced(st, prev, deps);
                return res;
            });
            overrideExport(placeMod, "restoreBuildingsAtFootprints", (st, items, deps) => {
                const prev = new Set(Object.keys(st.saveState?.buildings || {}));
                const res = oRestore(st, items, deps);
                finalizePlaced(st, prev, deps);
                return res;
            });
        }

        const delMod = game.requireModule("BUILDING_DELETION");
        if (delMod?.deleteBuildingsFromGameState) {
            const oDel = delMod.deleteBuildingsFromGameState;
            overrideExport(delMod, "deleteBuildingsFromGameState", (st, ids) => {
                const deleting = [];
                for (const id of ids) {
                    const rec = st.saveState?.buildings?.[id];
                    const b = rec ? customBuildings.get(rec.type) : null;
                    if (rec && b) deleting.push([rec, b]);
                }
                const res = oDel(st, ids);
                for (const [rec, b] of deleting) b._hooks.onDelete?.(st, rec, b);
                return res;
            });
        }

        const gfxMod = game.requireModule("BUILDING_GRAPHICS");
        if (gfxMod) {
            const pixi = {
                Container: game.requireModule("PIXI_CONTAINER")?.Container,
                Graphics: game.requireModule("PIXI_GRAPHICS")?.Graphics,
                Sprite: game.requireModule("PIXI_SPRITE")?.Sprite,
                Texture: game.requireModule("PIXI_TEXTURE")?.Texture,
                CanvasSource: game.requireModule("PIXI_CANVAS_SOURCE")?.CanvasSource,
            };
            const oCreate = gfxMod.createBuildingGraphicsParts;
            const oUpdate = gfxMod.updateBuildingGraphics;
            overrideExport(gfxMod, "createBuildingGraphicsParts", (st, rec, opts) => {
                const parts = oCreate(st, rec, opts);
                const b = customBuildings.get(rec.type);
                b?._hooks.onRenderWorld?.(parts, rec, st, pixi, b);
                return parts;
            });
            overrideExport(gfxMod, "updateBuildingGraphics", (st, rec, opts) => {
                oUpdate(st, rec, opts);
                const b = customBuildings.get(rec.type);
                if (!b?._hooks.onRenderWorld) return;
                const obj = st.buildingGraphics?.object?.get(rec.id);
                if (obj) {
                    b._hooks.onRenderWorld({
                        object: obj,
                        ground: st.buildingGraphics.ground?.get(rec.id),
                        groundSidewalk: st.buildingGraphics.groundSidewalk?.get(rec.id),
                        shadow: st.buildingGraphics.shadow?.get(rec.id),
                    }, rec, st, pixi, b);
                }
            });
        }

        window.addEventListener("click", () => queueMicrotask(() => {
            const st = globalThis.__trafficityGameState;
            if (!st?.worldSelection) return;
            const selId = st.worldSelection.type === "building" ? st.worldSelection.buildingId : null;
            if (selId === lastSelectedBuildingId) return;
            lastSelectedBuildingId = selId;
            if (selId !== null) {
                const rec = st.saveState?.buildings?.[selId];
                const b = rec ? customBuildings.get(rec.type) : null;
                b?._hooks.onSelect?.(st, rec, b);
            }
        }), true);

        const seedQuotas = () => {
            const st = globalThis.__trafficityGameState;
            if (!st?.saveState?.cumulativeBuildingCount) return;
            let changed = false;
            for (const b of customBuildings.values()) {
                if (b.defaultQuota > 0 && st.saveState.cumulativeBuildingCount[b.type] === undefined) {
                    st.saveState.cumulativeBuildingCount[b.type] = b.defaultQuota;
                    changed = true;
                }
            }
            if (changed) st.requestUiRefresh?.();
        };
        game.on("worldChange", seedQuotas);
        seedQuotas();
    };

    const buildingsApi = {
        CustomBuilding,
        register: (configOrInstance) => {
            const b = configOrInstance instanceof CustomBuilding ? configOrInstance : new CustomBuilding(configOrInstance);
            customBuildings.set(b.type, b);
            if (buildingHooksAttached) {
                const defsMod = game.requireModule("BUILDING_DEFINITIONS");
                if (defsMod?.BUILDING_DEFINITIONS) {
                    const idx = defsMod.BUILDING_DEFINITIONS.findIndex((d) => d.type === b.type);
                    const def = b.toMainDefinition();
                    if (idx !== -1) defsMod.BUILDING_DEFINITIONS[idx] = def;
                    else defsMod.BUILDING_DEFINITIONS.push(def);
                }
            } else {
                game.on("ready", attachMainBuildingHooks);
            }
            return b;
        },
        get: (type) => customBuildings.get(type) || null,
        list: () => [...customBuildings.values()],
    };

    const UI_ISOLATION_EVENTS = [
        "mousedown",
        "mouseup",
        "pointerdown",
        "pointerup",
        "click",
        "dblclick",
        "contextmenu",
        "wheel",
    ];

    const isolateUiElement = (el) => {
        if (!el || typeof el.addEventListener !== "function") return;
        for (const type of UI_ISOLATION_EVENTS) {
            el.addEventListener(type, (e) => {
                e.stopPropagation();
            });
        }
    };

    const api = {
        version: "1.4.2",
        game,
        buildings: buildingsApi,
        extendGame: (methods) => {
            if (methods && typeof methods === "object") {
                Object.assign(game, methods);
            }
            return game;
        },
        getMods: () => catalog.mods.slice(),
        getModsDir: () => catalog.modsDir,
        provide: (name, serviceApi) => {
            if (name) services.set(name, serviceApi);
        },
        use: (name) => services.get(name) || null,
        bindKey: (combo, handler) => {
            if (typeof handler !== "function") return;
            keyBindings.push({ combo, spec: parseCombo(combo), handler });
        },
        sendSyntheticKey: (code, key, keyCode, modifiers) => {
            dispatchSyntheticKey(code, key ? { key, keyCode: keyCode || 0 } : null, modifiers);
        },
        onMouse: (type, handler, options = {}) => {
            if (typeof handler !== "function") return;
            const wrapped = (event) => {
                if (event && event[SYNTHETIC_FLAG]) return;
                handler(event);
            };
            const listenerOpts =
                typeof options === "boolean" ? true : { ...options, capture: true };
            mouseBindings.push({ type, wrapped, listenerOpts });
            window.addEventListener(type, wrapped, listenerOpts);
        },
        getConfig: (modId, defaults = {}) => {
            const modEntry = catalog.mods.find((entry) => entry.id === modId);
            const savedConfig = modEntry && modEntry.config ? modEntry.config : {};
            return { ...defaults, ...savedConfig };
        },
        defineMod: (setupMod) => setupMod,
        setConfig: async (modId, config) => {
            const mod = catalog.mods.find((m) => m.id === modId);
            if (mod) {
                mod.config = { ...config };
            }
            await fetch("/api/mods/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: modId, config }),
            });
        },
        addOverlay: (id, content) => {
            const mount = () => {
                let host = document.getElementById(`tmod-overlay-${id}`);
                if (!host) {
                    host = document.createElement("div");
                    host.id = `tmod-overlay-${id}`;
                    isolateUiElement(host);
                    document.body.appendChild(host);
                }
                if (typeof content === "string") {
                    host.innerHTML = content;
                } else if (content instanceof Node) {
                    host.replaceChildren(content);
                }
            };
            if (document.body) mount();
            else window.addEventListener("DOMContentLoaded", mount, { once: true });
        },
    };

    window.TrafficityMods = api;

    // Fetch catalog synchronously before game module executes so keybindings apply immediately
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/mods", false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
            catalog = JSON.parse(xhr.responseText);
        }
    } catch (err) {
        console.warn("[TrafficityMods] Failed to load mod catalog:", err);
    }

    const resolveModLoadOrder = (mods) => {
        const byId = new Map(mods.map((m) => [m.id, m]));
        const warnings = new Map();
        const ordered = [];
        const state = new Map(); // 0=unvisited, 1=visiting, 2=visited

        const visit = (mod) => {
            const st = state.get(mod.id) || 0;
            if (st === 2) return true;
            if (st === 1) {
                warnings.set(mod.id, "Circular dependency detected");
                return false;
            }
            state.set(mod.id, 1);

            const missing = [];
            for (const depId of mod.dependencies || []) {
                const dep = byId.get(depId);
                if (!dep) {
                    missing.push(depId);
                } else if (!visit(dep)) {
                    missing.push(depId);
                }
            }
            if (missing.length > 0) {
                warnings.set(mod.id, `Missing required dependency: ${missing.join(", ")}`);
                state.set(mod.id, 2);
                return false;
            }

            for (const optId of mod.optionalDependencies || []) {
                const opt = byId.get(optId);
                if (opt && (state.get(opt.id) || 0) === 0) {
                    visit(opt);
                }
            }

            state.set(mod.id, 2);
            ordered.push(mod);
            return true;
        };

        for (const mod of mods) {
            if ((state.get(mod.id) || 0) === 0) {
                visit(mod);
            }
        }
        return { ordered, warnings };
    };

    const enabledMods = (catalog.mods || []).filter((m) => m.enabled && !m.error);
    const resolved = resolveModLoadOrder(enabledMods);
    dependencyWarnings = resolved.warnings;

    const loadModAssets = async () => {
        for (const mod of resolved.ordered) {
            const base = `/mods-runtime/mods/${encodeURIComponent(mod.folder)}`;
            for (const stylePath of mod.styles || []) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = `${base}/${stylePath.replace(/^\/+/, "")}`;
                document.head.appendChild(link);
            }
            if (mod.entry) {
                try {
                    const modModule = await import(`${base}/${mod.entry.replace(/^\/+/, "")}`);
                    if (modModule && typeof modModule.default === "function") {
                        await modModule.default(api, game);
                    }
                } catch (error) {
                    console.error(`[TrafficityMods] Failed to load mod ${mod.id}:`, error);
                }
            }
        }
    };

    let drawerOpen = false;
    const initialEnabledById = new Map((catalog.mods || []).map((entry) => [entry.id, Boolean(entry.enabled)]));
    const hasPendingModToggle = () =>
        (catalog.mods || []).some((entry) => Boolean(entry.enabled) !== Boolean(initialEnabledById.get(entry.id)));

    const escapeHtml = (str) =>
        String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");

    const renderManager = () => {
        const root = document.getElementById("trafficity-mod-manager-root");
        if (!root) return;

        const drawer = root.querySelector("#tmod-drawer");
        if (!drawer) return;
        drawer.style.display = drawerOpen ? "flex" : "none";

        const list = root.querySelector("#tmod-list");
        const restartBanner = root.querySelector("#tmod-restart-banner");
        restartBanner.style.display = hasPendingModToggle() ? "flex" : "none";

        if (!catalog.mods || catalog.mods.length === 0) {
            list.innerHTML = `<div class="tmod-empty">No mods found in:<br><code>${escapeHtml(catalog.modsDir || "")}</code><br><br>Drop a mod folder containing <code>mod.json</code> there and click Reload.</div>`;
            return;
        }

        list.innerHTML = catalog.mods
            .map((mod) => {
                const warn = dependencyWarnings.get(mod.id);
                const deps = [...(mod.dependencies || []), ...(mod.optionalDependencies || [])];
                const depBadge = deps.length > 0 ? `<span class="tmod-badge">${deps.length} dep${deps.length === 1 ? "" : "s"}</span>` : "";
                const loaderBadge = mod.modloaderVersion
                    ? `<span class="tmod-badge">Loader ${escapeHtml(mod.modloaderVersion)}</span>`
                    : "";
                return `
                    <div class="tmod-item ${mod.error || warn ? "tmod-error" : ""}">
                        <div class="tmod-item-info" style="flex:1;min-width:0;">
                            <div class="tmod-item-title">
                                <strong>${escapeHtml(mod.name)}</strong>
                                <span class="tmod-ver">v${escapeHtml(mod.version)}</span>
                                ${loaderBadge}
                                ${depBadge}
                            </div>
                            ${mod.author ? `<div class="tmod-author">by ${escapeHtml(mod.author)}</div>` : ""}
                            ${mod.forkedFrom ? `<div class="tmod-author" style="color:#93c5fd">Forked from ${escapeHtml(mod.forkedFrom.name || mod.forkedFrom.id)} v${escapeHtml(mod.forkedFrom.version || "1.0.0")}</div>` : ""}
                            ${mod.description ? `<div class="tmod-desc">${escapeHtml(mod.description)}</div>` : ""}
                            ${warn ? `<div class="tmod-desc" style="color:#fca5a5">${escapeHtml(warn)}</div>` : ""}
                        </div>
                        <label class="tmod-switch">
                            <input type="checkbox" data-mod-id="${escapeHtml(mod.id)}" ${mod.enabled ? "checked" : ""} ${mod.error ? "disabled" : ""}>
                            <span class="tmod-slider"></span>
                        </label>
                    </div>
                `;
            })
            .join("");

        for (const checkbox of list.querySelectorAll("input[type='checkbox'][data-mod-id]")) {
            checkbox.addEventListener("change", async (event) => {
                const id = event.target.getAttribute("data-mod-id");
                const enabled = event.target.checked;
                await fetch("/api/mods/toggle", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id, enabled }),
                });
                const target = catalog.mods.find((entry) => entry.id === id);
                if (target) target.enabled = enabled;
                renderManager();
            });
        }
    };

    const toggleManagerDrawer = () => {
        drawerOpen = !drawerOpen;
        renderManager();
    };

    const mountManagerUi = () => {
        if (document.getElementById("trafficity-mod-manager-root")) return;

        const style = document.createElement("style");
        style.textContent = `
            #trafficity-mod-manager-root { position: fixed; inset: 0; pointer-events: none; z-index: 999999; font-family: system-ui, -apple-system, sans-serif; }
            #tmod-pill { pointer-events: auto; position: fixed; right: 14px; bottom: 14px; background: rgba(18, 22, 30, 0.88); color: #f3f6fc; border: 1px solid rgba(255,255,255,0.16); border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; backdrop-filter: blur(8px); box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
            #tmod-pill:hover { background: rgba(34, 42, 58, 0.96); }
            #tmod-drawer { pointer-events: auto; position: fixed; right: 14px; bottom: 52px; width: 380px; max-height: 72vh; background: rgba(18, 22, 30, 0.96); color: #f3f6fc; border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,0.55); backdrop-filter: blur(12px); }
            .tmod-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .tmod-header h3 { margin: 0; font-size: 14px; font-weight: 700; }
            .tmod-actions { display: flex; gap: 6px; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
            .tmod-btn { background: rgba(255,255,255,0.1); color: #f3f6fc; border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
            .tmod-btn:hover { background: rgba(255,255,255,0.18); }
            .tmod-btn-primary { background: #3b82f6; border-color: #3b82f6; color: #fff; font-weight: 600; }
            .tmod-btn-primary:hover { background: #2563eb; }
            #tmod-restart-banner { display: none; align-items: center; justify-content: space-between; padding: 8px 14px; background: rgba(245, 158, 11, 0.18); border-bottom: 1px solid rgba(245, 158, 11, 0.35); font-size: 12px; color: #fde68a; }
            #tmod-path-banner { display: none; flex-direction: column; gap: 6px; padding: 8px 14px; background: rgba(59, 130, 246, 0.14); border-bottom: 1px solid rgba(59, 130, 246, 0.3); font-size: 11px; color: #dbeafe; }
            #tmod-path-banner code { background: rgba(0,0,0,0.35); padding: 3px 6px; border-radius: 4px; word-break: break-all; user-select: text; }
            #tmod-list { overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
            .tmod-empty { font-size: 12px; color: #94a3b8; line-height: 1.5; }
            .tmod-empty code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 4px; word-break: break-all; }
            .tmod-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); }
            .tmod-item.tmod-error { border-color: rgba(239, 68, 68, 0.5); }
            .tmod-item-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
            .tmod-ver, .tmod-author { font-size: 11px; color: #94a3b8; }
            .tmod-desc { font-size: 12px; color: #cbd5e1; margin-top: 4px; }
            .tmod-badge { font-size: 10px; background: rgba(59, 130, 246, 0.25); color: #93c5fd; padding: 1px 6px; border-radius: 999px; }
            .tmod-switch { position: relative; display: inline-block; width: 38px; height: 22px; flex-shrink: 0; }
            .tmod-switch input { opacity: 0; width: 0; height: 0; }
            .tmod-slider { position: absolute; cursor: pointer; inset: 0; background: #475569; border-radius: 22px; transition: 0.15s; }
            .tmod-slider:before { content: ""; position: absolute; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.15s; }
            .tmod-switch input:checked + .tmod-slider { background: #3b82f6; }
            .tmod-switch input:checked + .tmod-slider:before { transform: translateX(16px); }
        `;
        document.head.appendChild(style);

        const root = document.createElement("div");
        root.id = "trafficity-mod-manager-root";
        isolateUiElement(root);
        root.innerHTML = `
            <button id="tmod-pill" title="Open Mod Manager (F9)">Mods (${enabledMods.length})</button>
            <div id="tmod-drawer">
                <div class="tmod-header">
                    <h3>Trafficity Mod Manager</h3>
                    <button class="tmod-btn" id="tmod-close">Close (F9)</button>
                </div>
                <div class="tmod-actions">
                    <button class="tmod-btn" id="tmod-open-folder">Open Mods Folder</button>
                    <button class="tmod-btn" id="tmod-refresh">Refresh</button>
                    <button class="tmod-btn tmod-btn-primary" id="tmod-reload">Reload Game</button>
                </div>
                <div id="tmod-restart-banner">
                    <span>Mod changes apply after reload.</span>
                    <button class="tmod-btn tmod-btn-primary" id="tmod-reload-banner">Reload Now</button>
                </div>
                <div id="tmod-path-banner">
                    <span id="tmod-path-label">Mods folder:</span>
                    <code id="tmod-path-value"></code>
                    <div><button class="tmod-btn" id="tmod-copy-path">Copy Path</button></div>
                </div>
                <div id="tmod-list"></div>
            </div>
        `;
        document.body.appendChild(root);

        root.querySelector("#tmod-pill").addEventListener("click", toggleManagerDrawer);
        root.querySelector("#tmod-close").addEventListener("click", toggleManagerDrawer);
        const showPathBanner = (label, targetPath) => {
            const banner = root.querySelector("#tmod-path-banner");
            root.querySelector("#tmod-path-label").textContent = label;
            root.querySelector("#tmod-path-value").textContent = targetPath;
            banner.style.display = "flex";
        };
        root.querySelector("#tmod-copy-path").addEventListener("click", async () => {
            const val = root.querySelector("#tmod-path-value").textContent;
            if (val && navigator.clipboard) {
                await navigator.clipboard.writeText(val);
            }
        });
        root.querySelector("#tmod-open-folder").addEventListener("click", async () => {
            if (window.trafficityDesktop && typeof window.trafficityDesktop.openModsFolder === "function") {
                const res = await window.trafficityDesktop.openModsFolder();
                if (res && typeof res === "object" && !res.ok) {
                    const targetPath = res.hostPath || res.modsDir || catalog.modsDir;
                    const label = res.wine
                        ? "Proton/Wine cannot open Linux file manager directly. Mods folder:"
                        : `Could not open folder (${res.error || "unknown error"}). Path:`;
                    showPathBanner(label, targetPath);
                }
            } else if (catalog.modsDir) {
                showPathBanner("Mods folder:", catalog.modsDir);
            }
        });
        root.querySelector("#tmod-refresh").addEventListener("click", async () => {
            const res = await fetch("/api/mods");
            if (res.ok) {
                catalog = await res.json();
                renderManager();
            }
        });
        const doReload = () => {
            if (window.trafficityDesktop && typeof window.trafficityDesktop.reloadGame === "function") {
                window.trafficityDesktop.reloadGame();
            } else {
                window.location.reload();
            }
        };
        root.querySelector("#tmod-reload").addEventListener("click", doReload);
        root.querySelector("#tmod-reload-banner").addEventListener("click", doReload);

        renderManager();
    };

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", () => {
            loadModAssets();
            mountManagerUi();
        }, { once: true });
    } else {
        loadModAssets();
        mountManagerUi();
    }
})();
