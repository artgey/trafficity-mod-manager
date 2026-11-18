import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("arrow-pan-mod manifest is valid", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "mod.json"), "utf-8"));
    assert.equal(manifest.id, "arrow-pan-mod");
    assert.equal(typeof manifest.name, "string");
    assert.equal(manifest.entry, "mod.js");
});

test("arrow-pan-mod binds Space to game.cancel()", async () => {
    const bindings = new Map();
    let cancelCalls = 0;

    globalThis.window = {
        TrafficityMods: {
            bindKey: (combo, handler) => bindings.set(combo, handler),
            game: {
                cancel: () => {
                    cancelCalls += 1;
                },
            },
        },
    };

    try {
        await import(`./mod.js?t=${Date.now()}`);
        assert.equal(bindings.has("Space"), true);
        bindings.get("Space")();
        assert.equal(cancelCalls, 1);
    } finally {
        delete globalThis.window;
    }
});
