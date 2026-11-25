import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import setupEcoScrubber, {
  buildEcoScrubberExtrusions,
  computeBuildingScrubStats,
  computeFalloffFactor,
  formatEcoScrubberTooltip,
  resolveScrubStrength,
  scrubPollutionAroundBuildings,
} from "./mod.js";

const require = createRequire(import.meta.url);
const { extractSettingsSchema, extractConfigValues } = require("../../src/toml.cjs");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("eco-scrubber manifest and settings.toml schema are valid", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf8"));
  assert.equal(manifest.id, "eco-scrubber");
  assert.equal(manifest.entry, "mod.js");
  assert.equal(manifest.modloaderVersion, "1.4.2");

  const rawToml = fs.readFileSync(path.join(__dirname, "settings.toml"), "utf8");
  const schema = extractSettingsSchema(rawToml);
  const keys = schema.map((s) => s.key);
  assert.deepEqual(keys, [
    "quota",
    "scrub_radius",
    "scrub_strength",
    "custom_scrub_strength",
    "scrub_falloff",
    "inner_radius_fraction",
    "falloff_curve",
  ]);
  const vals = extractConfigValues(rawToml);
  assert.equal(vals.scrub_radius, 450);
  assert.equal(vals.scrub_strength, "medium");
  assert.equal(vals.scrub_falloff, 0);
});

test("resolveScrubStrength and computeFalloffFactor handle presets, custom decimals, and curves", () => {
  assert.equal(resolveScrubStrength({ scrub_strength: "low" }), 0.55);
  assert.equal(resolveScrubStrength({ scrub_strength: "medium" }), 0.65);
  assert.equal(resolveScrubStrength({ scrub_strength: "high" }), 0.75);
  assert.equal(resolveScrubStrength({ scrub_strength: "custom", custom_scrub_strength: 0.42 }), 0.42);

  assert.equal(computeFalloffFactor(200, 225, 0, 0.5, "linear"), 1);
  assert.equal(computeFalloffFactor(100, 225, 0.8, 0.5, "linear"), 1); // inside inner core (<= 112.5)
  assert.ok(computeFalloffFactor(168.75, 225, 1.0, 0.5, "quadratic") > computeFalloffFactor(168.75, 225, 1.0, 0.5, "linear"));
  assert.ok(Math.abs(computeFalloffFactor(200, 225, 0.6, 0.5, "step") - 0.4) < 1e-9);
});

test("buildEcoScrubberExtrusions generates terraced base and cylindrical purifier tiers", () => {
  const extrusions = buildEcoScrubberExtrusions(100, 90);
  assert.equal(extrusions.length, 3);
  assert.equal(extrusions[0].points.length, 4);
  assert.equal(extrusions[1].points.length, 24);
  assert.equal(extrusions[2].points.length, 24);
});

test("scrubPollutionAroundBuildings cleans low/medium in area, preserves polluter source, and requires two scrubbers for high", () => {
  // Cell 0 (80,80): medium 0.65 inside 1 scrubber -> cleared
  // Cell 1 (120,80): high 0.75 inside 1 scrubber -> stays >= 0.42
  // Cell 2 (200,80): high 0.75 inside 2 scrubbers -> cleared
  // Cell 3 (400,80): polluter source cell inside scrubber -> preserved
  // Cell 4 (2000,80): distant cell outside radius -> untouched
  const values = new Float32Array([0.65, 0.75, 0.75, 0.75, 0.75]);
  const saveState = {
    buildings: {
      1: { id: 1, type: "eco-scrubber", footprint: { centerX: 100, centerY: 80 } },
      2: { id: 2, type: "eco-scrubber", footprint: { centerX: 350, centerY: 80 } },
      3: { id: 3, type: "steel-mill", footprint: { centerX: 400, centerY: 80 } },
    },
    pollutionGrid: {
      pollutionValues: values,
      getCellCount: () => 5,
      getCellXFromIndex: (i) => [2, 1, 5, 10, 50][i],
      getCellYFromIndex: () => 2,
    },
  };
  const getDef = (t) => ({ pollutionOutput: t === "steel-mill" ? "high" : "none" });

  const cleaned = scrubPollutionAroundBuildings(
    saveState,
    { radius: 225, baseStrength: 0.65, falloff: 0, innerFraction: 0.5, curve: "linear" },
    40,
    getDef,
  );
  assert.equal(cleaned, 3);
  assert.equal(values[0], 0);
  assert.ok(values[1] >= 0.42, `high pollution with 1 scrubber should stay >= 0.42, got ${values[1]}`);
  assert.equal(values[2], 0);
  assert.equal(values[3], Math.fround(0.75));
  assert.equal(values[4], Math.fround(0.75));
});

test("computeBuildingScrubStats counts scrubbers and formats efficiency up to 1 decimal", () => {
  const saveState = {
    buildings: {
      1: { id: 1, type: "eco-scrubber", footprint: { centerX: 0, centerY: 0 } },
      2: { id: 2, type: "eco-scrubber", footprint: { centerX: 300, centerY: 0 } },
      3: { id: 3, type: "house", footprint: { centerX: 50, centerY: 0 } },
    },
  };
  assert.deepEqual(
    computeBuildingScrubStats(saveState.buildings[3], saveState, { radius: 450, falloff: 0 }),
    { count: 2, efficiency: 2, formatted: "2x" },
  );
  // With falloff 0.5, innerFraction 0.5, scrubber 1 (dist 50 <= 225) = 1.0, scrubber 2 (dist 250) = 1 - 0.5 * (25/225) ~= 0.94 -> 1.9x
  assert.deepEqual(
    computeBuildingScrubStats(saveState.buildings[3], saveState, { radius: 450, falloff: 0.5, innerFraction: 0.5, curve: "linear" }),
    { count: 2, efficiency: 1.9, formatted: "1.9x" },
  );
});

test("setupEcoScrubber registers building, cyan selection ring, dynamic tooltip, building view panel, and pollution diffusion handler", () => {
  let registered = null;
  let selectionRing = null;
  let tooltipEntry = null;
  let diffusionHandler = null;
  let panelProvider = null;

  const mods = {
    getConfig: (_id, d) => ({ ...d, quota: 4, scrub_falloff: 0.5, falloff_curve: "quadratic" }),
    buildings: { register: (cfg) => { registered = cfg; return cfg; } },
  };
  const st = {
    cameraZoom: 1,
    buildings: {
      1: { id: 1, type: "eco-scrubber", footprint: { centerX: 40, centerY: 40 } },
      2: { id: 2, type: "house", footprint: { centerX: 40, centerY: 40 } },
    },
    pollutionGrid: {
      pollutionValues: new Float32Array([0.65]),
      getCellCount: () => 1,
      getCellXFromIndex: () => 1,
      getCellYFromIndex: () => 1,
    },
  };
  const game = {
    setSelectionRadiusRing: (type, opts) => { selectionRing = { type, opts }; },
    addBuildingTooltipLine: (type, text) => { tooltipEntry = { type, text }; },
    addBuildingViewPanelSection: (fn) => { panelProvider = fn; return () => {}; },
    onPollutionDiffusion: (fn) => { diffusionHandler = fn; return () => {}; },
    getPollutionConfig: () => ({ cellSize: 40 }),
    getBuildingDefinition: () => ({ pollutionOutput: "none" }),
  };

  setupEcoScrubber(mods, game);
  assert.equal(registered.type, "eco-scrubber");
  assert.equal(registered.defaultQuota, 4);
  assert.equal(selectionRing.type, "eco-scrubber");
  assert.equal(selectionRing.opts.color, 0x00e5ff);
  assert.equal(tooltipEntry.type, "eco-scrubber");
  assert.match(tooltipEntry.text, /quadratic falloff/);
  assert.equal(panelProvider({ building: st.buildings[1], saveState: st }), null);
  assert.equal(panelProvider({ building: st.buildings[2], saveState: st }).text, "Eco-Scrubbers: 1 (1x)");

  diffusionHandler(st.pollutionGrid, {
    saveState: st,
    cellSize: 40,
    getBuildingDefinition: () => ({ pollutionOutput: "none" }),
  });
  assert.equal(st.pollutionGrid.pollutionValues[0], 0);
  assert.match(formatEcoScrubberTooltip({ scrub_radius: 450, scrub_strength: "medium", scrub_falloff: 0.5, falloff_curve: "quadratic" }), /quadratic falloff/);
});
