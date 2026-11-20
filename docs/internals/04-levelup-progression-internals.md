# Trafficity Level-Up & Development Pack Progression — Technical Internals

Trafficity's city level-up system is driven by **Development Packs** (`a3oY4`, `aigC5`, `9colC`, `bCcpU`, `jgEEo`), split into two phases:
1. **Eligibility Check (`setPendingDevelopmentPackUnlockIfEligible`)** — runs every simulation tick in `Router.89d029ab.js`.
2. **Claiming & Effects (`claimPendingDevelopmentPackUnlock` + `onOk` handler)** — runs when the player clicks the Unlock Level button in `TopRightCityLevelObjectives` (`bCcpU`).

---

## 1. Key Parcel Modules & Exports

| Module | Exports | Role |
| :--- | :--- | :--- |
| `aigC5` | `setPendingDevelopmentPackUnlockIfEligible`, `claimPendingDevelopmentPackUnlock`, `getPendingDevelopmentPack`, `getDevelopmentPackUnlockRequirementLabels`, `getDevelopmentPackUnlockRequirementLines`, `getTileUnlocksForPack`, `getStartingBonusTileUnlocks`, `updateCumulativeBuildingCount`, `getSatisfactionFractionForSaveState`, `getSatisfactionRequiredForSaveState`, `getMaxUnlockedSatisfactionWeightForSaveState`, `shouldUseEarlyMetricPlaceholders` | Core level-up eligibility evaluator, objective progress calculator, and level-up reward applier. |
| `a3oY4` | `SCENARIOS`, `getResidentCarCountForPackBuildings` | Defines `"basic-scenario"` and its `developmentPackGetter(packNumber, terrainType)`, which generates `{ number, title, buildings, ... }` per level and terrain (`Island`, `Desert`, `Alpine`, `Fjords`). |
| `9colC` | `DIFFICULTY_MODES` (`"chill"`, `"normal"`, `"expert"`), `shouldUnlockWholeMap`, `hasUnlimitedMoney`, `getUnlockMetricThresholdPercent`, `scaleBudgetForDifficulty` | Controls difficulty-dependent threshold percentages, unlimited money/tiles in `"chill"`, and road budget scaling per pack. |
| `jgEEo` | `getUnlockedBuildingsPlacementCounts`, `areAllUnlockedBuildingsPlaced`, `getRemainingBuildingsAllowedForPlacement` | Tracks whether all buildings unlocked so far have been placed (`saveState.cumulativeBuildingCount` vs `saveState.buildings`). |
| `bCcpU` | `TopRightCityLevelObjectives` | React HUD displaying the level objectives list and the Unlock button. |

---

## 2. Phase 1: Eligibility Trigger (`setPendingDevelopmentPackUnlockIfEligible`)

Called every simulation tick in `Router.89d029ab.js`:
```js
if (setPendingDevelopmentPackUnlockIfEligible(saveState, totalSatisfaction, trafficFlow.valuePercent)) {
  playUiSfx("cityLevelUnlockReady");
}
```

### Exact Checks Performed (`aigC5`)
1. Skips immediately (`return false`) if `saveState.pendingDevelopmentPackNumber !== null` (already pending claim) or no `developmentPackGetter` exists.
2. Computes target level `r = saveState.currentDevelopmentPack.number + 1`.
3. Evaluates:
   - **Journeys:** `saveState.completedJourneyCount >= journeysRequired` (when non-null).
   - **All buildings placed:** `areAllUnlockedBuildingsPlaced(saveState)` (`jgEEo`) must be `true`.
   - **First return trips:** `getResidentsAwaitingFirstTripCount(saveState) === 0` (`buQW4`, when `firstReturnTripsRequired` is `true`).
   - **Difficulty metric thresholds (`9colC.getUnlockMetricThresholdPercent`):**
     - `"chill"`: returns `null` (no satisfaction or traffic-flow percentage gate).
     - `"normal"`: `Math.max(85, 95 - (level - 1))` (`95%` at level 1, scaling down `1%` per level to `85%`).
     - `"expert"`: `Math.max(90, 95 - Math.floor((level - 1) / 5))` (`95%` down to `90%`).
     - When non-null: requires `!shouldUseEarlyMetricPlaceholders(saveState)` (`Object.keys(buildings).length >= EARLY_METRIC_PLACEHOLDER_MIN_BUILDINGS`), `totalSatisfaction >= satisfactionRequired` (`threshold / 100 * totalBuildingSatisfactionWeight`), AND `trafficFlow.valuePercent >= threshold`.
4. If all pass: sets **`saveState.pendingDevelopmentPackNumber = r`** and returns `true`.

---

## 3. Phase 2: Claiming & Level-Up Effects (`claimPendingDevelopmentPackUnlock`)

When the player clicks **"Unlock Level N"** in `TopRightCityLevelObjectives` (`bCcpU`), the `onOk` callback executes two steps:

### Step A: `aigC5.claimPendingDevelopmentPackUnlock(saveState, trafficFlow)`
1. Looks up `r = developmentPackGetter(saveState.pendingDevelopmentPackNumber)`.
2. Sets `saveState.currentDevelopmentPack = r`.
3. **Road Budget (`9colC`):** Unless `difficultyMode === "chill"`, adds:
   - Base: `$14,000` (level 1) or `$6,000` (level 2+) in `"normal"`; `$12,000` (level 1) or `$4,500` (level 2+) in `"expert"`.
   - Plus `+10%` per 5 levels above level 10 (`n + (n / 10) * Math.max(0, Math.ceil((level - 10) / 5))`).
4. **Building Unlocks:** Merges `r.buildings` (`[{ buildingType, quantity }]`) into `saveState.cumulativeBuildingCount`.
5. **Tile Unlocks:** Adds `getTileUnlocksForPack(r.number, difficultyMode)` to `saveState.tileUnlockCount` (in `"chill"` = `0` since whole map is unlocked; otherwise `1` tile every `2` packs from pack `2`, or every pack after pack `20` in `"normal"`).
6. Clears `saveState.pendingDevelopmentPackNumber = null`.
7. Snaps `trafficFlow.valuePercent` to `100 * getRawTrafficFlowStats(parallelResidentMetadata).rawFraction`, resets `trafficFlow.velocityPercentPerSecond = 0`, and sets `trafficFlow.hasSnappedAfterWarmup = true`.

### Step B: Post-Claim Side Effects in `Router` (`onOk` handler)
1. Calls `recordCityLevelProgress(terrainType, newLevel, difficultyMode)` -> persists highest level in `settings.json`, checks `findNewContentUnlock` (map/content unlocks), and plays `"cityLevelUnlockReady"` if new content unlocked.
2. Posts `{ type: "set current development pack", currentDevelopmentPack: r }` to every `carWorker`.

---

## 4. How Mods Can Hook or Modify Level-Up Triggers & Effects

Because `aigC5` and `9colC` use Parcel `configurable: true` property descriptors, mods can override them cleanly with `Object.defineProperty`:

1. **Listen for Level-Up Ready / Modify Eligibility (`aigC5.setPendingDevelopmentPackUnlockIfEligible`):**
   - Wrap `setPendingDevelopmentPackUnlockIfEligible(saveState, totalSatisfaction, flowPct)`.
   - When the original returns `true`, a level-up just became ready (`saveState.pendingDevelopmentPackNumber` is the newly unlocked level).
   - Return `false` (and reset `pendingDevelopmentPackNumber = null`) to delay/gate level-ups on custom conditions, or force `pendingDevelopmentPackNumber = current + 1` to trigger early.
2. **React to Claiming / Grant Custom Rewards (`aigC5.claimPendingDevelopmentPackUnlock`):**
   - Wrap `claimPendingDevelopmentPackUnlock(saveState, trafficFlow)`:
     - Run `orig(saveState, trafficFlow)`.
     - Read `saveState.currentDevelopmentPack.number` for the new City Level.
     - Grant bonus `saveState.money`, bonus `saveState.tileUnlockCount`, or add per-level quota for custom buildings in `saveState.cumulativeBuildingCount` (e.g. `+1` Eco-Scrubber every 2 City Levels!), then call `gameState.requestUiRefresh?.()`.
3. **Modify Pack Contents (`a3oY4.SCENARIOS`):**
   - `SCENARIOS` is a mutable array containing `"basic-scenario"`. Wrapping `scenario.developmentPackGetter` lets a mod inject custom buildings, alter building quantities, or customize pack titles per City Level and terrain!
   - *(Note: remember `2cbpn.getSatisfactionWeightForBuildingType` and `a3oY4.getResidentCarCountForPackBuildings` read `r.buildings` for satisfaction/resident projections — custom buildings included in packs must have weights/car counts registered via `TrafficityMods.buildings`.)*
4. **Modify Difficulty Curves (`9colC`):**
   - Override `getUnlockMetricThresholdPercent` or `scaleBudgetForDifficulty` via `Object.defineProperty` to rebalance satisfaction/traffic thresholds or budget rewards globally.
