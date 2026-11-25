const MOD_ID = "dev-telemetry";

const DEFAULTS = {
    show_targets: true,
    show_velocity: true,
    show_inactive_factors: false,
    decimals: 1,
};

/** @type {Record<string, string>} */
const FACTOR_LABELS = {
    airQuality: "Air Quality",
    quietness: "Quietness",
    commercial: "Commercial",
    industrial: "Industrial",
    acrossMap: "Across Map",
    visitorAccess: "Visitor Access",
};

/**
 * Picks a green/amber/red accent color from a `0..1` satisfaction score.
 * @param {number} ratio
 * @returns {string}
 */
export const pickSatisfactionColor = (ratio) => {
    if (ratio >= 0.75) return "#4ade80";
    if (ratio >= 0.45) return "#facc15";
    return "#f87171";
};

/**
 * Formats a `0..1` satisfaction ratio as a percentage string.
 * @param {number} ratio
 * @param {number} decimals
 * @returns {string}
 */
export const formatPercent = (ratio, decimals = 1) => `${(ratio * 100).toFixed(decimals)}%`;

/**
 * Formats a per-second velocity (`0..1` scale) as a signed `▲`/`▼` percentage delta.
 * @param {number} velocity
 * @param {number} decimals
 * @returns {string}
 */
export const formatVelocity = (velocity, decimals = 1) => {
    const pct = velocity * 100;
    if (Math.abs(pct) < 0.05) return "0.0%/s";
    const arrow = pct > 0 ? "▲" : "▼";
    return `${arrow}${Math.abs(pct).toFixed(decimals)}%`;
};

/**
 * Builds structured `BuildingViewPanel` rows for a building's satisfaction breakdown.
 * @param {TrafficityBuildingSatisfactionReport | null} report
 * @param {{ show_targets?: boolean, show_velocity?: boolean, show_inactive_factors?: boolean, decimals?: number }} [cfg]
 * @returns {TrafficityBuildingViewPanelSection | null}
 */
export const buildSatisfactionSection = (report, cfg = DEFAULTS) => {
    if (!report) return null;
    const decimals = Math.max(0, Math.min(3, Number(cfg.decimals ?? DEFAULTS.decimals) || 0));
    const showTargets = cfg.show_targets !== false;
    const showVelocity = cfg.show_velocity !== false;
    const showInactive = Boolean(cfg.show_inactive_factors);

    /** @type {TrafficityBuildingViewPanelRow[]} */
    const rows = [];
    if (typeof report.overall === "number" && report.overall >= 0) {
        rows.push({
            label: "Overall",
            value: formatPercent(report.overall, decimals),
            progress: report.overall,
            color: pickSatisfactionColor(report.overall),
        });
    }

    for (const [key, factor] of Object.entries(report.factors || {})) {
        if (!factor || typeof factor.current !== "number") continue;
        if (!showInactive && factor.current < 0) continue;
        const clamped = Math.max(0, Math.min(1, factor.current));
        rows.push({
            label: FACTOR_LABELS[key] || key,
            value: factor.current < 0 ? "n/a" : formatPercent(clamped, decimals),
            ...(showTargets && factor.target >= 0 ? { target: `→${formatPercent(Math.max(0, Math.min(1, factor.target)), decimals)}` } : {}),
            ...(showVelocity && factor.current >= 0 ? { delta: formatVelocity(factor.velocity, decimals) } : {}),
            progress: factor.current < 0 ? 0 : clamped,
            color: factor.current < 0 ? "#94a3b8" : pickSatisfactionColor(clamped),
        });
    }

    if (rows.length === 0) return null;
    return {
        title: "Satisfaction Breakdown",
        rows,
    };
};

/**
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 */
export default function setupDevTelemetry(mods, game) {
    const cfg = mods.getConfig(MOD_ID, DEFAULTS);
    if (typeof game.addBuildingViewPanelSection !== "function" || typeof game.getBuildingSatisfaction !== "function") {
        return;
    }

    game.addBuildingViewPanelSection(({ building, saveState }) => {
        const report = game.getBuildingSatisfaction(building.id, saveState);
        return buildSatisfactionSection(report, cfg);
    });
}
