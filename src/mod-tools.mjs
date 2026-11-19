import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { resolveDefaultModsDir } from "./patch.mjs";
import { computeModCodeHash, ensureModsWorkspaceTypes, walkModFiles } from "./registry.mjs";

const require = createRequire(import.meta.url);
const { extractConfigValues, extractSettingsSchema, updateTomlValues } = require("./toml.cjs");

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Pure-Node Deflate ZIP writer for mod packaging.
 * @param {{ name: string, data: Buffer | string }[]} entries
 * @returns {Buffer}
 */
export const createZipBuffer = (entries) => {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
        const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
        const compressed = zlib.deflateRawSync(raw);
        const crc = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
        local.writeUInt16LE(8, 8); // Deflate
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);

        localParts.push(local, nameBuf, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);

        centralParts.push(central, nameBuf);
        offset += local.length + nameBuf.length + compressed.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralBuf, eocd]);
};

export const sanitizeModId = (raw) =>
    String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");

export const scaffoldMod = async ({
    id,
    name = "",
    author = "Trafficity Modder",
    description = "A custom Trafficity mod.",
    targetDir = resolveDefaultModsDir(),
    includeStyle = true,
    includeSettings = true,
    includeTypes = true,
    includeExample = true,
} = {}) => {
    const cleanId = sanitizeModId(id);
    if (!cleanId) {
        throw new Error("Mod id must contain at least one letter or digit");
    }

    const modDir = path.join(path.resolve(targetDir), cleanId);
    if (fs.existsSync(path.join(modDir, "mod.json"))) {
        throw new Error(`Mod '${cleanId}' already exists at ${modDir}`);
    }

    await fsp.mkdir(modDir, { recursive: true });
    const displayName = String(name || "").trim() || cleanId;
    const manifest = {
        id: cleanId,
        name: displayName,
        version: "1.0.0",
        author: String(author || "").trim() || "Trafficity Modder",
        description: String(description || "").trim() || "A custom Trafficity mod.",
        entry: "mod.js",
    };
    if (includeStyle) {
        manifest.styles = ["style.css"];
    }

    const createdFiles = [];
    await fsp.writeFile(path.join(modDir, "mod.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    createdFiles.push("mod.json");

    const codeLines = [
        `/**`,
        ` * @param {TrafficityModsApi} modApi`,
        ` * @param {TrafficityGameFacade} game`,
        ` */`,
        `export default function initializeMod(modApi, game) {`,
    ];
    if (includeSettings) {
        codeLines.push(
            `    const modConfig = modApi.getConfig("${cleanId}", { showBanner: true, hotkeyLabel: "${displayName.replace(/"/g, '\\"')}" });`,
        );
    }
    if (includeExample) {
        codeLines.push(
            ``,
            `    let isBannerVisible = ${includeSettings ? "modConfig.showBanner !== false" : "true"};`,
            `    const renderBanner = () => {`,
            `        const label = ${includeSettings ? "modConfig.hotkeyLabel || " : ""}"${displayName.replace(/"/g, '\\"')}";`,
            `        modApi.addOverlay("${cleanId}", isBannerVisible ? \`<div class="tmod-${cleanId}-badge">\${label}</div>\` : "");`,
            `    };`,
            `    game.on("ready", () => renderBanner());`,
            ``,
            `    modApi.bindKey("Alt+m", () => {`,
            `        isBannerVisible = !isBannerVisible;`,
            `        renderBanner();`,
            `        game.playSfx("placeRoad");`,
            `    });`,
        );
    } else {
        codeLines.push(`    console.log("[${cleanId}] Loaded.", { release: game.getGameRelease() });`);
    }
    codeLines.push(`}`, ``);
    await fsp.writeFile(path.join(modDir, "mod.js"), codeLines.join("\n"), "utf8");
    createdFiles.push("mod.js");

    if (includeStyle) {
        const css = `.tmod-${cleanId}-badge {\n    position: fixed;\n    left: 14px;\n    bottom: 14px;\n    padding: 6px 10px;\n    border-radius: 6px;\n    background: rgba(15, 23, 42, 0.88);\n    color: #f8fafc;\n    border: 1px solid rgba(255, 255, 255, 0.16);\n    font-family: system-ui, -apple-system, sans-serif;\n    font-size: 12px;\n    z-index: 999990;\n}\n`;
        await fsp.writeFile(path.join(modDir, "style.css"), css, "utf8");
        createdFiles.push("style.css");
    }

    if (includeSettings) {
        const toml = [
            `# Mod settings for ${displayName}`,
            `# Editable directly here, in the F9 in-game drawer, or in the Mod Manager UI.`,
            ``,
            `[showBanner]`,
            `label = "Show HUD Badge"`,
            `description = "Display the mod overlay badge on startup"`,
            `type = "boolean"`,
            `value = true`,
            ``,
            `[hotkeyLabel]`,
            `label = "Overlay Label"`,
            `type = "string"`,
            `value = "${displayName.replace(/"/g, '\\"')}"`,
            ``,
        ].join("\n");
        await fsp.writeFile(path.join(modDir, "settings.toml"), toml, "utf8");
        createdFiles.push("settings.toml");
    }

    if (includeTypes) {
        const dts = [
            `export {};`,
            ``,
            `declare global {`,
            `    interface TrafficityServices {`,
            `        // Register typed services if you call mods.provide("${cleanId}", ...)`,
            `    }`,
            `}`,
            ``,
        ].join("\n");
        await fsp.writeFile(path.join(modDir, "types.d.ts"), dts, "utf8");
        createdFiles.push("types.d.ts");
    }

    const codeHash = await computeModCodeHash(modDir);
    await fsp.writeFile(
        path.join(modDir, ".tmod-origin.json"),
        JSON.stringify({ source: "scaffold", originalId: cleanId, codeHash }, null, 2) + "\n",
        "utf8",
    );
    await ensureModsWorkspaceTypes(path.resolve(targetDir));
    return { ok: true, id: cleanId, dir: modDir, files: createdFiles, manifest };
};

const copyDirForFork = async (srcDir, dstDir) => {
    for (const rel of await walkModFiles(srcDir, { excludeExts: [".zip"] })) {
        const dstPath = path.join(dstDir, rel);
        await fsp.mkdir(path.dirname(dstPath), { recursive: true });
        await fsp.copyFile(path.join(srcDir, rel), dstPath);
    }
};

export const forkMod = async ({
    sourceDir,
    newId = "",
    newName = "",
    newAuthor = "Trafficity Modder",
    targetDir = resolveDefaultModsDir(),
} = {}) => {
    const resolvedTarget = path.resolve(targetDir);
    let resolvedSource = path.resolve(String(sourceDir || ""));
    if (!fs.existsSync(path.join(resolvedSource, "mod.json"))) {
        const candidate = path.join(resolvedTarget, String(sourceDir || ""));
        if (fs.existsSync(path.join(candidate, "mod.json"))) {
            resolvedSource = candidate;
        }
    }
    const origManifestPath = path.join(resolvedSource, "mod.json");
    if (!fs.existsSync(origManifestPath)) {
        throw new Error(`No mod.json found in source mod: ${sourceDir}`);
    }

    const orig = JSON.parse(await fsp.readFile(origManifestPath, "utf8"));
    const origId = sanitizeModId(orig.id || path.basename(resolvedSource)) || path.basename(resolvedSource);

    let finalId = sanitizeModId(newId);
    if (!finalId) {
        const baseForkId = `${origId}-fork`;
        finalId = baseForkId;
        let suffix = 2;
        while (fs.existsSync(path.join(resolvedTarget, finalId))) {
            finalId = `${baseForkId}-${suffix++}`;
        }
    }

    const destDir = path.join(resolvedTarget, finalId);
    if (fs.existsSync(path.join(destDir, "mod.json"))) {
        throw new Error(`Fork destination '${finalId}' already exists at ${destDir}`);
    }

    let downloadUrl = "";
    const originPath = path.join(resolvedSource, ".tmod-origin.json");
    if (fs.existsSync(originPath)) {
        try {
            const origin = JSON.parse(await fsp.readFile(originPath, "utf8"));
            if (typeof origin.downloadUrl === "string") downloadUrl = origin.downloadUrl;
        } catch {
            // ignore
        }
    }
    if (!downloadUrl) {
        const repoRegistry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "registry.json");
        if (fs.existsSync(repoRegistry)) {
            try {
                const entries = JSON.parse(await fsp.readFile(repoRegistry, "utf8"));
                const match = Array.isArray(entries) ? entries.find((e) => e && e.id === origId) : null;
                if (match && typeof match.downloadUrl === "string") downloadUrl = match.downloadUrl;
            } catch {
                // ignore
            }
        }
    }

    const origCodeHash = await computeModCodeHash(resolvedSource);
    const forkOrigin = {
        id: origId,
        name: typeof orig.name === "string" && orig.name ? orig.name : origId,
        version: typeof orig.version === "string" && orig.version ? orig.version : "1.0.0",
        ...(typeof orig.author === "string" && orig.author ? { author: orig.author } : {}),
        ...(downloadUrl ? { downloadUrl } : {}),
        codeHash: origCodeHash,
        forkedAt: new Date().toISOString(),
    };

    const prevLineage = Array.isArray(orig.lineage)
        ? orig.lineage
        : orig.forkedFrom && typeof orig.forkedFrom === "object"
          ? [orig.forkedFrom]
          : [];
    const lineage = [...prevLineage, forkOrigin];

    await copyDirForFork(resolvedSource, destDir);

    const nextManifest = {
        ...orig,
        id: finalId,
        name: String(newName || "").trim() || `${forkOrigin.name} (Fork)`,
        version: "1.0.0",
        author: String(newAuthor || "").trim() || "Trafficity Modder",
        forkedFrom: forkOrigin,
        lineage,
    };

    await fsp.writeFile(path.join(destDir, "mod.json"), JSON.stringify(nextManifest, null, 2) + "\n", "utf8");
    const forkCodeHash = await computeModCodeHash(destDir);
    await fsp.writeFile(
        path.join(destDir, ".tmod-origin.json"),
        JSON.stringify({ source: "fork", originalId: origId, codeHash: forkCodeHash }, null, 2) + "\n",
        "utf8",
    );
    await ensureModsWorkspaceTypes(resolvedTarget);

    return { ok: true, id: finalId, dir: destDir, forkedFrom: forkOrigin, lineage, manifest: nextManifest };
};

const collectModFiles = async (rootDir) => {
    const rels = await walkModFiles(rootDir, { excludeExts: [".test.mjs", ".zip"] });
    return Promise.all(rels.map(async (name) => ({ name, data: await fsp.readFile(path.join(rootDir, name)) })));
};

export const packModZip = async (modDir, outZipPath = null) => {
    const resolvedDir = path.resolve(modDir);
    const manifestPath = path.join(resolvedDir, "mod.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No mod.json found in ${resolvedDir}`);
    }
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    const id = sanitizeModId(manifest.id || path.basename(resolvedDir)) || path.basename(resolvedDir);
    const files = await collectModFiles(resolvedDir);
    if (files.length === 0) {
        throw new Error(`No packable files found in ${resolvedDir}`);
    }

    const zipBuffer = createZipBuffer(files);
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    const targetZip = outZipPath
        ? path.resolve(outZipPath)
        : path.join(path.dirname(resolvedDir), `${id}.zip`);
    await fsp.mkdir(path.dirname(targetZip), { recursive: true });
    await fsp.writeFile(targetZip, zipBuffer);

    const registryEntry = {
        id,
        name: manifest.name || id,
        version: manifest.version || "1.0.0",
        author: manifest.author || "",
        description: manifest.description || "",
        ...(Array.isArray(manifest.dependencies) && manifest.dependencies.length > 0
            ? { dependencies: manifest.dependencies }
            : {}),
        ...(Array.isArray(manifest.optionalDependencies) && manifest.optionalDependencies.length > 0
            ? { optionalDependencies: manifest.optionalDependencies }
            : {}),
        ...(manifest.forkedFrom && typeof manifest.forkedFrom === "object" ? { forkedFrom: manifest.forkedFrom } : {}),
        ...(Array.isArray(manifest.lineage) && manifest.lineage.length > 0 ? { lineage: manifest.lineage } : {}),
        downloadUrl: `https://github.com/<your-user>/<your-repo>/releases/latest/download/${path.basename(targetZip)}`,
        sha256,
    };

    return {
        ok: true,
        id,
        modDir: resolvedDir,
        zipPath: targetZip,
        sha256,
        fileCount: files.length,
        registryEntry,
    };
};

export const getModSettings = async (modDir) => {
    const settingsPath = path.join(path.resolve(modDir), "settings.toml");
    if (!fs.existsSync(settingsPath)) {
        return { ok: true, hasSettings: false, schema: [], values: {} };
    }
    const raw = await fsp.readFile(settingsPath, "utf8");
    return {
        ok: true,
        hasSettings: true,
        settingsPath,
        schema: extractSettingsSchema(raw),
        values: extractConfigValues(raw),
    };
};

export const saveModSettings = async (modDir, values) => {
    const settingsPath = path.join(path.resolve(modDir), "settings.toml");
    if (!fs.existsSync(settingsPath)) {
        throw new Error(`No settings.toml found in ${modDir}`);
    }
    const raw = await fsp.readFile(settingsPath, "utf8");
    const updated = updateTomlValues(raw, values);
    await fsp.writeFile(settingsPath, updated, "utf8");
    return {
        ok: true,
        settingsPath,
        schema: extractSettingsSchema(updated),
        values: extractConfigValues(updated),
    };
};

const parseFlags = (argv) => {
    const flags = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            flags._.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
            flags[key] = true;
        } else {
            flags[key] = next;
            i += 1;
        }
    }
    return flags;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const flags = parseFlags(process.argv.slice(2));
    try {
        if (flags.scaffold) {
            const id = typeof flags.scaffold === "string" ? flags.scaffold : flags.id || flags._[0];
            const res = await scaffoldMod({
                id,
                name: flags.name,
                author: flags.author,
                description: flags.description,
                targetDir: flags["target-dir"] || resolveDefaultModsDir(),
                includeStyle: flags["no-style"] ? false : true,
                includeSettings: flags["no-settings"] ? false : true,
                includeTypes: flags["no-types"] ? false : true,
                includeExample: flags["no-example"] ? false : true,
            });
            console.log(JSON.stringify(res, null, 2));
        } else if (flags.fork) {
            const sourceDir = typeof flags.fork === "string" ? flags.fork : flags._[0];
            const res = await forkMod({
                sourceDir,
                newId: typeof flags.id === "string" ? flags.id : "",
                newName: typeof flags.name === "string" ? flags.name : "",
                newAuthor: typeof flags.author === "string" ? flags.author : "Trafficity Modder",
                targetDir: flags["target-dir"] || resolveDefaultModsDir(),
            });
            console.log(JSON.stringify(res, null, 2));
        } else if (flags.pack) {
            const modDir = typeof flags.pack === "string" ? flags.pack : flags._[0];
            const outZip = typeof flags.out === "string" ? flags.out : null;
            const res = await packModZip(modDir, outZip);
            console.log(JSON.stringify(res, null, 2));
        } else if (flags["get-settings"]) {
            const modDir = typeof flags["get-settings"] === "string" ? flags["get-settings"] : flags._[0];
            console.log(JSON.stringify(await getModSettings(modDir), null, 2));
        } else if (flags["set-settings"]) {
            const modDir = typeof flags["set-settings"] === "string" ? flags["set-settings"] : flags._[0];
            const values = JSON.parse(String(flags.values || "{}"));
            console.log(JSON.stringify(await saveModSettings(modDir, values), null, 2));
        } else {
            console.error("Usage: node src/mod-tools.mjs --scaffold <id> | --pack <mod-dir> | --get-settings <mod-dir> | --set-settings <mod-dir> --values '<json>'");
            process.exitCode = 1;
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
