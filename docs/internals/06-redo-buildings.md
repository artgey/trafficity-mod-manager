# 06 — Redo Only Works on Roads, Not on Buildings

## Symptom
Pressing Redo (`Ctrl+Y` / Mouse Forward) restores undone road edits, junctions, and intersections, but does nothing after undoing building placement or building deletion.

## Root Cause
In `Router.8fc9524d.js`, the undo module (`f5Ojv`) supports **three** `subRecord.kind` types in `applyUndoSubRecord` (`L`) and `validateUndoSubRecord` (`I`):

| `subRecord.kind` | Undo Behavior in `f5Ojv` |
| --- | --- |
| `"confirm"` | Reverts road/junction/intersection construction or deletion (`b(e, t, n.record, i)`). |
| `"buildings placed"` | Deletes `n.buildings` via `gh1Od.deleteBuildingsFromGameState(...)` using `history.renames.building`. |
| `"buildings deleted"` | Restores `n.buildings` via `v(e, t, n.buildings, i)`. |

In [`examples/redo-mod/mod.js`](../../examples/redo-mod/mod.js), `buildRedoSubRecord` explicitly rejects everything except `"confirm"`:

```js
if (!subRecord || subRecord.kind !== "confirm" || !subRecord.record) {
    return null;
}
```

Because building placement/deletion entries contain `"buildings placed"` or `"buildings deleted"` sub-records, `buildRedoSubRecord` returns `null` and the entry is never pushed to `redoStack`.

## Fix Direction
1. Extend `buildRedoSubRecord` in `examples/redo-mod/mod.js`:
   - If `subRecord.kind === "buildings placed"`: return a redo sub-record with `kind: "buildings deleted"` and `buildings` snapshotted from live `saveState.buildings` (resolving IDs via `history.renames.building` and lane-section target locators via `history.renames.laneSection`).
   - If `subRecord.kind === "buildings deleted"`: return a redo sub-record with `kind: "buildings placed"` and `buildings: subRecord.buildings`.
2. Verify `applyUndoSubRecord` (`f5Ojv`) restores building quotas, footprints, and graphics cleanly when invoked on the inverted sub-records.
