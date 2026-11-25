# 07 — Pollution Propagation & Eco-Scrubber Containment Behavior

## Question Confirmed
**Yes — polluting buildings propagate pollution concentrically outward from their center cell.**

## Verified Game Mechanics (`Router.8fc9524d.js`)
- **Emission (`5x7Vi.updatePollutionFromBuildings`)**:
  - Runs every simulation tick.
  - Only raises the **single cell** at `(building.footprint.centerX, building.footprint.centerY)` to `MINIMUM_POLLUTION_BY_OUTPUT[output]` (`low: 0.55`, `medium: 0.65`, `high: 0.75`) via `Math.max`.
- **Diffusion (`gs8fX.updatePollutionDiffusion`)**:
  - Runs every 30 simulation ticks (unpaused).
  - For every cell `a`, propagates to neighbors within `dx, dy ∈ [-2..2]` (excluding corners `|dx|===2 && |dy|===2`), i.e., **at most 2 cells (`160u`) per diffusion step**:
    ```js
    u = c - cellDistance * dropOffRate
    o[h] = Math.max(o[h], u - r[h])
    ```
  - Decays each cell by `Math.min(c, 0.01)` per step.

## Why Eco-Scrubber Stops Outward Propagation Completely
In [`examples/eco-scrubber-mod/mod.js`](../../examples/eco-scrubber-mod/mod.js):
1. `scrubPollutionAroundBuildings` runs immediately after `updatePollutionDiffusion`.
2. It protects only the polluter's single center cell `(px, py)` and zeroes all surrounding cells within `450u` (`~5.6` cells) when `totalMitigation >= val`.
3. Because `gs8fX` only diffuses `<= 2` cells (`160u`) per step, any pollution that diffuses out of `(px, py)` into adjacent cells is immediately reset to `0` before the next diffusion step can carry it past the `450u` radius.
4. When the scrubber is removed, pollution resumes diffusing concentrically outward from `(px, py)` step by step.

## Design Options
- **Option A (True local-only scrubbing without blocking propagation)**: Let Trafficity's `pollutionGrid` diffuse normally into a shadow/unscrubbed buffer (or apply scrubbing only when sampling air quality & rendering the overlay), so factories still pollute outside the scrubber ring while the area inside the ring is clean.
- **Option B (Keep containment behavior)**: Treat placing a scrubber directly over a factory as a deliberate "containment dome" that traps emissions at the source, and document this clearly in the tooltip/README.
