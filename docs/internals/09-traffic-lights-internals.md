# 09 — Traffic Lights Status Internals & API Mapping

## Verified Parcel Modules (`Router.8fc9524d.js` & `car-worker.28a3b082.js`)

| Module ID | Suggested Logical Name | Key Exports |
| --- | --- | --- |
| `5TAGW` | `INTERSECTION_METADATA` | `ParallelIntersectionMetadata`, `createParallelIntersectionMetadataBuffers`, `PARALLEL_INTERSECTION_MAX_INTERSECTIONS` (`50000`) |
| `dcoVe` | `TRAFFIC_LIGHT_HELPERS` | `shouldLaneShowAmber`, `canSourceLaneProceedThroughIntersection` |
| `bTgKI` | `ROAD_CONSTANTS` | `TRAFFIC_LIGHT_CIRCLE_OFFSET` (`8`), `INTERSECTION_PLACEMENT_COST` (`400`) |
| `aIdtw` | `TRAFFIC_LIGHT_CHOP_GUARD` | `draftChopExhaustsTrafficLightArm` |

## Live State Storage (`saveState`)
- **Static / Structural Definition**: `saveState.intersections[intersectionId]`
  - `id: number`
  - `phaseIds: number[]` — ordered cycle of phase IDs
  - `phases: Record<number, { durationSeconds: number; laneEndsWithGreenLight: number[] }>`
- **Live Signal State (`SharedArrayBuffer`)**: `saveState.intersectionMetadata` (instance of `5TAGW.ParallelIntersectionMetadata`)
  - `getCurrentPhaseId(intersectionId) -> number` / `setCurrentPhaseId(id, phaseId)` (`Int32Array`)
  - `getAreAmberLightsShowing(intersectionId) -> boolean` / `setAreAmberLightsShowing(id, bool)` (`Int32Array`, `0`/`1`)
  - `getTimeRemainingInPhase(intersectionId) -> number` / `setTimeRemainingInPhase(id, seconds)` (`Float32Array`)
  - `carsPassedThrough[intersectionId]` (`Int32Array`)
  - `initializeForIntersection(intersection)`

## Per-Lane Signal Status Logic (`dcoVe`)
- **Amber**: `shouldLaneShowAmber(intersection, laneSectionId, metadata)`
  - Returns `true` iff `metadata.getAreAmberLightsShowing(intersection.id)` is `true`, `laneSectionId` is in the current phase's `laneEndsWithGreenLight`, and `laneSectionId` is **not** in the next phase's `laneEndsWithGreenLight`.
- **Green (Proceed)**: `canSourceLaneProceedThroughIntersection(intersection, laneSectionId, metadata)`
  - Returns `true` iff `laneSectionId` is in the current phase's `laneEndsWithGreenLight` and `!shouldLaneShowAmber(...)`.
- **Red**: Otherwise (`!canProceed && !isAmber`).

## Phase Advancement Loop (`Router.8fc9524d.js`)
Every simulation tick, for each `intersection` in `Object.values(saveState.intersections)`:
1. `remaining = metadata.getTimeRemainingInPhase(id) - dtMs / 1000`
2. `metadata.setTimeRemainingInPhase(id, remaining)`
3. If `remaining <= 1.5 && !metadata.getAreAmberLightsShowing(id)`:
   - Sets `areAmberLightsShowing = true`, clamps `timeRemainingInPhase = 1.5`, calls `updateIntersectionTrafficLightCircles(gameState, intersection)`.
4. If `remaining <= 0`:
   - Advances `currentPhaseId` to `phaseIds[(currentIndex + 1) % phaseIds.length]`.
   - Sets `timeRemainingInPhase = nextPhase.durationSeconds`, `areAmberLightsShowing = false`.
   - Calls `updateIntersectionTrafficLightCircles(gameState, intersection)`.

## Proposed `TrafficityMods.game` Facade Mapping
- Add `INTERSECTION_METADATA: "5TAGW"` and `TRAFFIC_LIGHT_HELPERS: "dcoVe"` to `ROUTER_MODULES` in `runtime/loader.js`.
- Expose a high-level helper:
  - `game.getTrafficLightStatus(intersectionId)` → `{ intersectionId, currentPhaseId, nextPhaseId, timeRemainingSeconds, areAmberLightsShowing, laneStates: Record<number, "green" | "amber" | "red">, carsPassedThrough } | null`.
