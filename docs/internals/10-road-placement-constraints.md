# 10 — Road Placement Constraints Internals

## Core Constants (`bTgKI` — `ROAD_CONSTANTS`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `LANE_POINT_SPACING` | `3` | World units between consecutive lane points. |
| `LANE_WIDTH` | `20` | Width of a single road lane in world units. |
| `SIDEWALK_WIDTH` | `3` | Sidewalk border width. |
| `GIVE_WAY_SETBACK` | `1` | Give-way line setback. |
| `TRAFFIC_LIGHT_CIRCLE_OFFSET` | `8` | Traffic light indicator offset. |
| `MINIMUM_TURN_RADIUS` | `30` | Minimum allowed curve/turn radius (`30u`). |
| `MAX_CURVY_ROAD_ARC_LENGTH` | `4000` | Maximum arc length for a curved road segment (`4000u`). |
| `MINIMUM_RAMP_DISTANCE` | `20` | Minimum lane points per elevation level change (`20 * 3 = 60u` per level). |
| `DISCRETE_ROAD_ELEVATIONS` | `[0, 1, 2, 3]` | Allowed discrete road elevation tiers. |
| `MAX_DISCRETE_ROAD_ELEVATION` | `3` | Highest allowed road elevation tier. |
| `ELEVATION_SHADOW_DISTANCE` | `20` | Shadow offset per elevation level. |
| `MIN_JUNCTION_CHOP_DISTANCE` | `20` | Minimum chop-off distance (`ceil(20 / 3) = 7` points via `getMinJunctionChopOffPoints()`). |
| `INTERSECTION_PLACEMENT_COST` | `400` | Base cost for creating a signalized intersection. |
| `JUNCTION_PLACEMENT_COST` | `200` | Base cost for creating a junction. |

## Dynamic Distance Formulas (`bTgKI`)
- **Max Junction Chop-Off Distance**: `getMaxJunctionChopOffDistance(lanes) = (lanes === 1 ? 2.25 : 1.5) * LANE_WIDTH * lanes`
  - 1 lane = `45u` (`15` pts), 2 lanes = `60u` (`20` pts), 3 lanes = `90u` (`30` pts), 4 lanes = `120u` (`40` pts).
- **Max Midpoint Chord Target Distance**: `getMaxMidpointChordTargetDistanceFromChordLanes(lanes) = (lanes === 1 ? 3.75 : 2.5) * LANE_WIDTH * lanes`.

## Slope / Ramp Constraints (`dMMfs`)
- `isRampTooShort(startElev, endElev, pointCount)`:
  - `diff = Math.abs(endElev - startElev)`
  - Rejects when `diff !== 0 && pointCount < MINIMUM_RAMP_DISTANCE * diff` (`< 20` points / `< 60u` per elevation step).
- `constructionActionHasTooShortRamp(action)` checks every `"create lane section"` step in a draft construction action.

## Angle & Snap Constraints (`8w78C`, `h0N8S`, `dyInH`, `7HeVp`)
- `8w78C.MINIMUM_TURNING_APPROACH_ANGLE = 0.4 * Math.PI` (`72°`) for midpoint/turning road connections (`createRoadFromAbsoluteToMidpoint`, `createRoadFromMidpointToAbsolute`).
- `h0N8S`: `135°` (`135 * Math.PI / 180`) angle threshold for angled road-end connections.
- `dyInH`: Angle snapping presets at `±90°`, `30°`, `45°`, and `60°`.
- `7HeVp.connectDirectedPoints`: Solves smooth directed paths between `(x1, y1, a1)` and `(x2, y2, a2)` subject to `MINIMUM_TURN_RADIUS`.

## Glue-Along, Overlap & Traffic-Light Arm Constraints (`h0N8S`, `E71eU`, `aIdtw`, `WppSZ`)
1. **Endpoint Direction Guards (`h0N8S`)**:
   - Start point cannot be `"snapped road end in"`; end point cannot be `"snapped road end out"`.
2. **Overlap Detection & Recovery (`WppSZ`, `gSON2`, `E71eU`)**:
   - `WppSZ.getConstructionOverlaps(gameState, action)` detects intersections with existing lanes.
   - If overlaps exist, `gSON2.tryEarlyGlueAlongRecovery` and `gSON2.tryPromoteEndOnlyGlueToGlueAlong` attempt to convert the draft into a glued-along road (`E71eU.createRoadGluedAlong`).
   - If lanes cannot be added to an existing junction/intersection, `E71eU` marks lane steps `isProhibited: true` with `deniedWhy: "Couldn't add lane to junction"`.
3. **Traffic-Light Arm Chop Guard (`aIdtw`)**:
   - `draftChopExhaustsTrafficLightArm(gameState, action)` prevents chopping a lane section so close to an intersection that its traffic-light arm has no remaining points.

## Standard Rejection Reason Keys (`bTgKI`)
- `CANT_CREATE_ROAD_WHY` (`placement.road.cannotCreateRoad`)
- `CANT_CREATE_JUNCTION_WHY` (`placement.road.cantCreateJunction`)
- `CANNOT_CREATE_JUNCTION_WHY` (`placement.road.cannotCreateJunction`)
- `CANT_CREATE_ROUNDABOUT_WHY` (`placement.road.cantCreateRoundabout`)
- `ANGLED_ROADS_TOO_DIFFICULT_WHY` (`"angled roads too difficult to connect"`)
