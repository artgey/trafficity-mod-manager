const mods = window.TrafficityMods;

const isUiEventTarget = (target) => {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(
        target.closest(
            '.toolbar-container, #trafficity-mod-manager-root, #tmod-measuring-grid-hud, [id^="tmod-overlay-"], .ui-wheel-scroll, button, input, textarea, select',
        ),
    );
};

const cycleGridDensity = () => {
    const panel = document.querySelector(".road-toolbar-controls-panel--visible");
    if (!panel) return false;
    const firstRow = panel.querySelector(".road-toolbar-control-row");
    if (!firstRow) return false;
    const options = Array.from(firstRow.querySelectorAll("button.game-multi-button-option"));
    if (options.length === 0) return false;
    const activeIdx = options.findIndex((b) => b.classList && b.classList.contains("game-multi-button-option-selected"));
    const nextIdx = activeIdx === -1 ? 0 : (activeIdx + 1) % options.length;
    options[nextIdx].click();
    return true;
};

const isRoadPlacementActive = (game) => {
    const mode = game.getCursorMode();
    if (mode === "road placement") return true;
    if (mode && mode !== "default") return false;
    // Fallback when gameState is not yet captured: check if a road slot (non-special) is selected
    const slots = game.getToolbeltSlots();
    const specialTargets = new Set(["grid", "traffic-lights", "roundabout", "keep-clear"]);
    return slots.some((btn) => {
        if (!btn.classList || !btn.classList.contains("game-multi-button-option-selected")) return false;
        const wrapper = typeof btn.closest === "function" ? btn.closest("[data-tutorial-target]") : null;
        const t = wrapper && wrapper.getAttribute ? wrapper.getAttribute("data-tutorial-target") : null;
        return !t || !specialTargets.has(t);
    });
};

if (mods && mods.game) {
    const { game } = mods;

    game.watchToolbelt((slots) => {
        slots.slice(0, 10).forEach((btn, idx) => {
            game.addSlotBadge(btn, idx === 9 ? "0" : String(idx + 1));
        });
        game.addButtonHint("rectangle-delete", "Q/Del");
        game.addButtonHint("traffic-eraser", "⇧Del");
    });

    // Plan 7 / Toolbelt: 1-9 and 0 select toolbelt slots 1-10
    for (let i = 0; i < 10; i++) {
        const key = i === 9 ? "0" : String(i + 1);
        mods.bindKey(key, () => game.selectToolbeltSlot(i));
    }

    // Speed rebinds: Alt+1 (Pause/Stop), Alt+2 (Normal), Alt+3 (Fast)
    mods.bindKey("Alt+1", () => game.setSpeed("pause"));
    mods.bindKey("Alt+2", () => game.setSpeed("normal"));
    mods.bindKey("Alt+3", () => game.setSpeed("fast"));

    // Plan 1: Q toggle deletion (default -> rectangle-delete -> traffic-eraser -> off), Shift+Del for traffic eraser
    mods.bindKey("q", () => {
        if (game.isButtonSelected("rectangle-delete")) {
            game.pressButton("traffic-eraser");
        } else if (game.isButtonSelected("traffic-eraser")) {
            game.pressButton("traffic-eraser");
        } else {
            game.pressButton("rectangle-delete");
        }
    });
    mods.bindKey("Delete", () => game.pressButton("rectangle-delete"));
    mods.bindKey("Backspace", () => game.pressButton("rectangle-delete"));
    mods.bindKey("Shift+Delete", () => game.pressButton("traffic-eraser"));
    mods.bindKey("Shift+Backspace", () => game.pressButton("traffic-eraser"));

    // Mode shortcuts
    mods.bindKey("g", () => game.pressButton("grid"));
    mods.bindKey("l", () => game.pressButton("traffic-lights"));
    mods.bindKey("o", () => game.pressButton("roundabout"));
    mods.bindKey("k", () => game.pressButton("keep-clear"));

    // Plan 3: Context-aware E property shift + guard when nothing relevant is selected
    mods.bindKey("e", () => {
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
    if (typeof mods.onMouse === "function") {
        let rightPan = null;
        let shiftDelete = null;
        let dragPlace = null;
        let suppressNextContextMenu = false;

        // Plan 2: Mouse wheel cycles toolbelt; Ctrl+Wheel zooms camera
        mods.onMouse(
            "wheel",
            (e) => {
                if (e.target && typeof e.target.closest === "function" && e.target.closest(".ui-wheel-scroll, #trafficity-mod-manager-root")) {
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.ctrlKey) {
                    game.sendSyntheticWheel({
                        deltaX: e.deltaX,
                        deltaY: e.deltaY,
                        deltaZ: e.deltaZ,
                        deltaMode: e.deltaMode,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        ctrlKey: false,
                    });
                } else {
                    game.cycleToolbeltSlot(e.deltaY > 0 ? 1 : -1);
                }
            },
            { passive: false },
        );

        mods.onMouse("mousedown", (e) => {
            // Plan 7: Mouse Back (button 3) -> Undo, Mouse Forward (button 4) -> Redo
            if (e.button === 3) {
                e.preventDefault();
                e.stopImmediatePropagation();
                game.undo();
                return;
            }
            if (e.button === 4) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const redoSvc = typeof mods.use === "function" ? mods.use("redo") : null;
                if (redoSvc && typeof redoSvc.redo === "function") {
                    redoSvc.redo();
                }
                return;
            }

            if (isUiEventTarget(e.target)) return;

            // Plan 5: Shift + Right-Click Hold -> Rectangle Delete shortcut
            if (e.button === 2 && e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const wasDelete = game.isButtonSelected("rectangle-delete");
                if (!wasDelete) {
                    game.pressButton("rectangle-delete");
                }
                shiftDelete = { restoreOnUp: !wasDelete };
                game.sendSyntheticMouse("mousedown", {
                    button: 0,
                    buttons: 1,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    shiftKey: true,
                });
                return;
            }

            // Plan 4: Right-Click Hold when idle -> Camera Pan
            if (e.button === 2 && !e.shiftKey && game.isIdle()) {
                rightPan = { startX: e.clientX, startY: e.clientY, active: false };
                return;
            }

            // Plan 6: Left-Click Hold & Drop placement in road placement / grid modes
            if (e.button === 0 && !e.shiftKey) {
                const gs = globalThis.__trafficityGameState;
                const mode = game.getCursorMode();
                const canDragPlace =
                    (mode === "road placement" && gs?.cursorMode?.startPoint == null) ||
                    (mode === "grid" && gs?.cursorMode?.firstPoint == null);
                if (canDragPlace) {
                    dragPlace = { startX: e.clientX, startY: e.clientY, started: false };
                }
            }
        });

        mods.onMouse("mousemove", (e) => {
            if (rightPan && !rightPan.active) {
                if (Math.hypot(e.clientX - rightPan.startX, e.clientY - rightPan.startY) >= 4) {
                    rightPan.active = true;
                    game.sendSyntheticMouse("mousedown", {
                        button: 1,
                        buttons: 4,
                        clientX: rightPan.startX,
                        clientY: rightPan.startY,
                    });
                }
            }

            if (dragPlace && !dragPlace.started) {
                if (Math.hypot(e.clientX - dragPlace.startX, e.clientY - dragPlace.startY) >= 6) {
                    dragPlace.started = true;
                    game.sendSyntheticMouse("mousemove", {
                        button: 0,
                        buttons: 1,
                        clientX: dragPlace.startX,
                        clientY: dragPlace.startY,
                    });
                    game.sendSyntheticMouse("click", {
                        button: 0,
                        buttons: 0,
                        clientX: dragPlace.startX,
                        clientY: dragPlace.startY,
                    });
                }
            }
        });

        mods.onMouse("mouseup", (e) => {
            if (e.button === 0) {
                dragPlace = null;
            }

            if (e.button === 2 && shiftDelete) {
                e.preventDefault();
                e.stopImmediatePropagation();
                suppressNextContextMenu = true;
                game.sendSyntheticMouse("mouseup", {
                    button: 0,
                    buttons: 0,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    shiftKey: e.shiftKey,
                });
                if (shiftDelete.restoreOnUp) {
                    game.pressButton("rectangle-delete");
                }
                shiftDelete = null;
                return;
            }

            if (e.button === 2 && rightPan) {
                if (rightPan.active) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    suppressNextContextMenu = true;
                    game.sendSyntheticMouse("mouseup", {
                        button: 1,
                        buttons: 0,
                        clientX: e.clientX,
                        clientY: e.clientY,
                    });
                }
                rightPan = null;
            }
        });

        mods.onMouse("contextmenu", (e) => {
            if (suppressNextContextMenu) {
                e.preventDefault();
                e.stopImmediatePropagation();
                suppressNextContextMenu = false;
            }
        });
    }
}
