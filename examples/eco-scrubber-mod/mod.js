const MOD_ID = "eco-scrubber";
const CYAN_RING_COLOR = 0x00e5ff;

export const STRENGTH_BY_LEVEL = Object.freeze({
  low: 0.55,
  medium: 0.65,
  high: 0.75,
});

const DEFAULTS = {
  quota: 3,
  scrub_radius: 225,
  scrub_strength: "medium",
  custom_scrub_strength: 0.65,
  scrub_falloff: 0,
  inner_radius_fraction: 0.5,
  falloff_curve: "linear",
};

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** Resolves effective per-tower scrub strength (0..1) from preset level or custom decimal. */
export const resolveScrubStrength = (cfg) => {
  const mode = String(cfg?.scrub_strength ?? DEFAULTS.scrub_strength).toLowerCase();
  if (mode in STRENGTH_BY_LEVEL) return STRENGTH_BY_LEVEL[mode];
  return clamp01(cfg?.custom_scrub_strength ?? DEFAULTS.custom_scrub_strength);
};

/** Computes attenuation multiplier (0..1) at `dist` inside `radius` for the configured falloff curve. */
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

/** Builds a concise <=2-line tooltip description reflecting active scrubber settings. */
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

/** Builds a 24-gon cylindrical extrusion ring in building-local coordinates. */
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

/** Procedural 2.5D terraced base + cylindrical purifier tower extrusions. */
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

/** Draws a cyan dashed radius ring matching Trafficity's vanilla pollution ring geometry. */
const createCyanDashedRing = (Graphics, cx, cy, radius, strokeWidth = 2) => {
  const g = new Graphics();
  const dashLen = 28;
  const gapLen = 18;
  const circumference = 2 * Math.PI * radius;
  let dist = 0;
  let draw = true;
  while (dist < circumference) {
    const next = Math.min(dist + (draw ? dashLen : gapLen), circumference);
    if (draw) {
      const a0 = dist / radius;
      const a1 = next / radius;
      const steps = Math.max(2, Math.ceil(((a1 - a0) * radius) / 6));
      for (let i = 0; i <= steps; i++) {
        const a = a0 + (i / steps) * (a1 - a0);
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    dist = next;
    draw = !draw;
  }
  g.stroke({ width: strokeWidth, color: CYAN_RING_COLOR, alpha: 0.85 });
  return g;
};

/**
 * Cleans air pollution ONLY inside Eco-Scrubber circles:
 * - Preserves polluting-building source cells so buildings still emit normally outside the radius.
 * - Sums effective mitigation across overlapping towers (`baseStrength * falloffFactor`).
 * - Clears cells whose pollution <= totalMitigation; higher pollution stays >= 0.42 (above full cutoff)
 *   until enough towers overlap.
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

  const polluterCenters = [];
  for (const b of allBuildings) {
    if (!b?.footprint || b.type === MOD_ID) continue;
    const def = typeof getDef === "function" ? getDef(b.type) : null;
    if (def && def.pollutionOutput !== "none") polluterCenters.push(b.footprint);
  }

  const r2 = radius * radius;
  const sourceProtectR2 = cellSize * cellSize;
  const count = typeof grid.getCellCount === "function" ? grid.getCellCount() : grid.pollutionValues.length;
  let cleanedCells = 0;

  for (let idx = 0; idx < count; idx++) {
    const val = grid.pollutionValues[idx];
    if (!(val > 0)) continue;

    const wx = (typeof grid.getCellXFromIndex === "function" ? grid.getCellXFromIndex(idx) : 0) * cellSize;
    const wy = (typeof grid.getCellYFromIndex === "function" ? grid.getCellYFromIndex(idx) : 0) * cellSize;

    let isPolluterSource = false;
    for (const p of polluterCenters) {
      const pdx = wx - p.centerX;
      const pdy = wy - p.centerY;
      if (pdx * pdx + pdy * pdy <= sourceProtectR2) {
        isPolluterSource = true;
        break;
      }
    }
    if (isPolluterSource) continue;

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

  let activeSaveState = null;

  const runScrub = (saveState) => {
    if (!saveState) return 0;
    const cellMod = game.requireRouterModule("d9GJQ");
    const defsMod = game.requireRouterModule("4nkf2");
    const cellSize = cellMod?.POLLUTION_CELL_SIZE || 40;
    return scrubPollutionAroundBuildings(saveState, scrubOpts, cellSize, defsMod?.getBuildingDefinition);
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
    onRenderWorld: (parts, building, gameState, pixi) => {
      activeSaveState = gameState.saveState;
      if (!pixi?.Graphics || !parts?.ground || parts.ground.destroyed) return;
      const isPreview = gameState.cursorMode?.mode === "building placement" &&
        gameState.cursorMode?.buildingDefinitionName === MOD_ID &&
        !gameState.saveState?.buildings?.[building.id];
      if (!isPreview) return;

      const zoomMod = game.requireRouterModule("cghJ1");
      const strokeWidth = zoomMod?.getZoomAwareStrokeWidth
        ? zoomMod.getZoomAwareStrokeWidth(gameState.saveState?.cameraZoom ?? 1)
        : 2;
      parts.ground.addChild(
        createCyanDashedRing(pixi.Graphics, building.footprint.centerX, building.footprint.centerY, scrubRadius, strokeWidth),
      );
    },
  });

  game.on("ready", () => {
    const difMod = game.requireRouterModule("gs8fX");
    if (difMod && typeof difMod.updatePollutionDiffusion === "function") {
      const origDiffuse = difMod.updatePollutionDiffusion;
      Object.defineProperty(difMod, "updatePollutionDiffusion", {
        value: (pollutionGrid) => {
          origDiffuse(pollutionGrid);
          const st = activeSaveState || globalThis.__trafficityGameState?.saveState;
          if (st) runScrub({ ...st, pollutionGrid });
        },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    const ringMod = game.requireRouterModule("eqevD");
    const gfxMod = game.requireRouterModule("3cebA");
    const zoomMod = game.requireRouterModule("cghJ1");
    if (ringMod && typeof ringMod.setBuildingPollutionRadiusSelectionGraphic === "function" && gfxMod?.Graphics) {
      const origSetRing = ringMod.setBuildingPollutionRadiusSelectionGraphic;
      Object.defineProperty(ringMod, "setBuildingPollutionRadiusSelectionGraphic", {
        value: (gameState, buildingId) => {
          activeSaveState = gameState.saveState;
          const b = gameState?.saveState?.buildings?.[buildingId];
          if (b?.type === MOD_ID) {
            const strokeWidth = zoomMod?.getZoomAwareStrokeWidth
              ? zoomMod.getZoomAwareStrokeWidth(gameState.saveState?.cameraZoom ?? 1)
              : 2;
            gameState.setWorldSelectionGraphic(
              createCyanDashedRing(gfxMod.Graphics, b.footprint.centerX, b.footprint.centerY, scrubRadius, strokeWidth),
            );
            return;
          }
          origSetRing(gameState, buildingId);
        },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    const tooltipMod = game.requireRouterModule("eAKuV");
    const jsxMod = game.requireRouterModule("ayMG0");
    if (tooltipMod && typeof tooltipMod.BuildingTypeTooltip === "function" && jsxMod?.jsx) {
      const origTooltip = tooltipMod.BuildingTypeTooltip;
      Object.defineProperty(tooltipMod, "BuildingTypeTooltip", {
        value: (props) => {
          const el = origTooltip(props);
          if (props?.buildingDefinition?.type !== MOD_ID || !el?.props) return el;
          const descLine = jsxMod.jsx("div", {
            className: "building-type-tooltip-line",
            style: { maxWidth: "220px", whiteSpace: "normal", lineHeight: "1.3", opacity: "0.85" },
            children: tooltipText,
          }, "eco-scrubber-desc");
          const prevChildren = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
          return { ...el, props: { ...el.props, children: [...prevChildren, descLine] } };
        },
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  });
}
