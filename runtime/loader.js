(() => {
    if (window.TrafficityMods) {
        return;
    }

    const SYNTHETIC_FLAG = "__trafficityModSynthetic";
    /**
     * @typedef {{
     *   __trafficityRouterRequire?: (id: string) => unknown,
     *   __trafficityPlayUiSfx?: (name: string) => void,
     *   __trafficityUndoModule?: TrafficityUndoModule,
     *   __trafficityUndoHistory?: TrafficityUndoHistoryModule,
     *   __trafficityUndoDeps?: Record<string, unknown>,
     *   __trafficityGameState?: TrafficityGameState,
     *   __trafficitySnapModule?: TrafficitySnapModule,
     *   __trafficityMaxSnapSearchSteps?: number,
     *   __trafficitySnapSearchStride?: number,
     *   __trafficitySuppressSnapLog?: boolean,
     * }} TrafficityInternalGlobals
     */
    const g = /** @type {typeof globalThis & TrafficityInternalGlobals} */ (globalThis);
    /** @type {Array<{ combo: string, spec: { ctrl: boolean, shift: boolean, alt: boolean, meta: boolean, code: string, rawKey: string }, handler: (event: KeyboardEvent) => boolean | void }>} */
    const keyBindings = [];
    /** @type {Array<{ type: string, wrapped: EventListener, listenerOpts: boolean | AddEventListenerOptions }>} */
    const mouseBindings = [];
    /** @type {Map<string, unknown>} */
    const services = new Map();
    /** @type {{ modsDir: string, mods: TrafficityCatalogMod[], gameRelease?: string | null }} */
    let catalog = { modsDir: "", mods: [] };
    /** @type {Map<string, string>} */
    let dependencyWarnings = new Map();

    /**
     * Installs always-on passive console & crash logging to `/api/dev/console/push` (`mods/logs/latest.log`).
     */
    const installPassiveLogger = () => {
        if (typeof console === "undefined" || typeof fetch !== "function") return;
        /** @param {unknown} value @param {WeakSet<object>} seen @param {number} depth @returns {string} */
        const safeFormat = (value, seen = new WeakSet(), depth = 0) => {
            if (value === null) return "null";
            if (value === undefined) return "undefined";
            if (typeof value === "string") return value;
            if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
            if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
            if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
            if (typeof value !== "object") return String(value);
            if (seen.has(value)) return "[Circular]";
            if (depth >= 2) return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
            seen.add(value);
            if (ArrayBuffer.isView(value)) {
                return `[${value.constructor?.name || "TypedArray"}(${/** @type {{ length?: number }} */ (value).length ?? value.byteLength})]`;
            }
            try {
                if (Array.isArray(value)) {
                    const items = value.slice(0, 12).map((item) => safeFormat(item, seen, depth + 1));
                    if (value.length > 12) items.push(`...+${value.length - 12}`);
                    return `[${items.join(", ")}]`;
                }
                const keys = Object.keys(value).slice(0, 16);
                const pairs = keys.map((k) => `${k}: ${safeFormat(/** @type {Record<string, unknown>} */ (value)[k], seen, depth + 1)}`);
                return `{${pairs.join(", ")}}`;
            } catch {
                return "[Unserializable]";
            }
        };

        /** @type {Array<{ ts: number, level: string, text: string, crash?: boolean }>} */
        const queue = [];
        let flushing = false;
        const flush = () => {
            if (flushing || queue.length === 0) return;
            flushing = true;
            const batch = queue.splice(0, queue.length);
            fetch("/api/dev/console/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passive: true, entries: batch }),
            })
                .catch(() => {
                    // ignore transient network errors
                })
                .finally(() => {
                    flushing = false;
                });
        };

        /**
         * @param {string} level
         * @param {unknown[]} args
         * @param {boolean} [crash]
         */
        const enqueue = (level, args, crash = false) => {
            const text = args.map((a) => safeFormat(a)).join(" ").slice(0, 8000);
            queue.push({ ts: Date.now(), level, text, ...(crash ? { crash: true } : {}) });
            if (queue.length > 400) queue.shift();
            if (crash || level === "error" || level === "warn") {
                flush();
            }
        };

        /** @type {Array<"log" | "info" | "warn" | "error">} */
        const levels = ["log", "info", "warn", "error"];
        for (const level of levels) {
            const orig = console[level];
            if (typeof orig !== "function" || /** @type {{ __trafficityLogged?: boolean }} */ (orig).__trafficityLogged) {
                continue;
            }
            const boundOrig = orig.bind(console);
            /** @param {unknown[]} args */
            const wrapped = (...args) => {
                boundOrig(...args);
                enqueue(level, args, false);
            };
            /** @type {{ __trafficityLogged?: boolean }} */ (wrapped).__trafficityLogged = true;
            console[level] = wrapped;
        }

        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("error", (ev) => {
                const detail = ev.error instanceof Error
                    ? (ev.error.stack || `${ev.error.name}: ${ev.error.message}`)
                    : `${ev.message || "Error"} (${ev.filename || ""}:${ev.lineno || 0}:${ev.colno || 0})`;
                enqueue("error", [`[Uncaught Error] ${detail}`], true);
            });
            window.addEventListener("unhandledrejection", (ev) => {
                enqueue("error", ["[Unhandled Rejection]", ev.reason], true);
            });
            const beaconFlush = () => {
                if (queue.length === 0 || typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
                const batch = queue.splice(0, queue.length);
                navigator.sendBeacon(
                    "/api/dev/console/push",
                    new Blob([JSON.stringify({ passive: true, entries: batch })], { type: "application/json" }),
                );
            };
            window.addEventListener("pagehide", beaconFlush);
            window.addEventListener("beforeunload", beaconFlush);
        }

        if (typeof setInterval === "function") {
            const timer = /** @type {number | { unref?: () => void }} */ (setInterval(flush, 500));
            if (timer && typeof timer === "object" && typeof timer.unref === "function") {
                timer.unref();
            }
        }
    };
    installPassiveLogger();

    /** @param {string} code */
    const codeToKeyInfo = (code) => {
        if (/^Key([A-Z])$/.test(code)) {
            const ch = code.slice(3).toLowerCase();
            return { key: ch, keyCode: ch.toUpperCase().charCodeAt(0) };
        }
        if (/^Digit([0-9])$/.test(code)) {
            const d = code.slice(5);
            return { key: d, keyCode: d.charCodeAt(0) };
        }
        /** @type {Record<string, { key: string, keyCode: number }>} */
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

    /** @param {EventTarget | null} target */
    const isEditableTarget = (target) => {
        if (!target || typeof target !== "object") {
            return false;
        }
        const el = /** @type {{ tagName?: string, isContentEditable?: boolean }} */ (target);
        const tag = (el.tagName || "").toUpperCase();
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el.isContentEditable);
    };

    /** @param {string} combo */
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

    /**
     * @param {KeyboardEvent} event
     * @param {{ ctrl: boolean, shift: boolean, alt: boolean, meta: boolean, code: string, rawKey: string }} spec
     */
    const matchesCombo = (event, spec) => {
        const keyMatch =
            event.code === spec.code ||
            event.key === spec.code ||
            (Boolean(spec.rawKey) && typeof event.key === "string" && event.key.toLowerCase() === spec.rawKey.toLowerCase());
        return (
            event.ctrlKey === spec.ctrl &&
            event.shiftKey === spec.shift &&
            event.altKey === spec.alt &&
            event.metaKey === spec.meta &&
            keyMatch
        );
    };

    /**
     * @param {string} toCode
     * @param {{ key: string, keyCode: number } | null} [overrideKeyInfo]
     * @param {{ ctrlKey?: boolean, shiftKey?: boolean, altKey?: boolean, metaKey?: boolean }} [modifiers]
     */
    const dispatchSyntheticKey = (toCode, overrideKeyInfo, modifiers = {}) => {
        const info = overrideKeyInfo || codeToKeyInfo(toCode);
        const cloned = /** @type {KeyboardEvent & Record<string, unknown>} */ (
            /** @type {unknown} */ (
                new KeyboardEvent("keydown", {
                    key: info.key,
                    code: toCode,
                    ctrlKey: Boolean(modifiers.ctrlKey),
                    shiftKey: Boolean(modifiers.shiftKey),
                    altKey: Boolean(modifiers.altKey),
                    metaKey: Boolean(modifiers.metaKey),
                    repeat: false,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
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

    /** @param {KeyboardEvent} event */
    const onKeyEvent = (event) => {
        if (/** @type {KeyboardEvent & Record<string, unknown>} */ (/** @type {unknown} */ (event))[SYNTHETIC_FLAG]) {
            return;
        }

        if (event.type === "keydown" && event.code === "F9" && !event.repeat) {
            event.preventDefault();
            event.stopImmediatePropagation();
            toggleManagerDrawer();
            return;
        }

        if (!isEditableTarget(event.target) && event.type === "keydown") {
            for (const binding of [...keyBindings]) {
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

    /** @param {Element | null} el */
    const resolveClickable = (el) => {
        if (!el) return null;
        if (el.tagName === "BUTTON") return /** @type {HTMLButtonElement} */ (el);
        return /** @type {HTMLElement | null} */ (
            (typeof el.querySelector === "function" && el.querySelector("button.game-multi-button-option, button")) || el
        );
    };

    const getToolbeltSlots = () => {
        const row = document.querySelector(".road-toolbar-buttons-row");
        if (!row || !row.children) return /** @type {HTMLButtonElement[]} */ ([]);
        /** @type {HTMLButtonElement[]} */
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
                buttons.push(/** @type {HTMLButtonElement} */ (child));
            } else if (typeof child.querySelectorAll === "function") {
                for (const btn of child.querySelectorAll("button.game-multi-button-option")) {
                    buttons.push(/** @type {HTMLButtonElement} */ (btn));
                }
            }
        }
        return buttons;
    };

    /** @type {Map<string, { radius: number, color?: number, alpha?: number }>} */
    const selectionRadiusRings = new Map();
    /** @type {Map<string, Array<{ textOrProvider: string | ((def: TrafficityBuildingDefinition) => string), style?: Record<string, string> }>>} */
    const buildingTooltipLines = new Map();
    /** @type {Set<(context: { building: TrafficityBuildingRecord, buildingDefinition: TrafficityBuildingDefinition | null, saveState: TrafficitySaveState, gameState: TrafficityGameState }) => string | TrafficityBuildingViewPanelSection | Array<string | TrafficityBuildingViewPanelSection> | null | undefined>} */
    const buildingViewPanelProviders = new Set();
    /** @type {Set<(pollutionGrid: TrafficityPollutionGrid, context: { saveState: TrafficitySaveState, cellSize: number, getBuildingDefinition: (type: string) => TrafficityBuildingDefinition | null }) => void>} */
    const pollutionDiffusionHandlers = new Set();
    let selectionRadiusHooked = false;
    let tooltipHooked = false;
    let buildingViewPanelHooked = false;
    let pollutionDiffusionHooked = false;

    /**
     * Creates a composable multi-mod export hook manager so multiple mods can
     * wrap the same Parcel export without clobbering each other and unsubscribe cleanly.
     * @template {(...args: never[]) => unknown} TFn
     * @param {() => Record<string, unknown> | null} resolveModule
     * @param {string} exportName
     * @returns {(wrapperFactory: (orig: TFn) => TFn) => () => void}
     */
    const createComposableExportHook = (resolveModule, exportName) => {
        /** @type {Array<(orig: TFn) => TFn>} */
        const factories = [];
        /** @type {Record<string, unknown> | null} */
        let hookedMod = null;
        /** @type {TFn | null} */
        let baseFn = null;
        /** @type {TFn | null} */
        let composedFn = null;

        const rebuildChain = () => {
            if (!baseFn) return;
            let fn = baseFn;
            for (const factory of factories) {
                const next = factory(fn);
                if (typeof next === "function") {
                    fn = next;
                }
            }
            composedFn = fn;
        };

        const ensureAttached = () => {
            const mod = resolveModule();
            if (!mod) return;
            if (hookedMod !== mod) {
                let orig;
                try {
                    orig = mod[exportName];
                } catch {
                    return;
                }
                if (typeof orig !== "function") return;
                hookedMod = mod;
                baseFn = /** @type {TFn} */ (orig);
                rebuildChain();
                overrideExport(mod, exportName, (/** @type {never[]} */ ...args) => {
                    const target = composedFn || baseFn;
                    return target ? target(...args) : undefined;
                });
            } else {
                rebuildChain();
            }
        };

        /** @param {(orig: TFn) => TFn} wrapperFactory */
        return (wrapperFactory) => {
            if (typeof wrapperFactory !== "function") return () => {};
            factories.push(wrapperFactory);
            ensureAttached();
            game.on("ready", ensureAttached);
            return () => {
                const idx = factories.indexOf(wrapperFactory);
                if (idx !== -1) {
                    factories.splice(idx, 1);
                    rebuildChain();
                }
            };
        };
    };

    const ensureSelectionRadiusHook = () => {
        if (selectionRadiusHooked) return;
        const ringMod = game.requireModule("POLLUTION_RADIUS_UI");
        if (!ringMod || typeof ringMod.setBuildingPollutionRadiusSelectionGraphic !== "function") return;
        selectionRadiusHooked = true;
        const origSetRing = ringMod.setBuildingPollutionRadiusSelectionGraphic;
        overrideExport(ringMod, "setBuildingPollutionRadiusSelectionGraphic", (/** @type {TrafficityGameState} */ gameState, /** @type {number} */ buildingId) => {
            const building = gameState?.saveState?.buildings?.[String(buildingId)];
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
        overrideExport(tooltipMod, "BuildingTypeTooltip", (/** @type {{ buildingDefinition: TrafficityBuildingDefinition }} */ props) => {
            const el = /** @type {{ props?: { children?: unknown } } | null} */ (origTooltip(props));
            const bType = props?.buildingDefinition?.type;
            const entries = bType ? buildingTooltipLines.get(bType) : null;
            if (!entries || entries.length === 0 || !el?.props) return el;
            const extraLines = [];
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const text = typeof entry.textOrProvider === "function"
                    ? entry.textOrProvider(props.buildingDefinition)
                    : entry.textOrProvider;
                if (!text) continue;
                extraLines.push(
                    jsxMod.jsx("div", {
                        className: "building-type-tooltip-line",
                        style: entry.style ?? { maxWidth: "220px", whiteSpace: "normal", lineHeight: "1.3", opacity: "0.85" },
                        children: text,
                    }, `tmod-tip-${bType}-${i}`),
                );
            }
            if (extraLines.length === 0) return el;
            const prevChildren = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
            return { ...el, props: { ...el.props, children: [...prevChildren, ...extraLines] } };
        });
    };

    const ensureBuildingViewPanelHook = () => {
        if (buildingViewPanelHooked) return;
        const panelMod = game.requireModule("BUILDING_VIEW_PANEL_UI");
        const jsxMod = game.requireModule("REACT_JSX");
        if (!panelMod || typeof panelMod.BuildingViewPanel !== "function" || !jsxMod?.jsx) return;
        buildingViewPanelHooked = true;
        const origPanel = panelMod.BuildingViewPanel;
        overrideExport(panelMod, "BuildingViewPanel", (/** @type {{ gameState: TrafficityGameState }} */ props) => {
            const el = /** @type {{ props?: { children?: unknown } } | null} */ (origPanel(props));
            if (!el?.props || buildingViewPanelProviders.size === 0) return el;
            const gameState = props?.gameState;
            const saveState = gameState?.saveState;
            const rawId = gameState?.uiMode?.mode === "building viewing"
                ? gameState.uiMode.buildingId
                : gameState?.worldSelection?.buildingId;
            const building = rawId !== undefined && rawId !== null ? saveState?.buildings?.[String(rawId)] : null;
            if (!building || !saveState) return el;

            const buildingDefinition = game.getBuildingDefinition(building.type);
            /** @type {TrafficityBuildingViewPanelSection[]} */
            const sections = [];
            for (const provider of buildingViewPanelProviders) {
                try {
                    const out = provider({ building, buildingDefinition, saveState, gameState });
                    if (!out) continue;
                    const items = Array.isArray(out) ? out : [out];
                    for (const item of items) {
                        if (typeof item === "string" && item) sections.push({ text: item });
                        else if (
                            item &&
                            typeof item === "object" &&
                            ((typeof item.text === "string" && item.text) || (Array.isArray(item.rows) && item.rows.length > 0))
                        ) {
                            sections.push(item);
                        }
                    }
                } catch (err) {
                    console.error("[TrafficityMods] Error in addBuildingViewPanelSection provider:", err);
                }
            }
            if (sections.length === 0) return el;

            const rootChildren = Array.isArray(el.props.children) ? [...el.props.children] : [el.props.children];
            const leftCol = /** @type {{ props?: { className?: string, children?: unknown } } | null} */ (rootChildren[0]);
            if (!leftCol?.props || leftCol.props.className !== "building-view-left") return el;
            const leftChildren = Array.isArray(leftCol.props.children) ? leftCol.props.children : [leftCol.props.children];
            const extraEls = sections.map((sec, i) => {
                if (Array.isArray(sec.rows) && sec.rows.length > 0) {
                    const children = [];
                    if (sec.title) {
                        children.push(
                            jsxMod.jsx("div", {
                                style: { fontWeight: "700", fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase", opacity: "0.8", marginBottom: "4px" },
                                children: sec.title,
                            }, "title"),
                        );
                    }
                    for (let rIdx = 0; rIdx < sec.rows.length; rIdx++) {
                        const row = sec.rows[rIdx];
                        const barWidth = typeof row.progress === "number" ? `${Math.max(0, Math.min(1, row.progress)) * 100}%` : null;
                        const rowColor = row.color || "#38bdf8";
                        children.push(
                            jsxMod.jsx("div", {
                                style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", lineHeight: "1.35", marginTop: "2px", fontVariantNumeric: "tabular-nums" },
                                children: [
                                    jsxMod.jsx("span", { style: { flex: "1 1 auto", opacity: "0.88", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: row.label }, "lbl"),
                                    barWidth !== null
                                        ? jsxMod.jsx("span", {
                                              style: { width: "44px", height: "5px", borderRadius: "999px", background: "rgba(255,255,255,0.12)", overflow: "hidden", flexShrink: "0" },
                                              children: jsxMod.jsx("span", {
                                                  style: { display: "block", width: barWidth, height: "100%", background: rowColor },
                                              }, "fill"),
                                          }, "bar")
                                        : null,
                                    jsxMod.jsx("span", { style: { fontWeight: "700", color: rowColor, minWidth: "40px", textAlign: "right" }, children: row.value }, "val"),
                                    row.target ? jsxMod.jsx("span", { style: { opacity: "0.68", fontSize: "10px", minWidth: "46px", textAlign: "right" }, children: row.target }, "tgt") : null,
                                    row.delta ? jsxMod.jsx("span", { style: { opacity: "0.85", fontSize: "10px", minWidth: "42px", textAlign: "right", color: rowColor }, children: row.delta }, "dlt") : null,
                                ],
                            }, `row-${rIdx}`),
                        );
                    }
                    return jsxMod.jsx("div", {
                        className: "building-view-panel-mod-section",
                        style: sec.style ?? { marginTop: "8px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,0.12)" },
                        children,
                    }, `tmod-bvp-${building.id}-${i}`);
                }
                return jsxMod.jsx("div", {
                    className: "building-view-panel-mod-line",
                    style: sec.style ?? { marginTop: "6px", fontSize: "12px", lineHeight: "1.3", opacity: "0.9" },
                    children: sec.text,
                }, `tmod-bvp-${building.id}-${i}`);
            });
            rootChildren[0] = { ...leftCol, props: { ...leftCol.props, children: [...leftChildren, ...extraEls] } };
            const prevStyle = /** @type {Record<string, unknown> | undefined} */ (/** @type {{ style?: unknown }} */ (el.props).style);
            const nextStyle = prevStyle && typeof prevStyle.height === "number"
                ? { ...prevStyle, minHeight: prevStyle.height, height: "auto" }
                : prevStyle;
            return { ...el, props: { ...el.props, ...(nextStyle ? { style: nextStyle } : {}), children: rootChildren } };
        });
    };

    const ensurePollutionDiffusionHook = () => {
        if (pollutionDiffusionHooked) return;
        const difMod = game.requireModule("POLLUTION_DIFFUSION");
        if (!difMod || typeof difMod.updatePollutionDiffusion !== "function") return;
        pollutionDiffusionHooked = true;
        const origDiffuse = difMod.updatePollutionDiffusion;
        overrideExport(difMod, "updatePollutionDiffusion", (/** @type {TrafficityPollutionGrid} */ pollutionGrid) => {
            origDiffuse(pollutionGrid);
            const saveState = g.__trafficityGameState?.saveState;
            if (!saveState || pollutionGrid !== saveState.pollutionGrid) return;
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

    /** Official map of human-readable module names to Trafficity Parcel module IDs (main thread). */
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
        BUILDING_HAPPINESS: "5JbRC",
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
        POLLUTION_OVERLAY_CONFIG: "7VBKL",
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

    /** Official map of Trafficity Parcel module IDs inside simulation Web Workers. */
    const WORKER_MODULES = Object.freeze({
        BOOT: "fHJ87",
        BUILDING_DEFINITIONS: "aS4Aq",
        BUILDING_VISITED_NEEDS: "6hect",
        BUILDING_VEHICLE_SPECS: "3baQI",
    });

    const hookRoadSnapImpl = createComposableExportHook(
        () => g.__trafficitySnapModule || game.requireModule("ROAD_SNAP"),
        "getNearestLaneCreationPoint",
    );
    const hookRoundaboutPlacementImpl = createComposableExportHook(
        () => game.requireModule("ROUNDABOUT_PLACEMENT"),
        "getPlaceRoundaboutResultForSize",
    );
    const hookRoadPlacementImpl = createComposableExportHook(
        () => game.requireModule("ROAD_PLACEMENT"),
        "getRoadConstructionActionWithPlacement",
    );

    /** @type {TrafficityGameFacade} */
    const game = {
        MODULES: ROUTER_MODULES,
        on: /** @type {TrafficityGameFacade["on"]} */ (() => () => {}),
        requireRouterModule: /** @type {TrafficityGameFacade["requireRouterModule"]} */ ((/** @type {string} */ id) => {
            try {
                return typeof g.__trafficityRouterRequire === "function"
                    ? g.__trafficityRouterRequire(id)
                    : null;
            } catch {
                return null;
            }
        }),
        requireModule: (/** @type {string} */ nameOrId) => {
            const resolved = /** @type {Record<string, string>} */ (ROUTER_MODULES)[nameOrId] || nameOrId;
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
            /** @param {HTMLButtonElement | null | undefined} btn */
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
            const gs = g.__trafficityGameState;
            return gs && gs.cursorMode ? gs.cursorMode.mode : null;
        },
        getCursorState: () => {
            const gs = g.__trafficityGameState;
            return gs && gs.cursorMode ? gs.cursorMode : null;
        },
        isIdle: () => {
            const gs = g.__trafficityGameState;
            if (gs && gs.cursorMode) {
                return gs.cursorMode.mode === "default";
            }
            return !document.querySelector(".road-toolbar-buttons-row .game-multi-button-option-selected");
        },
        sendSyntheticMouse: (type, init = {}) => {
            const target = document.querySelector("#pixi canvas") || document.body || window;
            const ev = /** @type {MouseEvent & Record<string, unknown>} */ (
                /** @type {unknown} */ (
                    new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        ...init,
                    })
                )
            );
            ev[SYNTHETIC_FLAG] = true;
            target.dispatchEvent(ev);
        },
        sendSyntheticWheel: (init = {}) => {
            const target = document.querySelector("#pixi canvas") || document.body || window;
            const ev = /** @type {WheelEvent & Record<string, unknown>} */ (
                /** @type {unknown} */ (
                    new WheelEvent("wheel", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        ...init,
                    })
                )
            );
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
            const host = /** @type {HTMLElement} */ (
                (typeof slotBtn.closest === "function" && slotBtn.closest(".game-multi-button")) || slotBtn
            );
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
            const el = /** @type {HTMLElement | null} */ (document.querySelector(`[data-tutorial-target="${target}"]`));
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
            if (typeof g.__trafficityPlayUiSfx === "function") {
                g.__trafficityPlayUiSfx(name);
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
            undoModule: g.__trafficityUndoModule || null,
            undoHistory: g.__trafficityUndoHistory || null,
            gameState: g.__trafficityGameState || null,
            undoDeps: g.__trafficityUndoDeps || null,
        }),
        getSnapApi: () => ({
            snapModule: g.__trafficitySnapModule || game.requireModule("ROAD_SNAP") || null,
        }),
        configureSnapSearch: ({ maxSteps, stride, suppressLog } = {}) => {
            if (typeof maxSteps === "number") g.__trafficityMaxSnapSearchSteps = maxSteps;
            if (typeof stride === "number") g.__trafficitySnapSearchStride = stride;
            if (typeof suppressLog === "boolean") g.__trafficitySuppressSnapLog = suppressLog;
            return {
                maxSteps: g.__trafficityMaxSnapSearchSteps ?? 30,
                stride: g.__trafficitySnapSearchStride ?? 1,
                suppressLog: Boolean(g.__trafficitySuppressSnapLog),
            };
        },
        getCameraState: () => {
            const gameState = g.__trafficityGameState;
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
            const z = typeof zoom === "number" ? zoom : (g.__trafficityGameState?.saveState?.cameraZoom ?? 1);
            const camMod = game.requireModule("CAMERA");
            return camMod && typeof camMod.getZoomAwareStrokeWidth === "function"
                ? camMod.getZoomAwareStrokeWidth(z)
                : 2;
        },
        createDashedCircle: (cx, cy, radius, options = {}) => {
            const gfxMod = game.requireModule("PIXI_GRAPHICS");
            if (!gfxMod?.Graphics) return null;
            const gObj = new gfxMod.Graphics();
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
                        if (i === 0) gObj.moveTo(x, y);
                        else gObj.lineTo(x, y);
                    }
                }
                dist = next;
                draw = !draw;
            }
            const strokeWidth = options.strokeWidth ?? game.getZoomAwareStrokeWidth();
            gObj.stroke({ width: strokeWidth, color: options.color ?? 0x00e5ff, alpha: options.alpha ?? 0.85 });
            return gObj;
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
            const existing = buildingTooltipLines.get(buildingType) || [];
            existing.push({ textOrProvider, style });
            buildingTooltipLines.set(buildingType, existing);
            game.on("ready", ensureTooltipHook);
        },
        addBuildingViewPanelSection: (provider) => {
            if (typeof provider !== "function") return () => {};
            buildingViewPanelProviders.add(provider);
            game.on("ready", ensureBuildingViewPanelHook);
            return () => buildingViewPanelProviders.delete(provider);
        },
        getBuildingSatisfaction: (buildingId, saveState) => {
            const ss = saveState || g.__trafficityGameState?.saveState;
            const b = ss?.buildings?.[String(buildingId)];
            const meta = /** @type {Record<string, unknown> | undefined} */ (
                /** @type {Record<string, unknown> | undefined} */ (ss)?.buildingHappinessMetadata
            );
            if (!b || !meta) return null;
            const satMod = game.requireModule("BUILDING_HAPPINESS");
            let overall = null;
            if (satMod && typeof satMod.getOverallHappinessForBuilding === "function") {
                try {
                    overall = satMod.getOverallHappinessForBuilding(meta, buildingId, b.type);
                } catch {
                    overall = null;
                }
            }
            /** @type {Record<string, TrafficityHappinessFactor>} */
            const factors = {};
            const factorGetters = [
                ["airQuality", "getHappinessAirQuality"],
                ["quietness", "getHappinessQuietness"],
                ["commercial", "getHappinessCommercial"],
                ["industrial", "getHappinessIndustrial"],
                ["acrossMap", "getHappinessAcrossMap"],
                ["visitorAccess", "getHappinessVisitorAccess"],
            ];
            for (const [key, method] of factorGetters) {
                const fn = meta[method];
                if (typeof fn !== "function") continue;
                try {
                    const reading = /** @type {{ currentValue?: number, targetValue?: number, velocity?: number } | null} */ (
                        fn.call(meta, buildingId)
                    );
                    if (reading && typeof reading.currentValue === "number") {
                        factors[key] = {
                            current: reading.currentValue,
                            target: typeof reading.targetValue === "number" ? reading.targetValue : reading.currentValue,
                            velocity: typeof reading.velocity === "number" ? reading.velocity : 0,
                        };
                    }
                } catch {
                    // ignore unavailable factor
                }
            }
            return { overall, factors };
        },
        createGraphics: () => {
            const gfxMod = game.requireModule("PIXI_GRAPHICS");
            return gfxMod?.Graphics ? new gfxMod.Graphics() : null;
        },
        createGridOverlaySprite: (gridWidth, gridHeight, cellSize) => {
            const spriteMod = /** @type {{ Sprite?: { from?: (src: HTMLCanvasElement) => TrafficityPixiContainer & { destroyed?: boolean, x: number, y: number, width: number, height: number, texture?: { source?: { scaleMode?: string, update?: () => void } } } } } | null} */ (
                game.requireModule("PIXI_SPRITE")
            );
            if (!spriteMod?.Sprite?.from || !(gridWidth > 0) || !(gridHeight > 0) || !(cellSize > 0)) return null;
            const canvas = document.createElement("canvas");
            canvas.width = gridWidth;
            canvas.height = gridHeight;
            const context = canvas.getContext("2d");
            if (!context) return null;
            const imageData = context.createImageData(gridWidth, gridHeight);
            const sprite = spriteMod.Sprite.from(canvas);
            if (sprite?.texture?.source) {
                sprite.texture.source.scaleMode = "linear";
            }
            sprite.x = 0;
            sprite.y = 0;
            sprite.width = gridWidth * cellSize;
            sprite.height = gridHeight * cellSize;
            return {
                canvas,
                context,
                imageData,
                sprite,
                update: () => {
                    context.putImageData(imageData, 0, 0);
                    sprite?.texture?.source?.update?.();
                },
            };
        },
        getGameState: () => g.__trafficityGameState || null,
        refreshPollutionOverlay: () => {
            const gs = /** @type {(TrafficityGameState & { pollutionOverlayBitmap?: { context: CanvasRenderingContext2D, imageData: ImageData, sprite: { texture: { source: { update(): void } } } } | null }) | null} */ (g.__trafficityGameState || null);
            const bmp = gs?.pollutionOverlayBitmap;
            const grid = gs?.saveState?.pollutionGrid;
            if (!bmp || !grid || typeof grid.getCellCount !== "function" || typeof grid.getDrivedATMapPoint !== "function") return;
            const cfgMod = game.requireModule("POLLUTION_OVERLAY_CONFIG");
            const cfg = /** @type {{ derivedStartCutoff?: number, derivedFullCutoff?: number, maxOpacity?: number } | undefined} */ (cfgMod?.pollutionOverlayRenderConfig);
            const startCutoff = cfg?.derivedStartCutoff ?? 0.2;
            const fullCutoff = cfg?.derivedFullCutoff ?? 0.4;
            const maxOpacity = cfg?.maxOpacity ?? 0.7;
            const { cellSize } = game.getPollutionConfig();
            const count = grid.getCellCount();
            const data = bmp.imageData.data;
            for (let i = 0; i < count; i++) {
                const cx = grid.getCellXFromIndex(i);
                const cy = grid.getCellYFromIndex(i);
                const a = grid.getDrivedATMapPoint(cx * cellSize, cy * cellSize, startCutoff, fullCutoff);
                data[4 * i + 3] = Math.round(a * maxOpacity * 255);
            }
            bmp.context.putImageData(bmp.imageData, 0, 0);
            bmp.sprite?.texture?.source?.update?.();
        },
        onPollutionDiffusion: (handler) => {
            if (typeof handler !== "function") return () => {};
            pollutionDiffusionHandlers.add(handler);
            game.on("ready", ensurePollutionDiffusionHook);
            return () => pollutionDiffusionHandlers.delete(handler);
        },
        hookRoadSnap: /** @type {TrafficityGameFacade["hookRoadSnap"]} */ (/** @type {unknown} */ (hookRoadSnapImpl)),
        hookRoundaboutPlacement: /** @type {TrafficityGameFacade["hookRoundaboutPlacement"]} */ (/** @type {unknown} */ (hookRoundaboutPlacementImpl)),
        hookRoadPlacement: /** @type {TrafficityGameFacade["hookRoadPlacement"]} */ (/** @type {unknown} */ (hookRoadPlacementImpl)),
        getGameRelease: () => catalog.gameRelease || null,
    };

    /** @type {Map<string, Set<(...args: unknown[]) => void>>} */
    const gameListeners = new Map();
    let readyEmitted = Boolean(g.__trafficityUndoModule && g.__trafficityGameState);
    /** @type {string | null} */
    let lastCursorMode = null;
    /** @type {number | null} */
    let lastWorldRevision = null;
    /** @type {number | null} */
    let lastUndoLen = null;
    /** @type {number | null} */
    let eventRafId = null;

    /**
     * @param {string} name
     * @param {...unknown} args
     */
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
            return Boolean(set && set.size > 0);
        });

    const pollGameEvents = () => {
        eventRafId = null;
        if (!hasWatchedStateListeners()) return;

        const gs = g.__trafficityGameState;
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

            const undoHist = g.__trafficityUndoHistory;
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
        if (g.__trafficityUndoModule || g.__trafficityGameState) {
            readyEmitted = true;
            emitGameEvent("ready");
        }
    };
    window.addEventListener("trafficity:undo-ready", ensureReady, { once: true });
    window.addEventListener("load", ensureReady, { once: true });

    game.on = /** @type {TrafficityGameFacade["on"]} */ ((/** @type {string} */ event, /** @type {(...args: unknown[]) => void} */ handler) => {
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
    });

    const BUILDING_CATEGORIES = new Set(["residential", "commercial", "office", "industrial"]);
    const BUILDING_POLLUTION_LEVELS = new Set(["none", "low", "medium", "high"]);
    const BUILDING_RESOURCES = new Set(["food", "copper", "iron", "steel", "cpg"]);
    const BUILDING_TERRAINS = new Set(["water", "land", "mountain", "void", "sand", "grass", "wasteland", "deepwasteland"]);
    /** @type {Record<string, string>} */
    const BUILDING_CATEGORY_COLORS = { residential: "#78CC51", commercial: "#3997e4", office: "#9b59d0", industrial: "#e8bd2c" };

    /**
     * @param {object} mod
     * @param {string} key
     * @param {unknown} value
     */
    const overrideExport = (mod, key, value) => {
        if (!mod || typeof mod !== "object") return;
        Object.defineProperty(mod, key, { value, writable: true, configurable: true, enumerable: true });
    };

    /** Declarative definition and lifecycle hooks for a custom Trafficity building type. */
    class CustomBuilding {
        /** @param {TrafficityCustomBuildingConfig} config */
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
                : (/** @type {number} */ w, /** @type {number} */ d) => [{
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
            /** @type {Record<string, unknown>} */
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
            return { ...this.toWorkerSafeDefinition(), getExtrusions: (/** @type {number} */ w, /** @type {number} */ d) => this._extrusionFactory(w, d, this) };
        }

        getDisplayName(lang = "en") {
            return this.localizedNames ? (this.localizedNames[lang] ?? this.localizedNames.en ?? this.name) : this.name;
        }

        getTotalVehicleCount() {
            if (!this.vehicles) return 0;
            if ("cars" in this.vehicles) return this.vehicles.cars || 0;
            let total = 0;
            const v = /** @type {{ trucks?: Record<string, number>, vans?: Record<string, number> }} */ (this.vehicles);
            for (const map of [v.trucks, v.vans]) {
                if (map) for (const n of Object.values(map)) total += n;
            }
            return total;
        }
    }

    /** @type {Map<string, CustomBuilding>} */
    const customBuildings = new Map();
    let buildingHooksAttached = false;
    let workerHookInstalled = false;
    /** @type {number | null} */
    let lastSelectedBuildingId = null;

    /**
     * @param {string} source
     * @param {Array<{ def: Record<string, unknown>, vehicles: unknown, needsVisited: boolean }>} entries
     */
    const injectBuildingsIntoWorkerSource = (source, entries) => {
        const bootAnchor = `,l(${JSON.stringify(WORKER_MODULES.BOOT)})`;
        const idx = source.lastIndexOf(bootAnchor);
        if (idx === -1) return source;
        const injection = `,(() => {
            const entries = ${JSON.stringify(entries)};
            const byType = new Map(entries.map((x) => [x.def.type, x]));
            const setExp = (m, k, v) => Object.defineProperty(m, k, { value: v, writable: true, configurable: true, enumerable: true });
            const defMod = l(${JSON.stringify(WORKER_MODULES.BUILDING_DEFINITIONS)});
            const origGetDef = defMod.getBuildingDefinition;
            setExp(defMod, "getBuildingDefinition", (t) => byType.has(t) ? byType.get(t).def : origGetDef(t));
            try {
                const visMod = l(${JSON.stringify(WORKER_MODULES.BUILDING_VISITED_NEEDS)});
                const origVis = visMod.buildingHasGetVisitedNeed;
                setExp(visMod, "buildingHasGetVisitedNeed", (t) => byType.has(t) ? Boolean(byType.get(t).needsVisited) : origVis(t));
            } catch {}
            try {
                const carMod = l(${JSON.stringify(WORKER_MODULES.BUILDING_VEHICLE_SPECS)});
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
        /**
         * @param {string | URL} scriptURL
         * @param {WorkerOptions} [options]
         */
        function PatchedTrafficityWorker(scriptURL, options) {
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
        }
        PatchedTrafficityWorker.prototype = NativeWorker.prototype;
        window.Worker = /** @type {typeof Worker} */ (/** @type {unknown} */ (PatchedTrafficityWorker));
    };
    installWorkerBuildingHook();

    const attachMainBuildingHooks = () => {
        if (buildingHooksAttached || customBuildings.size === 0) return;
        const defsMod = game.requireModule("BUILDING_DEFINITIONS");
        if (!defsMod || !Array.isArray(defsMod.BUILDING_DEFINITIONS)) return;
        buildingHooksAttached = true;

        /** @param {CustomBuilding} b */
        const upsertMain = (b) => {
            const def = /** @type {TrafficityBuildingDefinition} */ (/** @type {unknown} */ (b.toMainDefinition()));
            const idx = defsMod.BUILDING_DEFINITIONS.findIndex((d) => d.type === b.type);
            if (idx !== -1) defsMod.BUILDING_DEFINITIONS[idx] = def;
            else defsMod.BUILDING_DEFINITIONS.push(def);
        };
        for (const b of customBuildings.values()) upsertMain(b);

        const origGetDef = defsMod.getBuildingDefinition;
        const origGetColor = defsMod.getBuildingDefaultColor;
        overrideExport(defsMod, "getBuildingDefinition", (/** @type {string} */ t) => {
            const b = customBuildings.get(t);
            return b ? b.toMainDefinition() : origGetDef(t);
        });
        overrideExport(defsMod, "getBuildingDefaultColor", (/** @type {string} */ t) => {
            const b = customBuildings.get(t);
            return b ? b.buildingColors[0] : origGetColor(t);
        });

        const displayMod = game.requireModule("BUILDING_DISPLAY_NAMES");
        const i18nMod = game.requireModule("I18N");
        if (displayMod?.buildingDisplayName) {
            const origName = displayMod.buildingDisplayName;
            overrideExport(displayMod, "buildingDisplayName", (/** @type {string} */ t) => {
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
            overrideExport(carSpecMod, "getBuildingCarCountSpec", (/** @type {string} */ t) => {
                const b = customBuildings.get(t);
                return b ? b.vehicles : oSpec(t);
            });
            overrideExport(carSpecMod, "getResidentCarCountForResidentialBuildingType", (/** @type {string} */ t) => {
                const b = customBuildings.get(t);
                return b ? (b.vehicles && "cars" in b.vehicles ? b.vehicles.cars : 0) : oRes(t);
            });
            overrideExport(carSpecMod, "getTotalVehicleCountForBuildingType", (/** @type {string} */ t) => {
                const b = customBuildings.get(t);
                return b ? b.getTotalVehicleCount() : oTot(t);
            });
        }

        const visitedMod = game.requireModule("BUILDING_VISITED_NEEDS");
        if (visitedMod?.buildingHasGetVisitedNeed) {
            const oVis = visitedMod.buildingHasGetVisitedNeed;
            overrideExport(visitedMod, "buildingHasGetVisitedNeed", (/** @type {string} */ t) => {
                const b = customBuildings.get(t);
                return b ? b.needsVisited : oVis(t);
            });
        }

        const satMod = game.requireModule("BUILDING_SATISFACTION_WEIGHTS");
        if (satMod?.getSatisfactionWeightForBuildingType) {
            const oSat = satMod.getSatisfactionWeightForBuildingType;
            overrideExport(satMod, "getSatisfactionWeightForBuildingType", (/** @type {string} */ t) => {
                const b = customBuildings.get(t);
                return b ? b.satisfactionWeight : oSat(t);
            });
        }

        const placeMod = game.requireModule("BUILDING_PLACEMENT");
        if (placeMod) {
            /**
             * @param {TrafficityGameState} st
             * @param {Set<string>} prevIds
             * @param {Record<string, unknown>} deps
             */
            const finalizePlaced = (st, prevIds, deps) => {
                for (const [id, rec] of Object.entries(st.saveState?.buildings || {})) {
                    if (prevIds.has(id)) continue;
                    const b = customBuildings.get(rec.type);
                    if (!b) continue;
                    if (b.buildingCategory === "residential" && b.vehicles && "cars" in b.vehicles && b.vehicles.cars > 0) {
                        if (!b.garage) {
                            const spawn = deps && typeof deps.spawnOutdoorResidentialCar === "function"
                                ? /** @type {(...args: unknown[]) => void} */ (deps.spawnOutdoorResidentialCar)
                                : null;
                            for (let i = 0; i < Math.min(b.vehicles.cars, b.parkingSpaces.length); i++) {
                                spawn?.(rec.id, rec.type, rec.footprint, i, st);
                            }
                        }
                    }
                    b._hooks.onPlace?.(st, rec, { placementDeps: deps }, b);
                }
            };
            const oPlace = placeMod.placeBuildingsFromFootprints;
            const oRestore = placeMod.restoreBuildingsAtFootprints;
            overrideExport(placeMod, "placeBuildingsFromFootprints", (/** @type {TrafficityGameState} */ st, /** @type {string} */ typeName, /** @type {TrafficityBuildingFootprint[]} */ fps, /** @type {Record<string, unknown>} */ deps, /** @type {boolean | undefined} */ sfx) => {
                const prev = new Set(Object.keys(st.saveState?.buildings || {}));
                const res = oPlace(st, typeName, fps, deps, sfx);
                finalizePlaced(st, prev, deps);
                return res;
            });
            overrideExport(placeMod, "restoreBuildingsAtFootprints", (/** @type {TrafficityGameState} */ st, /** @type {Array<{ definition: TrafficityBuildingDefinition, footprint: TrafficityBuildingFootprint }>} */ items, /** @type {Record<string, unknown>} */ deps) => {
                const prev = new Set(Object.keys(st.saveState?.buildings || {}));
                const res = oRestore(st, items, deps);
                finalizePlaced(st, prev, deps);
                return res;
            });
        }

        const delMod = game.requireModule("BUILDING_DELETION");
        if (delMod?.deleteBuildingsFromGameState) {
            const oDel = delMod.deleteBuildingsFromGameState;
            overrideExport(delMod, "deleteBuildingsFromGameState", (/** @type {TrafficityGameState} */ st, /** @type {number[]} */ ids) => {
                /** @type {Array<[TrafficityBuildingRecord, CustomBuilding]>} */
                const deleting = [];
                for (const id of ids) {
                    const rec = st.saveState?.buildings?.[String(id)];
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
            overrideExport(gfxMod, "createBuildingGraphicsParts", (/** @type {TrafficityGameState} */ st, /** @type {TrafficityBuildingRecord} */ rec, /** @type {Record<string, unknown> | undefined} */ opts) => {
                const parts = oCreate(st, rec, opts);
                const b = customBuildings.get(rec.type);
                b?._hooks.onRenderWorld?.(parts, rec, st, pixi, b);
                return parts;
            });
            overrideExport(gfxMod, "updateBuildingGraphics", (/** @type {TrafficityGameState} */ st, /** @type {TrafficityBuildingRecord} */ rec, /** @type {Record<string, unknown> | undefined} */ opts) => {
                oUpdate(st, rec, opts);
                const b = customBuildings.get(rec.type);
                if (!b?._hooks.onRenderWorld) return;
                const obj = st.buildingGraphics?.object?.get(rec.id);
                if (obj) {
                    const parts = /** @type {TrafficityBuildingGraphicsParts} */ ({
                        object: obj,
                        ground: st.buildingGraphics?.ground?.get(rec.id),
                        groundSidewalk: st.buildingGraphics?.groundSidewalk?.get(rec.id),
                        shadow: st.buildingGraphics?.shadow?.get(rec.id),
                    });
                    b._hooks.onRenderWorld(parts, rec, st, pixi, b);
                }
            });
        }

        window.addEventListener("click", () => queueMicrotask(() => {
            const st = g.__trafficityGameState;
            if (!st?.worldSelection) return;
            const selId = st.worldSelection.type === "building" && typeof st.worldSelection.buildingId === "number"
                ? st.worldSelection.buildingId
                : null;
            if (selId === lastSelectedBuildingId) return;
            lastSelectedBuildingId = selId;
            if (selId !== null) {
                const rec = st.saveState?.buildings?.[String(selId)];
                const b = rec ? customBuildings.get(rec.type) : null;
                b?._hooks.onSelect?.(st, rec, b);
            }
        }), true);

        const seedQuotas = () => {
            const st = g.__trafficityGameState;
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

    /** @type {TrafficityBuildingsApi} */
    const buildingsApi = {
        CustomBuilding,
        register: (configOrInstance) => {
            const b = configOrInstance instanceof CustomBuilding
                ? configOrInstance
                : new CustomBuilding(/** @type {TrafficityCustomBuildingConfig} */ (configOrInstance));
            customBuildings.set(b.type, b);
            if (buildingHooksAttached) {
                const defsMod = game.requireModule("BUILDING_DEFINITIONS");
                if (defsMod?.BUILDING_DEFINITIONS) {
                    const idx = defsMod.BUILDING_DEFINITIONS.findIndex((d) => d.type === b.type);
                    const def = /** @type {TrafficityBuildingDefinition} */ (/** @type {unknown} */ (b.toMainDefinition()));
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

    /** @param {HTMLElement} el */
    const isolateUiElement = (el) => {
        if (!el || typeof el.addEventListener !== "function") return;
        for (const type of UI_ISOLATION_EVENTS) {
            el.addEventListener(type, (e) => {
                e.stopPropagation();
            });
        }
    };

    /** @type {TrafficityModsApi} */
    const api = {
        version: "1.4.2",
        game,
        buildings: buildingsApi,
        extendGame: /** @type {TrafficityModsApi["extendGame"]} */ ((/** @type {Record<string, unknown>} */ methods) => {
            if (methods && typeof methods === "object") {
                Object.assign(game, methods);
            }
            return game;
        }),
        getMods: () => catalog.mods.slice(),
        getModsDir: () => catalog.modsDir,
        provide: (/** @type {string} */ name, /** @type {unknown} */ serviceApi) => {
            if (name) services.set(name, serviceApi);
        },
        use: /** @type {TrafficityModsApi["use"]} */ ((/** @type {string} */ name) => services.get(name) || null),
        bindKey: (combo, handler) => {
            if (typeof handler !== "function") return () => {};
            const entry = { combo, spec: parseCombo(combo), handler };
            keyBindings.push(entry);
            return () => {
                const idx = keyBindings.indexOf(entry);
                if (idx !== -1) keyBindings.splice(idx, 1);
            };
        },
        sendSyntheticKey: (code, key, keyCode, modifiers) => {
            dispatchSyntheticKey(code, key ? { key, keyCode: keyCode || 0 } : null, modifiers);
        },
        onMouse: /** @type {TrafficityModsApi["onMouse"]} */ ((/** @type {string} */ type, /** @type {(event: Event) => void} */ handler, /** @type {boolean | AddEventListenerOptions} */ options = {}) => {
            if (typeof handler !== "function") return () => {};
            /** @type {EventListener} */
            const wrapped = (event) => {
                if (event && /** @type {Event & Record<string, unknown>} */ (/** @type {unknown} */ (event))[SYNTHETIC_FLAG]) return;
                handler(event);
            };
            const listenerOpts =
                typeof options === "boolean" ? true : { ...options, capture: true };
            const entry = { type, wrapped, listenerOpts };
            mouseBindings.push(entry);
            window.addEventListener(type, wrapped, listenerOpts);
            return () => {
                window.removeEventListener(type, wrapped, listenerOpts);
                const idx = mouseBindings.indexOf(entry);
                if (idx !== -1) mouseBindings.splice(idx, 1);
            };
        }),
        getConfig: /** @type {TrafficityModsApi["getConfig"]} */ ((/** @type {string} */ modId, /** @type {Record<string, unknown>} */ defaults = {}) => {
            const modEntry = catalog.mods.find((entry) => entry.id === modId);
            const savedConfig = modEntry && modEntry.config ? modEntry.config : {};
            return { ...defaults, ...savedConfig };
        }),
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
                let host = /** @type {HTMLDivElement | null} */ (document.getElementById(`tmod-overlay-${id}`));
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
                return host;
            };
            if (document.body) return mount();
            window.addEventListener("DOMContentLoaded", () => { mount(); }, { once: true });
            return null;
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

    /** @param {TrafficityCatalogMod[]} mods */
    const resolveModLoadOrder = (mods) => {
        const byId = new Map(mods.map((m) => [m.id, m]));
        /** @type {Map<string, string>} */
        const warnings = new Map();
        /** @type {TrafficityCatalogMod[]} */
        const ordered = [];
        /** @type {Map<string, number>} */
        const state = new Map(); // 0=unvisited, 1=visiting, 2=visited

        /** @param {TrafficityCatalogMod} mod */
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

    /** @param {unknown} str */
    const escapeHtml = (str) =>
        String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");

    const renderManager = () => {
        const root = document.getElementById("trafficity-mod-manager-root");
        if (!root) return;

        const drawer = /** @type {HTMLElement | null} */ (root.querySelector("#tmod-drawer"));
        if (!drawer) return;
        drawer.style.display = drawerOpen ? "flex" : "none";

        const list = /** @type {HTMLElement | null} */ (root.querySelector("#tmod-list"));
        const restartBanner = /** @type {HTMLElement | null} */ (root.querySelector("#tmod-restart-banner"));
        if (!list || !restartBanner) return;
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
                const input = /** @type {HTMLInputElement | null} */ (event.target);
                if (!input) return;
                const id = input.getAttribute("data-mod-id");
                const enabled = input.checked;
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

        root.querySelector("#tmod-pill")?.addEventListener("click", toggleManagerDrawer);
        root.querySelector("#tmod-close")?.addEventListener("click", toggleManagerDrawer);
        /**
         * @param {string} label
         * @param {string} targetPath
         */
        const showPathBanner = (label, targetPath) => {
            const banner = /** @type {HTMLElement | null} */ (root.querySelector("#tmod-path-banner"));
            const labelEl = root.querySelector("#tmod-path-label");
            const valueEl = root.querySelector("#tmod-path-value");
            if (labelEl) labelEl.textContent = label;
            if (valueEl) valueEl.textContent = targetPath;
            if (banner) banner.style.display = "flex";
        };
        root.querySelector("#tmod-copy-path")?.addEventListener("click", async () => {
            const val = root.querySelector("#tmod-path-value")?.textContent;
            if (val && navigator.clipboard) {
                await navigator.clipboard.writeText(val);
            }
        });
        root.querySelector("#tmod-open-folder")?.addEventListener("click", async () => {
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
        root.querySelector("#tmod-refresh")?.addEventListener("click", async () => {
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
        root.querySelector("#tmod-reload")?.addEventListener("click", doReload);
        root.querySelector("#tmod-reload-banner")?.addEventListener("click", doReload);

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
