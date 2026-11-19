import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("toolbelt-hotkeys manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf-8"));
    assert.equal(manifest.id, "toolbelt-hotkeys");
    assert.equal(manifest.entry, "mod.js");
    assert.deepEqual(manifest.styles, ["style.css"]);
    assert.deepEqual(manifest.optionalDependencies, ["redo-mod"]);
});

test("toolbelt-hotkeys implements Plans 1-7 via TrafficityMods.game facade", async () => {
    const bindings = new Map();
    const mouseHandlers = new Map();
    const slotBadges = [];
    const buttonHints = [];
    const selectedSlots = [];
    const pressedButtons = [];
    const speeds = [];
    const cycledDeltas = [];
    const syntheticMouse = [];
    const syntheticWheels = [];
    const selectedState = new Set();
    let cursorMode = "default";
    let idle = true;
    let undoCalls = 0;
    let redoCalls = 0;
    let mockGameState = null;

    const fakeSlots = [
        { id: "s1", classList: { contains: () => selectedState.has("road") } },
        { id: "s2", classList: { contains: () => false } },
    ];

    const gridDensityClicks = [];
    const gridDensityBtn0 = { classList: { contains: () => true }, click: () => gridDensityClicks.push(0) };
    const gridDensityBtn1 = { classList: { contains: () => false }, click: () => gridDensityClicks.push(1) };

    globalThis.document = {
        querySelector: (sel) => {
            if (sel === ".road-toolbar-controls-panel--visible") {
                return {
                    querySelector: () => ({
                        querySelectorAll: () => [gridDensityBtn0, gridDensityBtn1],
                    }),
                };
            }
            return null;
        },
    };

    globalThis.window = {
        TrafficityMods: {
            bindKey: (combo, handler) => bindings.set(combo, handler),
            onMouse: (type, handler) => mouseHandlers.set(type, handler),
            use: (name) => (name === "redo" ? { redo: () => { redoCalls += 1; } } : null),
            game: {
                watchToolbelt: (cb) => cb(fakeSlots),
                getToolbeltSlots: () => fakeSlots,
                addSlotBadge: (btn, label) => slotBadges.push([btn.id, label]),
                addButtonHint: (target, label) => buttonHints.push([target, label]),
                selectToolbeltSlot: (idx) => selectedSlots.push(idx),
                cycleToolbeltSlot: (delta) => cycledDeltas.push(delta),
                setSpeed: (mode) => speeds.push(mode),
                isButtonSelected: (target) => selectedState.has(target),
                pressButton: (target) => {
                    pressedButtons.push(target);
                    if (target === "rectangle-delete") {
                        if (selectedState.has("rectangle-delete")) selectedState.delete("rectangle-delete");
                        else {
                            selectedState.clear();
                            selectedState.add("rectangle-delete");
                        }
                    } else if (target === "traffic-eraser") {
                        if (selectedState.has("traffic-eraser")) selectedState.delete("traffic-eraser");
                        else {
                            selectedState.clear();
                            selectedState.add("traffic-eraser");
                        }
                    }
                },
                getCursorMode: () => cursorMode,
                getUndoApi: () => ({ gameState: mockGameState }),
                isIdle: () => idle,
                sendSyntheticMouse: (type, init) => syntheticMouse.push({ type, ...init }),
                sendSyntheticWheel: (init) => syntheticWheels.push(init),
                undo: () => {
                    undoCalls += 1;
                },
            },
        },
    };

    try {
        await import(`./mod.js?t=${Date.now()}`);

        assert.deepEqual(slotBadges, [["s1", "1"], ["s2", "2"]]);
        assert.deepEqual(buttonHints, [["rectangle-delete", "Q/Del"], ["traffic-eraser", "⇧Del"]]);

        // Plan 1: Q toggles rectangle-delete -> traffic-eraser -> off; Shift+Delete triggers traffic-eraser; T removed
        assert.equal(bindings.has("t"), false);
        bindings.get("q")();
        assert.equal(selectedState.has("rectangle-delete"), true);
        bindings.get("q")();
        assert.equal(selectedState.has("traffic-eraser"), true);
        bindings.get("q")();
        assert.equal(selectedState.size, 0);
        bindings.get("Shift+Delete")();
        assert.equal(pressedButtons.at(-1), "traffic-eraser");
        selectedState.clear();

        // Plan 2: Wheel cycles toolbelt; Ctrl+Wheel sends synthetic zoom wheel
        const wheel = mouseHandlers.get("wheel");
        wheel({ deltaY: 120, ctrlKey: false, preventDefault() {}, stopImmediatePropagation() {} });
        wheel({ deltaY: -120, ctrlKey: false, preventDefault() {}, stopImmediatePropagation() {} });
        assert.deepEqual(cycledDeltas, [1, -1]);
        wheel({ deltaY: -120, deltaX: 0, deltaZ: 0, deltaMode: 0, clientX: 50, clientY: 60, ctrlKey: true, preventDefault() {}, stopImmediatePropagation() {} });
        assert.equal(syntheticWheels.length, 1);
        assert.equal(syntheticWheels[0].ctrlKey, false);

        // Plan 3: E blocked when idle, cycles density in grid mode, passes through in road placement
        assert.equal(bindings.get("e")(), true);
        selectedState.add("grid");
        assert.equal(bindings.get("e")(), true);
        assert.deepEqual(gridDensityClicks, [1]);
        selectedState.clear();
        cursorMode = "road placement";
        assert.equal(bindings.get("e")(), false);

        // Plan 4: Right-click hold when idle pans via middle mouse
        cursorMode = "default";
        idle = true;
        const mousedown = mouseHandlers.get("mousedown");
        const mousemove = mouseHandlers.get("mousemove");
        const mouseup = mouseHandlers.get("mouseup");
        const contextmenu = mouseHandlers.get("contextmenu");

        mousedown({ button: 2, shiftKey: false, clientX: 100, clientY: 100 });
        mousemove({ clientX: 112, clientY: 105 });
        assert.deepEqual(syntheticMouse.at(-1), { type: "mousedown", button: 1, buttons: 4, clientX: 100, clientY: 100 });
        mouseup({ button: 2, clientX: 112, clientY: 105, preventDefault() {}, stopImmediatePropagation() {} });
        assert.deepEqual(syntheticMouse.at(-1), { type: "mouseup", button: 1, buttons: 0, clientX: 112, clientY: 105 });
        let ctxPrevented = false;
        contextmenu({ preventDefault: () => { ctxPrevented = true; }, stopImmediatePropagation() {} });
        assert.equal(ctxPrevented, true);

        // Plan 5: Shift+Right-click hold activates rectangle-delete, drags left-click, and restores on release
        mousedown({ button: 2, shiftKey: true, clientX: 200, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
        assert.equal(selectedState.has("rectangle-delete"), true);
        assert.deepEqual(syntheticMouse.at(-1), { type: "mousedown", button: 0, buttons: 1, clientX: 200, clientY: 200, shiftKey: true });
        mouseup({ button: 2, shiftKey: true, clientX: 240, clientY: 240, preventDefault() {}, stopImmediatePropagation() {} });
        assert.equal(selectedState.has("rectangle-delete"), false);

        // Plan 6: Left click-and-drag placement in road placement
        cursorMode = "road placement";
        mockGameState = { cursorMode: { mode: "road placement", startPoint: null } };
        mousedown({ button: 0, shiftKey: false, clientX: 10, clientY: 10 });
        mousemove({ clientX: 30, clientY: 10 });
        assert.deepEqual(syntheticMouse.slice(-2), [
            { type: "mousemove", button: 0, buttons: 1, clientX: 10, clientY: 10 },
            { type: "click", button: 0, buttons: 0, clientX: 10, clientY: 10 },
        ]);
        mouseup({ button: 0 });

        // Plan 7: Mouse Back/Forward Undo/Redo
        mousedown({ button: 3, preventDefault() {}, stopImmediatePropagation() {} });
        assert.equal(undoCalls, 1);
        mousedown({ button: 4, preventDefault() {}, stopImmediatePropagation() {} });
        assert.equal(redoCalls, 1);
    } finally {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.__trafficityGameState;
    }
});
