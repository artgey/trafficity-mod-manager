# Trafficity Controls & UX Enhancements — Mini-Plans Roadmap

This document tracks all 7 enhancements implemented in `trafficity-mod-manager`, `redo-mod`, and `toolbelt-hotkeys-mod`.

---

## Plan 1: `Q` Toggle Deletion + `Shift+Del` *(Done)*
- `Q` cycles deletion tools (`default` -> `rectangle-delete` -> `traffic-eraser` -> exit).
- Removed `T` binding; added `Shift+Delete` / `Shift+Backspace` for `traffic-eraser` alongside `Delete` / `Backspace` for `rectangle-delete`.

## Plan 2: Mouse Wheel Toolbelt Cycling + `Ctrl+Scroll` Zoom *(Done)*
- Plain `wheel` cycles through all `.road-toolbar-buttons-row` toolbelt slots (preserving `.ui-wheel-scroll` panels and Mod Manager scrolling).
- `Ctrl+Wheel` dispatches a synthetic zoom `wheel` event to Trafficity without triggering Chromium page zoom.

## Plan 3: Context-Aware `E` Property Shift + Selected-Only Guard *(Done)*
- In `grid` mode: `E` cycles the Grid Density options in `.road-toolbar-controls-panel--visible`.
- In `road placement`, `rectangle-delete`, or `roundabout` modes: `E` passes through to Trafficity natively.
- When no road/grid/roundabout/delete tool is selected: `E` is blocked so Curve Mode never toggles in the background.

## Plan 4: Right-Click Hold Camera Pan (When Idle) *(Done)*
- When idle (`game.isIdle()`), holding and dragging Right Mouse (`>= 4 px`) pans the camera via synthetic middle-mouse (`button: 1`) events and suppresses the trailing `contextmenu`; quick right-click remains normal.

## Plan 5: `Shift + Right-Click` Hold Rectangle Delete Shortcut *(Done)*
- Holding `Shift + Right-Click` activates `rectangle-delete` (if not already active), forwards left-mouse drag (`button: 0`), and restores the previous tool on release.

## Plan 6: Click-and-Drag ("Hold & Drop") Placement *(Done)*
- In `road placement` (`startPoint == null`) or `grid` (`firstPoint == null`), dragging `>= 6 px` with left-mouse clicks the start point automatically so releasing the mouse finishes the placement, while `< 6 px` clicks preserve normal click-move-click placement.

## Plan 7: Mouse Back/Forward Buttons as Undo (`Ctrl+Z`) & Redo *(Done)*
- Mouse Back (`button === 3`) triggers `game.undo()` (`Ctrl+Z`); Mouse Forward (`button === 4`) triggers `redo-mod` (`TrafficityMods.use("redo")?.redo()`).
