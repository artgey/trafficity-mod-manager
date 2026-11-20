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

    const game = {
        requireRouterModule: (id) => {
            try {
                return typeof globalThis.__trafficityRouterRequire === "function"
                    ? globalThis.__trafficityRouterRequire(id)
                    : null;
            } catch {
                return null;
            }
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
            const sfxMod = game.requireRouterModule("lVhdV");
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
            snapModule: globalThis.__trafficitySnapModule || game.requireRouterModule("aYVZj") || null,
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
            const constantsModule = game.requireRouterModule("bTgKI");
            return {
                laneWidth: constantsModule && typeof constantsModule.LANE_WIDTH === "number" ? constantsModule.LANE_WIDTH : 20,
                lanePointSpacing:
                    constantsModule && typeof constantsModule.LANE_POINT_SPACING === "number"
                        ? constantsModule.LANE_POINT_SPACING
                        : 3,
            };
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
        version: "1.4.0",
        game,
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
    let dirtyRestart = false;

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
        restartBanner.style.display = dirtyRestart ? "flex" : "none";

        if (!catalog.mods || catalog.mods.length === 0) {
            list.innerHTML = `<div class="tmod-empty">No mods found in:<br><code>${escapeHtml(catalog.modsDir || "")}</code><br><br>Drop a mod folder containing <code>mod.json</code> there and click Reload.</div>`;
            return;
        }

        list.innerHTML = catalog.mods
            .map((mod) => {
                const warn = dependencyWarnings.get(mod.id);
                const deps = [...(mod.dependencies || []), ...(mod.optionalDependencies || [])];
                const depBadge = deps.length > 0 ? `<span class="tmod-badge">${deps.length} dep${deps.length === 1 ? "" : "s"}</span>` : "";
                const schema = Array.isArray(mod.settingsSchema) ? mod.settingsSchema : [];
                const settingsHtml =
                    schema.length > 0
                        ? `<div class="tmod-settings" style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:6px;">
                            ${schema
                                .map((s) => {
                                    const cur = mod.config && mod.config[s.key] !== undefined ? mod.config[s.key] : s.value;
                                    const label = escapeHtml(s.label || s.key);
                                    if (s.type === "boolean") {
                                        return `<label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#e2e8f0;gap:8px;"><span>${label}</span><input type="checkbox" data-setting-mod="${escapeHtml(mod.id)}" data-setting-key="${escapeHtml(s.key)}" data-setting-type="boolean" ${cur ? "checked" : ""}></label>`;
                                    }
                                    if (s.type === "select" && Array.isArray(s.options)) {
                                        const opts = s.options
                                            .map((o) => `<option value="${escapeHtml(o)}" ${String(cur) === String(o) ? "selected" : ""}>${escapeHtml(o)}</option>`)
                                            .join("");
                                        return `<label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#e2e8f0;gap:8px;"><span>${label}</span><select data-setting-mod="${escapeHtml(mod.id)}" data-setting-key="${escapeHtml(s.key)}" data-setting-type="select" style="background:#0f172a;color:#f8fafc;border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:2px 6px;font-size:11px;">${opts}</select></label>`;
                                    }
                                    const inputType = s.type === "number" ? "number" : "text";
                                    return `<label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#e2e8f0;gap:8px;"><span>${label}</span><input type="${inputType}" data-setting-mod="${escapeHtml(mod.id)}" data-setting-key="${escapeHtml(s.key)}" data-setting-type="${inputType}" value="${escapeHtml(cur ?? "")}" style="width:110px;background:#0f172a;color:#f8fafc;border:1px solid rgba(255,255,255,0.18);border-radius:4px;padding:2px 6px;font-size:11px;"></label>`;
                                })
                                .join("")}
                           </div>`
                        : "";
                return `
                    <div class="tmod-item ${mod.error || warn ? "tmod-error" : ""}">
                        <div class="tmod-item-info" style="flex:1;min-width:0;">
                            <div class="tmod-item-title">
                                <strong>${escapeHtml(mod.name)}</strong>
                                <span class="tmod-ver">v${escapeHtml(mod.version)}</span>
                                ${depBadge}
                            </div>
                            ${mod.author ? `<div class="tmod-author">by ${escapeHtml(mod.author)}</div>` : ""}
                            ${mod.forkedFrom ? `<div class="tmod-author" style="color:#93c5fd">Forked from ${escapeHtml(mod.forkedFrom.name || mod.forkedFrom.id)} v${escapeHtml(mod.forkedFrom.version || "1.0.0")}</div>` : ""}
                            ${mod.description ? `<div class="tmod-desc">${escapeHtml(mod.description)}</div>` : ""}
                            ${warn ? `<div class="tmod-desc" style="color:#fca5a5">${escapeHtml(warn)}</div>` : ""}
                            ${settingsHtml}
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
            checkbox.addEventListener("change", async (e) => {
                const id = e.target.getAttribute("data-mod-id");
                const enabled = e.target.checked;
                await fetch("/api/mods/toggle", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id, enabled }),
                });
                const target = catalog.mods.find((m) => m.id === id);
                if (target) target.enabled = enabled;
                dirtyRestart = true;
                renderManager();
            });
        }

        for (const input of list.querySelectorAll("[data-setting-mod][data-setting-key]")) {
            input.addEventListener("change", async (e) => {
                const modId = e.target.getAttribute("data-setting-mod");
                const key = e.target.getAttribute("data-setting-key");
                const kind = e.target.getAttribute("data-setting-type");
                const target = catalog.mods.find((m) => m.id === modId);
                if (!target) return;
                const val =
                    kind === "boolean"
                        ? Boolean(e.target.checked)
                        : kind === "number"
                          ? Number(e.target.value)
                          : e.target.value;
                const nextConfig = { ...(target.config || {}), [key]: val };
                await api.setConfig(modId, nextConfig);
                dirtyRestart = true;
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
