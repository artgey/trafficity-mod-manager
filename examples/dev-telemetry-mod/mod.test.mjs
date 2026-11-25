import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import setupDevTelemetry, { buildSatisfactionSection, formatPercent, formatVelocity, pickSatisfactionColor } from "./mod.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("dev-telemetry manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf8"));
    assert.equal(manifest.id, "dev-telemetry");
    assert.equal(manifest.entry, "mod.js");
});

test("buildSatisfactionSection formats overall, factor rows, targets, velocities, and filters inactive factors", () => {
    assert.equal(pickSatisfactionColor(0.8), "#4ade80");
    assert.equal(pickSatisfactionColor(0.5), "#facc15");
    assert.equal(pickSatisfactionColor(0.2), "#f87171");
    assert.equal(formatPercent(0.729, 1), "72.9%");
    assert.equal(formatVelocity(0.031, 1), "▲3.1%");
    assert.equal(formatVelocity(-0.029, 1), "▼2.9%");

    const section = buildSatisfactionSection({
        overall: 0.729,
        factors: {
            airQuality: { current: 1, target: 1, velocity: 0 },
            commercial: { current: 0.717, target: 0.763, velocity: -0.03 },
            visitorAccess: { current: -1, target: -1, velocity: 0 },
        },
    });
    assert.ok(section);
    assert.equal(section.title, "Satisfaction Breakdown");
    assert.equal(section.rows.length, 3); // Overall + airQuality + commercial (visitorAccess skipped)
    assert.equal(section.rows[0].value, "72.9%");
    assert.equal(section.rows[2].target, "→76.3%");
    assert.equal(section.rows[2].delta, "▼3.0%");
});

test("setupDevTelemetry registers BuildingViewPanel section via game.getBuildingSatisfaction", () => {
    let provider = null;
    const mockGame = {
        addBuildingViewPanelSection: (fn) => {
            provider = fn;
            return () => {};
        },
        getBuildingSatisfaction: (id) => ({
            overall: id === 42 ? 0.85 : 0,
            factors: { airQuality: { current: 0.9, target: 1, velocity: 0.01 } },
        }),
    };
    const mockMods = {
        getConfig: (_id, d) => ({ ...d }),
    };
    setupDevTelemetry(mockMods, mockGame);
    assert.ok(provider);
    const out = provider({ building: { id: 42 }, saveState: {} });
    assert.equal(out.rows[0].value, "85.0%");
    assert.equal(out.rows[1].label, "Air Quality");
});
