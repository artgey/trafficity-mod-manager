const MOD_ID = "eco-scrubber";
const CYAN_RING_COLOR = 0x00e5ff;

/** @type {Readonly<Record<string, number>>} */
export const STRENGTH_BY_LEVEL = Object.freeze({
  low: 0.55,
  medium: 0.65,
  high: 0.75,
});

const DEFAULTS = {
  quota: 3,
  scrub_radius: 450,
  scrub_strength: "medium",
  custom_scrub_strength: 0.65,
  scrub_falloff: 0,
  inner_radius_fraction: 0.5,
  falloff_curve: "linear",
};

/** @param {unknown} v */
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Resolves effective per-tower scrub strength (0..1) from preset level or custom decimal.
 * @param {Record<string, unknown> | undefined} cfg
 */
export const resolveScrubStrength = (cfg) => {
  const mode = String(cfg?.scrub_strength ?? DEFAULTS.scrub_strength).toLowerCase();
  if (mode in STRENGTH_BY_LEVEL) return STRENGTH_BY_LEVEL[mode];
  return clamp01(cfg?.custom_scrub_strength ?? DEFAULTS.custom_scrub_strength);
};

/**
 * Computes attenuation multiplier (0..1) at `dist` inside `radius` for the configured falloff curve.
 * @param {number} dist
 * @param {number} radius
 * @param {number} [falloff]
 * @param {number} [innerFraction]
 * @param {string} [curve]
 */
export const computeFalloffFactor = (dist, radius, falloff = 0, innerFraction = 0.5, curve = "linear") => {
  if (dist > radius) return 0;
  const f = clamp01(falloff);
  if (f <= 0) return 1;
  const innerR = radius * clamp01(innerFraction);
  if (dist <= innerR) return 1;

  const t = Math.min(1, (dist - innerR) / Math.max(1e-6, radius - innerR));
  if (curve === "quadratic") return Math.max(0, 1 - f * (t * t));
  if (curve === "exponential") return Math.max(0, 1 - f * ((Math.exp(3 * t) - 1) / (Math.exp(3) - 1)));
  if (curve === "step") return Math.max(0, 1 - f);
  return Math.max(0, 1 - f * t);
};

/**
 * Builds a concise <=2-line tooltip description reflecting active scrubber settings.
 * @param {Record<string, unknown> | undefined} cfg
 */
export const formatEcoScrubberTooltip = (cfg) => {
  const radius = Math.max(40, Number(cfg?.scrub_radius) || DEFAULTS.scrub_radius);
  const mode = String(cfg?.scrub_strength ?? DEFAULTS.scrub_strength).toLowerCase();
  const baseStrength = resolveScrubStrength(cfg);
  const falloff = clamp01(cfg?.scrub_falloff ?? 0);
  const curve = String(cfg?.falloff_curve ?? DEFAULTS.falloff_curve);

  const levelText = mode in STRENGTH_BY_LEVEL
    ? `${mode} pollution`
    : `up to ${baseStrength.toFixed(2)} pollution`;
  const overlapHint = baseStrength >= 0.75
    ? ""
    : " Overlap 2+ towers for high.";
  const falloffHint = falloff > 0 ? ` (${curve} falloff)` : "";
  return `Cleans ${levelText} in ${radius}u${falloffHint}.${overlapHint}`;
};

/**
 * Builds a 24-gon cylindrical extrusion ring in building-local coordinates.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} height
 * @param {number} [colorIndex]
 * @param {number} [roofDarkness]
 */
const circleExtrusion = (cx, cy, radius, height, colorIndex = 0, roofDarkness = 0) => {
  const points = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      height,
    });
  }
  return { points, roofDarkness, colorIndex };
};

/**
 * Procedural 2.5D terraced base + cylindrical purifier tower extrusions.
 * @param {number} width
 * @param {number} depth
 */
export const buildEcoScrubberExtrusions = (width, depth) => {
  const pad = 8;
  const topY = 22;
  const cx = width / 2;
  const cy = (topY + (depth - pad)) / 2;
  const outerR = Math.min(width - pad * 2, depth - topY - pad) * 0.44;
  return [
    {
      points: [
        { x: pad, y: topY, height: 14 },
        { x: pad, y: depth - pad, height: 14 },
        { x: width - pad, y: depth - pad, height: 14 },
        { x: width - pad, y: topY, height: 14 },
      ],
      roofDarkness: 0,
      colorIndex: 0,
    },
    circleExtrusion(cx, cy, outerR, 34, 1, 0),
    circleExtrusion(cx, cy, outerR * 0.56, 52, 2, 0.15),
  ];
};

/**
 * Cleans air pollution ONLY inside Eco-Scrubber circles:
 * - Preserves polluting-building source cells so buildings still emit normally outside the radius.
 * - Sums effective mitigation across overlapping towers (`baseStrength * falloffFactor`).
 * - Clears cells whose pollution <= totalMitigation; higher pollution stays >= 0.42 (above full cutoff)
 *   until enough towers overlap.
 * @param {TrafficitySaveState | null | undefined} saveState
 * @param {{ radius?: number, baseStrength?: number, falloff?: number, innerFraction?: number, curve?: string } | undefined} options
 * @param {number} [cellSize]
 * @param {((type: string) => TrafficityBuildingDefinition | null) | null} [getDef]
 */
export const scrubPollutionAroundBuildings = (saveState, options, cellSize = 40, getDef = null) => {
  const radius = options?.radius ?? DEFAULTS.scrub_radius;
  const baseStrength = options?.baseStrength ?? STRENGTH_BY_LEVEL.medium;
  const falloff = options?.falloff ?? 0;
  const innerFraction = options?.innerFraction ?? 0.5;
  const curve = options?.curve ?? "linear";

  const grid = saveState?.pollutionGrid;
  const buildings = saveState?.buildings;
  if (!grid?.pollutionValues || !buildings || !(radius > 0) || !(baseStrength > 0)) return 0;

  const allBuildings = Object.values(buildings);
  const scrubbers = allBuildings.filter((b) => b?.type === MOD_ID && b.footprint);
  if (scrubbers.length === 0) return 0;

  const polluterCellKeys = new Set();
  for (const b of allBuildings) {
    if (!b?.footprint || b.type === MOD_ID) continue;
    const def = typeof getDef === "function" ? getDef(b.type) : null;
    if (def && def.pollutionOutput !== "none") {
      const px = Math.floor(Math.round(b.footprint.centerX) / cellSize);
      const py = Math.floor(Math.round(b.footprint.centerY) / cellSize);
      polluterCellKeys.add(`${px},${py}`);
    }
  }

  const r2 = radius * radius;
  const count = typeof grid.getCellCount === "function" ? grid.getCellCount() : grid.pollutionValues.length;
  let cleanedCells = 0;

  for (let idx = 0; idx < count; idx++) {
    const val = grid.pollutionValues[idx];
    if (!(val > 0)) continue;

    const cx = typeof grid.getCellXFromIndex === "function" ? grid.getCellXFromIndex(idx) : 0;
    const cy = typeof grid.getCellYFromIndex === "function" ? grid.getCellYFromIndex(idx) : 0;
    if (polluterCellKeys.has(`${cx},${cy}`)) continue;

    const wx = (cx + 0.5) * cellSize;
    const wy = (cy + 0.5) * cellSize;

    let totalMitigation = 0;
    for (const scrubber of scrubbers) {
      const dx = wx - scrubber.footprint.centerX;
      const dy = wy - scrubber.footprint.centerY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        const factor = computeFalloffFactor(Math.sqrt(d2), radius, falloff, innerFraction, curve);
        totalMitigation += baseStrength * factor;
      }
    }
    if (!(totalMitigation > 0)) continue;

    // Keep insufficiently mitigated pollution above Trafficity's 0.40 full-cutoff until 2+ towers overlap
    const nextVal = totalMitigation >= val
      ? 0
      : Math.max(0.42, val - totalMitigation * 0.45);

    if (nextVal < val) {
      grid.pollutionValues[idx] = nextVal;
      cleanedCells++;
    }
  }
  return cleanedCells;
};

/**
 * Counts eco-scrubbers covering `building` and sums their falloff-weighted efficiency (`1x` per full tower).
 * @param {TrafficityBuildingRecord | null | undefined} building
 * @param {TrafficitySaveState | null | undefined} saveState
 * @param {{ radius?: number, falloff?: number, innerFraction?: number, curve?: string } | undefined} options
 * @returns {{ count: number, efficiency: number, formatted: string }}
 */
export const computeBuildingScrubStats = (building, saveState, options) => {
  const radius = options?.radius ?? DEFAULTS.scrub_radius;
  const falloff = options?.falloff ?? 0;
  const innerFraction = options?.innerFraction ?? 0.5;
  const curve = options?.curve ?? "linear";
  const fp = building?.footprint;
  const buildings = saveState?.buildings;
  if (!fp || !buildings || !(radius > 0)) return { count: 0, efficiency: 0, formatted: "0x" };

  const r2 = radius * radius;
  let count = 0;
  let efficiency = 0;
  for (const b of Object.values(buildings)) {
    if (!b || b.type !== MOD_ID || !b.footprint) continue;
    const dx = fp.centerX - b.footprint.centerX;
    const dy = fp.centerY - b.footprint.centerY;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) {
      const factor = computeFalloffFactor(Math.sqrt(d2), radius, falloff, innerFraction, curve);
      if (factor > 0) {
        count++;
        efficiency += factor;
      }
    }
  }
  const rounded = Number(efficiency.toFixed(1));
  return { count, efficiency: rounded, formatted: `${rounded}x` };
};

/**
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 */
export default function setupEcoScrubber(mods, game) {
  const cfg = mods.getConfig(MOD_ID, DEFAULTS);
  const quota = Math.max(0, Number(cfg.quota) || 0);
  const scrubRadius = Math.max(40, Number(cfg.scrub_radius) || DEFAULTS.scrub_radius);
  const scrubOpts = {
    radius: scrubRadius,
    baseStrength: resolveScrubStrength(cfg),
    falloff: clamp01(cfg.scrub_falloff ?? DEFAULTS.scrub_falloff),
    innerFraction: clamp01(cfg.inner_radius_fraction ?? DEFAULTS.inner_radius_fraction),
    curve: String(cfg.falloff_curve ?? DEFAULTS.falloff_curve),
  };
  const tooltipText = formatEcoScrubberTooltip(cfg);

  /** @type {TrafficitySaveState | null} */
  let activeSaveState = null;
  /** @type {TrafficityPixiGraphics | null} */
  let pollutionMapOverlay = null;
  /** @type {ReturnType<TrafficityGameFacade["createGridOverlaySprite"]>} */
  let cyanAuraOverlay = null;

  /** @param {TrafficitySaveState | null | undefined} saveState */
  const syncPollutionMapOverlay = (saveState) => {
    const gs = typeof game.getGameState === "function" ? game.getGameState() : null;
    const pollutionViz = gs?.layers?.pollutionViz;
    const buildings = saveState?.buildings;
    if (!pollutionViz || !buildings) return;

    const scrubbers = Object.values(buildings).filter((b) => b && b.type === MOD_ID && b.footprint);
    const grid = saveState?.pollutionGrid;
    const cellSize = game.getPollutionConfig().cellSize;
    const gw = typeof grid?.getGridWidth === "function" ? grid.getGridWidth() : 0;
    const gh = typeof grid?.getGridHeight === "function" ? grid.getGridHeight() : 0;
    const values = grid?.pollutionValues;

    if (
      gw > 0 &&
      gh > 0 &&
      values &&
      typeof game.createGridOverlaySprite === "function"
    ) {
      if (
        !cyanAuraOverlay ||
        cyanAuraOverlay.sprite?.destroyed ||
        cyanAuraOverlay.canvas.width !== gw ||
        cyanAuraOverlay.canvas.height !== gh
      ) {
        cyanAuraOverlay = game.createGridOverlaySprite(gw, gh, cellSize);
        if (cyanAuraOverlay) {
          pollutionViz.addChild(cyanAuraOverlay.sprite);
        }
      }
      if (cyanAuraOverlay) {
        const data = cyanAuraOverlay.imageData.data;
        data.fill(0);
        if (scrubbers.length > 0) {
          const r2 = scrubRadius * scrubRadius;
          /** @type {Map<number, number>} */
          const cellStrength = new Map();
          for (const b of scrubbers) {
            const minCx = Math.max(0, Math.floor((b.footprint.centerX - scrubRadius) / cellSize));
            const maxCx = Math.min(gw - 1, Math.ceil((b.footprint.centerX + scrubRadius) / cellSize));
            const minCy = Math.max(0, Math.floor((b.footprint.centerY - scrubRadius) / cellSize));
            const maxCy = Math.min(gh - 1, Math.ceil((b.footprint.centerY + scrubRadius) / cellSize));
            for (let cy = minCy; cy <= maxCy; cy++) {
              const wy = (cy + 0.5) * cellSize;
              for (let cx = minCx; cx <= maxCx; cx++) {
                const wx = (cx + 0.5) * cellSize;
                const dx = wx - b.footprint.centerX;
                const dy = wy - b.footprint.centerY;
                const d2 = dx * dx + dy * dy;
                if (d2 > r2) continue;
                const factor = computeFalloffFactor(Math.sqrt(d2), scrubRadius, scrubOpts.falloff, scrubOpts.innerFraction, scrubOpts.curve);
                if (!(factor > 0)) continue;
                const idx = cy * gw + cx;
                cellStrength.set(idx, (cellStrength.get(idx) || 0) + scrubOpts.baseStrength * factor);
              }
            }
          }

          for (const [idx, strength] of cellStrength) {
            const val = values[idx] ?? 0;
            if (val > 0.2) continue; // Red overlay is still active here; keep cyan transparent for clean diverging edge
            const net = strength - val;
            if (!(net > 0)) continue;
            const alpha = Math.min(0.48, 0.1 + (net / 1.3) * 0.38);
            const p = idx * 4;
            data[p] = 0;
            data[p + 1] = 229;
            data[p + 2] = 255;
            data[p + 3] = Math.round(alpha * 255);
          }
        }
        cyanAuraOverlay.update();
      }
    }

    if (typeof game.createGraphics === "function") {
      if (!pollutionMapOverlay || pollutionMapOverlay.destroyed) {
        pollutionMapOverlay = game.createGraphics();
        if (!pollutionMapOverlay) return;
        pollutionViz.addChild(pollutionMapOverlay);
      }
      pollutionMapOverlay.clear();
      for (const b of scrubbers) {
        pollutionMapOverlay
          .circle(b.footprint.centerX, b.footprint.centerY, scrubRadius)
          .stroke({ width: 3, color: CYAN_RING_COLOR, alpha: 0.75 });
      }
    }
  };

  /**
   * @param {TrafficitySaveState | null | undefined} saveState
   * @param {{ cellSize?: number, getBuildingDefinition?: (type: string) => TrafficityBuildingDefinition | null }} [ctx]
   */
  const runScrub = (saveState, ctx = {}) => {
    if (!saveState) return 0;
    const resolvedCellSize = ctx.cellSize || game.getPollutionConfig().cellSize;
    const resolvedGetDef = ctx.getBuildingDefinition || game.getBuildingDefinition;
    const cleaned = scrubPollutionAroundBuildings(saveState, scrubOpts, resolvedCellSize, resolvedGetDef);
    if (cleaned > 0 && typeof game.refreshPollutionOverlay === "function") {
      game.refreshPollutionOverlay();
    }
    syncPollutionMapOverlay(saveState);
    return cleaned;
  };

  mods.buildings.register({
    type: MOD_ID,
    name: "Eco-Scrubber Tower",
    buildingCategory: "office",
    buildingColors: ["#e6f4f1", "#2ec4b6", "#cbf3f0"],
    width: 100,
    depth: 90,
    parkingSpaces: [20, 50, 80],
    pollutionOutput: "none",
    pollutionAffectsHappiness: false,
    needsVisited: true,
    satisfactionWeight: 20,
    defaultQuota: quota,
    getExtrusions: buildEcoScrubberExtrusions,
    onPlace: (gameState) => {
      activeSaveState = gameState.saveState;
      runScrub(gameState.saveState);
    },
    onDelete: (gameState) => {
      activeSaveState = gameState.saveState;
      syncPollutionMapOverlay(gameState.saveState);
    },
    onRenderWorld: (parts, building, gameState) => {
      activeSaveState = gameState.saveState;
      if (!parts?.ground || parts.ground.destroyed) return;
      const isPreview = gameState.cursorMode?.mode === "building placement" &&
        gameState.cursorMode?.buildingDefinitionName === MOD_ID &&
        !gameState.saveState?.buildings?.[building.id];
      if (!isPreview) return;

      const ring = game.createDashedCircle(
        building.footprint.centerX,
        building.footprint.centerY,
        scrubRadius,
        {
          color: CYAN_RING_COLOR,
          strokeWidth: game.getZoomAwareStrokeWidth(gameState.saveState?.cameraZoom),
        },
      );
      if (ring) parts.ground.addChild(ring);
    },
  });

  game.setSelectionRadiusRing(MOD_ID, { radius: scrubRadius, color: CYAN_RING_COLOR, alpha: 0.85 });
  game.addBuildingTooltipLine(MOD_ID, tooltipText);
  if (typeof game.addBuildingViewPanelSection === "function") {
    game.addBuildingViewPanelSection(({ building, saveState }) => {
      if (building.type === MOD_ID) return null;
      const stats = computeBuildingScrubStats(building, saveState, scrubOpts);
      return {
        text: `Eco-Scrubbers: ${stats.count} (${stats.formatted})`,
        style: {
          marginTop: "6px",
          fontSize: "12px",
          lineHeight: "1.3",
          color: stats.count > 0 ? "#2ec4b6" : "#9aa0a6",
        },
      };
    });
  }
  game.onPollutionDiffusion((pollutionGrid, ctx) => {
    const st = ctx.saveState || activeSaveState;
    if (!st) return;
    runScrub(st, ctx);
  });
  if (typeof game.on === "function") {
    game.on("worldChange", () => {
      const gs = typeof game.getGameState === "function" ? game.getGameState() : null;
      if (gs?.saveState) syncPollutionMapOverlay(gs.saveState);
    });
  }
}
