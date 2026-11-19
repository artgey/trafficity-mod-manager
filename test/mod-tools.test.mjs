import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { forkMod, getModSettings, packModZip, saveModSettings, scaffoldMod } from "../src/mod-tools.mjs";
import { extractZipBuffer } from "../src/registry.mjs";

const require = createRequire(import.meta.url);
const { extractConfigValues, extractSettingsSchema, updateTomlValues } = require("../src/toml.cjs");

test("toml.cjs parses flat and sectioned settings.toml and updates values preserving comments", () => {
    const raw = [
        "# Comment stays",
        'greeting = "hi"',
        "",
        "[showBanner]",
        'label = "Show Banner"',
        'type = "boolean"',
        "value = true",
        "",
        "[gridSize]",
        'label = "Grid Size"',
        'type = "number"',
        "value = 3",
        "",
    ].join("\n");

    const schema = extractSettingsSchema(raw);
    assert.equal(schema.length, 3);
    assert.deepEqual(extractConfigValues(raw), {
        greeting: "hi",
        showBanner: true,
        gridSize: 3,
    });

    const updated = updateTomlValues(raw, { showBanner: false, gridSize: 10 });
    assert.match(updated, /^# Comment stays/m);
    assert.deepEqual(extractConfigValues(updated), {
        greeting: "hi",
        showBanner: false,
        gridSize: 10,
    });
});

test("scaffoldMod, settings.toml round-trip, and packModZip work end-to-end", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-tools-test-"));
    const modsDir = path.join(tmp, "mods");

    try {
        const res = await scaffoldMod({
            id: "Cool Test Mod!",
            name: "Cool Test Mod",
            author: "Tester",
            description: "Scaffolded in test",
            targetDir: modsDir,
        });
        assert.equal(res.id, "cool-test-mod");
        assert.equal(fs.existsSync(path.join(res.dir, "mod.json")), true);
        assert.equal(fs.existsSync(path.join(res.dir, "mod.js")), true);
        assert.equal(fs.existsSync(path.join(res.dir, "style.css")), true);
        assert.equal(fs.existsSync(path.join(res.dir, "settings.toml")), true);
        assert.equal(fs.existsSync(path.join(res.dir, "types.d.ts")), true);
        assert.equal(fs.existsSync(path.join(modsDir, "jsconfig.json")), true);
        assert.equal(fs.existsSync(path.join(modsDir, ".tmod-types", "trafficity-mods.d.ts")), true);

        // Save settings.toml via mod-tools
        await saveModSettings(res.dir, { showBanner: false, hotkeyLabel: "Custom" });
        const loaded = await getModSettings(res.dir);
        assert.equal(loaded.hasSettings, true);
        assert.equal(loaded.values.showBanner, false);
        assert.equal(loaded.values.hotkeyLabel, "Custom");

        // Add a test file that should be excluded from ZIP
        await fsp.writeFile(path.join(res.dir, "mod.test.mjs"), "export {};\n");
        const packed = await packModZip(res.dir);
        assert.equal(fs.existsSync(packed.zipPath), true);

        const zipBuf = await fsp.readFile(packed.zipPath);
        const expectedSha = crypto.createHash("sha256").update(zipBuf).digest("hex");
        assert.equal(packed.sha256, expectedSha);

        const unpackedDir = path.join(tmp, "unpacked");
        const extracted = await extractZipBuffer(zipBuf, unpackedDir);
        assert.equal(extracted.includes("mod.json"), true);
        assert.equal(extracted.includes("settings.toml"), true);
        assert.equal(extracted.includes("mod.test.mjs"), false);

        // Single-hop and multi-hop fork with lineage traceback
        const fork1 = await forkMod({
            sourceDir: res.dir,
            newName: "Cool Fork 1",
            newAuthor: "Forker",
            targetDir: modsDir,
        });
        assert.equal(fork1.id, "cool-test-mod-fork");
        assert.equal(fork1.forkedFrom.id, "cool-test-mod");
        assert.equal(fork1.forkedFrom.name, "Cool Test Mod");
        assert.equal(fork1.lineage.length, 1);
        assert.equal(fs.existsSync(path.join(fork1.dir, ".tmod-origin.json")), true);

        const fork2 = await forkMod({
            sourceDir: fork1.dir,
            newName: "Cool Fork 2",
            newAuthor: "Forker2",
            targetDir: modsDir,
        });
        assert.equal(fork2.id, "cool-test-mod-fork-fork");
        assert.equal(fork2.forkedFrom.id, "cool-test-mod-fork");
        assert.equal(fork2.lineage.length, 2);
        assert.equal(fork2.lineage[0].id, "cool-test-mod");
        assert.equal(fork2.lineage[1].id, "cool-test-mod-fork");

        const packedFork2 = await packModZip(fork2.dir);
        assert.equal(packedFork2.registryEntry.forkedFrom.id, "cool-test-mod-fork");
        assert.equal(packedFork2.registryEntry.lineage.length, 2);
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});
