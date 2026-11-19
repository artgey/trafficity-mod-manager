import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { createZipBuffer } from "../src/mod-tools.mjs";
import { extractZipBuffer, installModByIdOrUrl } from "../src/registry.mjs";

const buildTestZip = (entries) => {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const { name, data, deflate = false } of entries) {
        const nameBuf = Buffer.from(name, "utf-8");
        const rawBuf = Buffer.from(data, "utf-8");
        const payload = deflate ? zlib.deflateRawSync(rawBuf) : rawBuf;
        const method = deflate ? 8 : 0;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(rawBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);

        localChunks.push(local, nameBuf, payload);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(rawBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);

        centralChunks.push(central, nameBuf);
        offset += local.length + nameBuf.length + payload.length;
    }

    const centralBuf = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localChunks, centralBuf, eocd]);
};

test("extractZipBuffer blocks path traversal entries", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-zip-sec-"));
    try {
        const badZip = buildTestZip([{ name: "../../evil.txt", data: "nope" }]);
        await assert.rejects(() => extractZipBuffer(badZip, tmp), /Blocked unsafe ZIP entry path/);
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("installModByIdOrUrl fetches registry, verifies sha256, and installs deflated ZIP mod", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-reg-test-"));
    const modsDir = path.join(tmp, "mods");

    const zipBuf = buildTestZip([
        {
            name: "sample-mod/mod.json",
            data: JSON.stringify({ id: "sample-mod", name: "Sample Mod", version: "1.0.0", entry: "mod.js" }),
            deflate: true,
        },
        {
            name: "sample-mod/mod.js",
            data: "console.log('hi');",
            deflate: true,
        },
    ]);
    const sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");

    let baseUrl = "";
    const server = http.createServer((req, res) => {
        if (req.url === "/registry.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(
                JSON.stringify([
                    {
                        id: "sample-mod",
                        name: "Sample Mod",
                        version: "1.0.0",
                        downloadUrl: `${baseUrl}/sample-mod.zip`,
                        sha256,
                    },
                ]),
            );
            return;
        }
        if (req.url === "/sample-mod.zip") {
            res.setHeader("Content-Type", "application/zip");
            res.end(zipBuf);
            return;
        }
        res.statusCode = 404;
        res.end("not found");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        // Seed an existing differently-named folder with the same mod.json id
        await fsp.mkdir(path.join(modsDir, "sample-mod-old-folder"), { recursive: true });
        await fsp.writeFile(
            path.join(modsDir, "sample-mod-old-folder", "mod.json"),
            JSON.stringify({ id: "sample-mod", name: "Sample Mod" }),
        );

        const result = await installModByIdOrUrl("sample-mod", {
            registryUrl: `${baseUrl}/registry.json`,
            modsDir,
        });
        assert.equal(result.id, "sample-mod");
        assert.equal(fs.existsSync(path.join(modsDir, "sample-mod-old-folder")), false);
        assert.equal(fs.existsSync(path.join(modsDir, "sample-mod", "mod.json")), true);
        assert.equal(fs.readFileSync(path.join(modsDir, "sample-mod", "mod.js"), "utf-8"), "console.log('hi');");
        assert.equal(fs.existsSync(path.join(modsDir, "jsconfig.json")), true);
        assert.equal(fs.existsSync(path.join(modsDir, ".tmod-types", "trafficity-mods.d.ts")), true);
    } finally {
        server.close();
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});

test("extractZipBuffer and installModByIdOrUrl reject corrupt ZIPs, sha256 mismatches, missing manifests, and HTTP errors", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmod-reg-adv-"));
    const modsDir = path.join(tmp, "mods");
    await fsp.mkdir(modsDir, { recursive: true });

    await assert.rejects(() => extractZipBuffer(Buffer.from("not a zip"), modsDir), /Invalid ZIP/i);

    const noManifestZip = createZipBuffer([{ name: "mod.js", data: "console.log(1);" }]);
    const validZip = createZipBuffer([
        { name: "mod.json", data: JSON.stringify({ id: "bad-sha", name: "Bad SHA" }) },
        { name: "mod.js", data: "console.log(1);" },
    ]);

    let baseUrl = "";
    const server = http.createServer((req, res) => {
        if (req.url === "/registry.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(
                JSON.stringify([
                    { id: "bad-sha", name: "Bad SHA", downloadUrl: `${baseUrl}/valid.zip`, sha256: "0".repeat(64) },
                    { id: "no-manifest", name: "No Manifest", downloadUrl: `${baseUrl}/nomanifest.zip` },
                    { id: "missing-zip", name: "Missing", downloadUrl: `${baseUrl}/missing.zip` },
                ]),
            );
            return;
        }
        if (req.url === "/valid.zip") {
            res.end(validZip);
            return;
        }
        if (req.url === "/nomanifest.zip") {
            res.end(noManifestZip);
            return;
        }
        res.statusCode = 404;
        res.end("not found");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await assert.rejects(
            () => installModByIdOrUrl("bad-sha", { registryUrl: `${baseUrl}/registry.json`, modsDir }),
            /SHA-256 mismatch/i,
        );
        await assert.rejects(
            () => installModByIdOrUrl("no-manifest", { registryUrl: `${baseUrl}/registry.json`, modsDir }),
            /does not contain a mod\.json/i,
        );
        await assert.rejects(
            () => installModByIdOrUrl("missing-zip", { registryUrl: `${baseUrl}/registry.json`, modsDir }),
            /404/,
        );

        const entries = await fsp.readdir(modsDir);
        assert.deepEqual(entries, []);
    } finally {
        server.close();
        await fsp.rm(tmp, { recursive: true, force: true });
    }
});
