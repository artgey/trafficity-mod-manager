import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateSnippet, formatConsoleArgs, toJsonSafe } from "./mod.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("dev-bridge manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf8"));
    assert.equal(manifest.id, "dev-bridge");
    assert.equal(manifest.entry, "mod.js");
});

test("toJsonSafe handles circular objects, Errors, and TypedArrays", () => {
    const circular = { name: "root" };
    circular.self = circular;
    const safe = toJsonSafe({ circular, err: new Error("boom"), buf: new Float32Array(4) });
    assert.equal(safe.circular.self, "[Circular]");
    assert.equal(safe.err.message, "boom");
    assert.equal(safe.buf, "[Float32Array(4)]");
    assert.match(formatConsoleArgs(["hello", { a: 1 }]), /^hello \{"a":1\}$/);
});

test("evaluateSnippet evaluates expressions and async statements with mods & game", async () => {
    const mockGame = { getGameRelease: () => "trafficity@test" };
    const mockMods = { version: "1.4.3", game: mockGame };

    const expr = await evaluateSnippet("game.getGameRelease()", mockMods, mockGame);
    assert.deepEqual(expr, { ok: true, result: "trafficity@test" });

    const stmt = await evaluateSnippet("const v = mods.version; return v;", mockMods, mockGame);
    assert.deepEqual(stmt, { ok: true, result: "1.4.3" });

    const fail = await evaluateSnippet("throw new Error('bad')", mockMods, mockGame);
    assert.equal(fail.ok, false);
    assert.match(fail.error, /Error: bad/);
});
