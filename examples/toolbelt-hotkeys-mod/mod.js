/** @param {TrafficityGameFacade} game */
const isModalOrMenuOpen = (game) => {
    const gs = typeof game.getGameState === "function" ? game.getGameState() : null;
    return Boolean(gs && gs.isModalDialogOpen);
};

/** @param {EventTarget | null} target */
const isUiEventTarget = (target) => {
    const el = /** @type {Element | null} */ (target);
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(
        el.closest(
            '.toolbar-container, #trafficity-mod-manager-root, #tmod-measuring-grid-hud, [id^="tmod-overlay-"], .ui-wheel-scroll, button, input, textarea, select',
        ),
    );
};

const cycleGridDensity = () => {
    const controlPanel = document.querySelector(".road-toolbar-controls-panel--visible");
    if (!controlPanel) return false;
    const firstRow = controlPanel.querySelector(".road-toolbar-control-row");
    if (!firstRow) return false;
    const densityOptions = /** @type {HTMLButtonElement[]} */ (
        Array.from(firstRow.querySelectorAll("button.game-multi-button-option"))
    );
    if (densityOptions.length === 0) return false;
    const activeIndex = densityOptions.findIndex(
        (optionButton) =>
            optionButton.classList && optionButton.classList.contains("game-multi-button-option-selected"),
    );
    const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % densityOptions.length;
    densityOptions[nextIndex].click();
    return true;
};

/** @param {TrafficityGameFacade} game */
const isRoadPlacementActive = (game) => {
    const cursorMode = game.getCursorMode();
    if (cursorMode === "road placement") return true;
    if (cursorMode && cursorMode !== "default") return false;
    // Fallback when gameState is not yet captured: check if a road slot (non-special) is selected
    const toolbeltSlots = game.getToolbeltSlots();
    const specialTargets = new Set(["grid", "traffic-lights", "roundabout", "keep-clear"]);
    return toolbeltSlots.some((slotButton) => {
        if (!slotButton.classList || !slotButton.classList.contains("game-multi-button-option-selected")) return false;
        const wrapper = typeof slotButton.closest === "function" ? slotButton.closest("[data-tutorial-target]") : null;
        const tutorialTarget = wrapper && wrapper.getAttribute ? wrapper.getAttribute("data-tutorial-target") : null;
        return !tutorialTarget || !specialTargets.has(tutorialTarget);
    });
};

/**
 * @param {TrafficityModsApi} modApi
 * @param {TrafficityGameFacade} game
 */
export default function setupToolbeltHotkeys(modApi, game) {
    /** @type {Record<string, unknown>} */
    const modConfig = typeof modApi.getConfig === "function" ? modApi.getConfig("toolbelt-hotkeys") || {} : {};
    /**
     * @param {string} settingKey
     * @param {string} fallback
     */
    const keyFor = (settingKey, fallback) => {
        const val = modConfig[settingKey];
        return typeof val === "string" && val.trim() ? val.trim() : fallback;
    };

    game.watchToolbelt((toolbeltSlots) => {
        toolbeltSlots.slice(0, 10).forEach((slotButton, slotIndex) => {
            game.addSlotBadge(slotButton, slotIndex === 9 ? "0" : String(slotIndex + 1));
        });
        game.addButtonHint("rectangle-delete", "Q/Del");
        game.addButtonHint("traffic-eraser", "⇧Del");
    });

    /**
     * @param {string} combo
     * @param {(event: KeyboardEvent) => boolean | void} handler
     */
    const bindGameplayKey = (combo, handler) =>
        modApi.bindKey(combo, (event) => {
            if (isModalOrMenuOpen(game)) return false;
            return handler(event);
        });

    // Plan 7 / Toolbelt: 1-9 and 0 select toolbelt slots 1-10
    for (let slotIndex = 0; slotIndex < 10; slotIndex++) {
        const keyLabel = slotIndex === 9 ? "0" : String(slotIndex + 1);
        bindGameplayKey(keyLabel, () => game.selectToolbeltSlot(slotIndex));
    }

    // Speed rebinds: Alt+1 (Pause/Stop), Alt+2 (Normal), Alt+3 (Fast)
    bindGameplayKey(keyFor("speedPause", "Alt+1"), () => game.setSpeed("pause"));
    bindGameplayKey(keyFor("speedNormal", "Alt+2"), () => game.setSpeed("normal"));
    bindGameplayKey(keyFor("speedFast", "Alt+3"), () => game.setSpeed("fast"));

    // Plan 1: Q toggle deletion (default -> rectangle-delete -> traffic-eraser -> off), Shift+Del for traffic eraser
    bindGameplayKey(keyFor("toggleDelete", "q"), () => {
        if (game.isButtonSelected("rectangle-delete")) {
            game.pressButton("traffic-eraser");
        } else if (game.isButtonSelected("traffic-eraser")) {
            game.pressButton("traffic-eraser");
        } else {
            game.pressButton("rectangle-delete");
        }
    });
    bindGameplayKey(keyFor("rectDelete", "Delete"), () => game.pressButton("rectangle-delete"));
    bindGameplayKey("Backspace", () => game.pressButton("rectangle-delete"));
    bindGameplayKey(keyFor("trafficEraser", "Shift+Delete"), () => game.pressButton("traffic-eraser"));
    bindGameplayKey("Shift+Backspace", () => game.pressButton("traffic-eraser"));

    // Mode shortcuts
    bindGameplayKey(keyFor("gridMode", "g"), () => game.pressButton("grid"));
    bindGameplayKey(keyFor("trafficLightsMode", "l"), () => game.pressButton("traffic-lights"));
    bindGameplayKey(keyFor("roundaboutMode", "o"), () => game.pressButton("roundabout"));
    bindGameplayKey(keyFor("keepClearMode", "k"), () => game.pressButton("keep-clear"));

    // Plan 3: Context-aware E property shift + guard when nothing relevant is selected
    bindGameplayKey(keyFor("propertyShift", "e"), () => {
        if (game.isButtonSelected("grid")) {
            cycleGridDensity();
            return true;
        }
        if (
            game.isButtonSelected("rectangle-delete") ||
            game.isButtonSelected("roundabout") ||
            isRoadPlacementActive(game)
        ) {
            return false; // Let Trafficity handle E natively
        }
        return true; // Block E from toggling curve mode when no road/grid/roundabout/delete is active
    });

    // Mouse interactions (Plans 2, 4, 5, 6, 7)
    if (typeof modApi.onMouse === "function") {
        /** @type {{ startX: number, startY: number, active: boolean } | null} */
        let rightPanState = null;
        /** @type {{ restoreOnUp: boolean } | null} */
        let shiftDeleteState = null;
        /** @type {{ startX: number, startY: number, started: boolean } | null} */
        let dragPlaceState = null;
        let suppressNextContextMenu = false;

        // Plan 2: Mouse wheel cycles toolbelt; Ctrl+Wheel zooms camera
        modApi.onMouse(
            "wheel",
            (wheelEvent) => {
                if (isModalOrMenuOpen(game)) return;
                const el = /** @type {Element | null} */ (wheelEvent.target);
                if (
                    el &&
                    typeof el.closest === "function" &&
                    el.closest(".ui-wheel-scroll, #trafficity-mod-manager-root")
                ) {
                    return;
                }
                wheelEvent.preventDefault();
                wheelEvent.stopImmediatePropagation();
                if (wheelEvent.ctrlKey) {
                    game.sendSyntheticWheel({
                        deltaX: wheelEvent.deltaX,
                        deltaY: wheelEvent.deltaY,
                        deltaZ: wheelEvent.deltaZ,
                        deltaMode: wheelEvent.deltaMode,
                        clientX: wheelEvent.clientX,
                        clientY: wheelEvent.clientY,
                        ctrlKey: false,
                    });
                } else {
                    game.cycleToolbeltSlot(wheelEvent.deltaY > 0 ? 1 : -1);
                }
            },
            { passive: false },
        );

        modApi.onMouse("mousedown", (mouseEvent) => {
            if (isModalOrMenuOpen(game)) {
                rightPanState = null;
                dragPlaceState = null;
                return;
            }
            // Plan 7: Mouse Back (button 3) -> Undo, Mouse Forward (button 4) -> Redo
            if (mouseEvent.button === 3) {
                mouseEvent.preventDefault();
                mouseEvent.stopImmediatePropagation();
                game.undo();
                return;
            }
            if (mouseEvent.button === 4) {
                mouseEvent.preventDefault();
                mouseEvent.stopImmediatePropagation();
                const redoService = typeof modApi.use === "function" ? modApi.use("redo") : null;
                if (redoService && typeof redoService.redo === "function") {
                    redoService.redo();
                }
                return;
            }

            if (isUiEventTarget(mouseEvent.target)) return;

            // Plan 5: Shift + Right-Click Hold -> Rectangle Delete shortcut
            if (mouseEvent.button === 2 && mouseEvent.shiftKey) {
                mouseEvent.preventDefault();
                mouseEvent.stopImmediatePropagation();
                const wasDeleteSelected = game.isButtonSelected("rectangle-delete");
                if (!wasDeleteSelected) {
                    game.pressButton("rectangle-delete");
                }
                shiftDeleteState = { restoreOnUp: !wasDeleteSelected };
                game.sendSyntheticMouse("mousedown", {
                    button: 0,
                    buttons: 1,
                    clientX: mouseEvent.clientX,
                    clientY: mouseEvent.clientY,
                    shiftKey: true,
                });
                return;
            }

            // Plan 4: Right-Click Hold when idle -> Camera Pan
            if (mouseEvent.button === 2 && !mouseEvent.shiftKey && game.isIdle()) {
                rightPanState = { startX: mouseEvent.clientX, startY: mouseEvent.clientY, active: false };
                return;
            }

            // Plan 6: Left-Click Hold & Drop placement in road placement / grid modes
            if (mouseEvent.button === 0 && !mouseEvent.shiftKey) {
                const cursorState = typeof game.getCursorState === "function" ? game.getCursorState() : null;
                const cursorMode = cursorState?.mode ?? game.getCursorMode();
                const canDragPlace =
                    (cursorMode === "road placement" && cursorState?.startPoint == null) ||
                    (cursorMode === "grid" && cursorState?.firstPoint == null);
                if (canDragPlace) {
                    dragPlaceState = { startX: mouseEvent.clientX, startY: mouseEvent.clientY, started: false };
                }
            }
        });

        modApi.onMouse("mousemove", (mouseEvent) => {
            if (rightPanState && !rightPanState.active) {
                if (Math.hypot(mouseEvent.clientX - rightPanState.startX, mouseEvent.clientY - rightPanState.startY) >= 4) {
                    rightPanState.active = true;
                    game.sendSyntheticMouse("mousedown", {
                        button: 1,
                        buttons: 4,
                        clientX: rightPanState.startX,
                        clientY: rightPanState.startY,
                    });
                }
            }

            if (dragPlaceState && !dragPlaceState.started) {
                if (Math.hypot(mouseEvent.clientX - dragPlaceState.startX, mouseEvent.clientY - dragPlaceState.startY) >= 6) {
                    dragPlaceState.started = true;
                    game.sendSyntheticMouse("mousemove", {
                        button: 0,
                        buttons: 1,
                        clientX: dragPlaceState.startX,
                        clientY: dragPlaceState.startY,
                    });
                    game.sendSyntheticMouse("click", {
                        button: 0,
                        buttons: 0,
                        clientX: dragPlaceState.startX,
                        clientY: dragPlaceState.startY,
                    });
                }
            }
        });

        modApi.onMouse("mouseup", (mouseEvent) => {
            if (mouseEvent.button === 0) {
                dragPlaceState = null;
            }

            if (mouseEvent.button === 2 && shiftDeleteState) {
                mouseEvent.preventDefault();
                mouseEvent.stopImmediatePropagation();
                suppressNextContextMenu = true;
                game.sendSyntheticMouse("mouseup", {
                    button: 0,
                    buttons: 0,
                    clientX: mouseEvent.clientX,
                    clientY: mouseEvent.clientY,
                    shiftKey: mouseEvent.shiftKey,
                });
                if (shiftDeleteState.restoreOnUp) {
                    game.pressButton("rectangle-delete");
                }
                shiftDeleteState = null;
                return;
            }

            if (mouseEvent.button === 2 && rightPanState) {
                if (rightPanState.active) {
                    mouseEvent.preventDefault();
                    mouseEvent.stopImmediatePropagation();
                    suppressNextContextMenu = true;
                    game.sendSyntheticMouse("mouseup", {
                        button: 1,
                        buttons: 0,
                        clientX: mouseEvent.clientX,
                        clientY: mouseEvent.clientY,
                    });
                }
                rightPanState = null;
            }
        });

        modApi.onMouse("contextmenu", (mouseEvent) => {
            if (suppressNextContextMenu) {
                mouseEvent.preventDefault();
                mouseEvent.stopImmediatePropagation();
                suppressNextContextMenu = false;
            }
        });
    }
}
