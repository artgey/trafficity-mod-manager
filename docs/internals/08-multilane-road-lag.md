# 08 — Remaining Lag When Connecting Multilane Roads to Multilane Roads

## Symptom
Even with `snap-perf-fix` enabled, dragging to connect a multilane road to another multilane road still causes noticeable frame drops (not exclusive to roundabouts).

## Root Causes Found

### 1. `placementCache` Cache-Key Misses in `examples/snap-perf-fix-mod/mod.js`
In [`examples/snap-perf-fix-mod/mod.js`](../../examples/snap-perf-fix-mod/mod.js#L164-L185):
- `saveState?.money ?? 0` is included in `placementCache`'s key, so every money tick invalidates the entire road-placement cache.
- `fingerprintStartPoint(endPoint)` uses **unquantized** `endPoint.x, endPoint.y` for `"absolute"` points, causing a cache miss on every 1px pointer movement.

### 2. Expensive Overlap & Glue-Along Recovery in `h0N8S.getRoadConstructionAction`
When connecting multilane roads in `Router.8fc9524d.js` (`h0N8S`):
1. `T(e, t, n, r)` generates the initial multi-lane construction action.
2. `WppSZ.getConstructionOverlaps(e, o).existing` scans overlaps across all lanes of the draft road.
3. Whenever overlaps exist (very common when approaching another multilane road), `h0N8S` invokes:
   - `gSON2.tryEarlyGlueAlongRecovery(e, r, t, n, a, o)`
   - `gSON2.tryPromoteEndOnlyGlueToGlueAlong(e, r, t, n, o)`
4. Both call into `E71eU.createRoadGluedAlong` (`createGlueAlongPath`, `createGlueAlongSplitInstructions`, `pairUpChopOffs`, `walkForwardAndBackwardFromTargetWithUpdatedLaneEndReferences`), which performs repeated lane-graph walks and chop-off pairing for every lane pair on **every mousemove**.

### 3. Per-Mousemove Preview Geometry Rebuilds
Whenever `getRoadConstructionAction` returns a new object, the preview renderer rebuilds PixiJS draft graphics synchronously inside the pointer-move path rather than coalescing to `requestAnimationFrame`.

## Optimization Targets
1. **Fix `placementCache` key** in `snap-perf-fix`:
   - Remove `saveState.money` from the geometry cache key.
   - Quantize `"absolute"` coordinates by `quantizeStepForZoom(saveState?.cameraZoom)` in `fingerprintStartPoint`.
2. **Coalesce / rate-limit multilane preview updates** to at most once per animation frame (`requestAnimationFrame`) during road placement drag.
3. **Profile `WppSZ.getConstructionOverlaps` and `gSON2` recovery** on multilane-to-multilane junctions to see whether spatial pre-filtering or memoizing `getConstructionOverlaps` eliminates the remaining spike.
