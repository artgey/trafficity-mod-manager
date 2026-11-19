import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { resolveDefaultModsDir } from "./patch.mjs";

export const DEFAULT_REGISTRY_URL =
    "https://raw.githubusercontent.com/dyri0n/trafficity-mod-manager/main/registry.json";

/**
 * Pure-Node ZIP extractor supporting Stored (method 0) and Deflate (method 8).
 * Validates entry paths to prevent directory traversal.
 */
export const extractZipBuffer = async (zipBuffer, destDir) => {
    const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
    // Find End of Central Directory (EOCD: 0x06054b50)
    let eocdOffset = -1;
    const minOffset = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minOffset; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset === -1) {
        throw new Error("Invalid ZIP archive: EOCD signature not found");
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const baseDest = path.resolve(destDir);
    await fsp.mkdir(baseDest, { recursive: true });

    let ptr = cdOffset;
    const extractedFiles = [];

    for (let idx = 0; idx < totalEntries; idx++) {
        if (buf.readUInt32LE(ptr) !== 0x02014b50) {
            throw new Error("Invalid ZIP archive: bad central directory header");
        }
        const method = buf.readUInt16LE(ptr + 10);
        const compressedSize = buf.readUInt32LE(ptr + 20);
        const nameLen = buf.readUInt16LE(ptr + 28);
        const extraLen = buf.readUInt16LE(ptr + 30);
        const commentLen = buf.readUInt16LE(ptr + 32);
        const localHeaderOffset = buf.readUInt32LE(ptr + 42);
        const entryName = buf.toString("utf-8", ptr + 46, ptr + 46 + nameLen);
        ptr += 46 + nameLen + extraLen + commentLen;

        const cleanName = entryName.replace(/\\/g, "/");
        if (!cleanName || cleanName.endsWith("/")) {
            continue;
        }

        const outPath = path.resolve(baseDest, cleanName);
        if (outPath !== baseDest && !outPath.startsWith(baseDest + path.sep)) {
            throw new Error(`Blocked unsafe ZIP entry path: ${entryName}`);
        }

        if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Invalid ZIP local header for ${entryName}`);
        }
        const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressed = buf.subarray(dataStart, dataStart + compressedSize);

        let content;
        if (method === 0) {
            content = compressed;
        } else if (method === 8) {
            content = zlib.inflateRawSync(compressed);
        } else {
            throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`);
        }

        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.writeFile(outPath, content);
        extractedFiles.push(cleanName);
    }

    return extractedFiles;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_REGISTRY_PATH = path.join(REPO_ROOT, "registry.json");
const BASE_TYPES_PATH = path.join(REPO_ROOT, "types", "trafficity-mods.d.ts");

export const walkModFiles = async (modDir, { excludeNames = [], excludeExts = [] } = {}) => {
    const files = [];
    const skipNames = new Set(["node_modules", ...excludeNames]);
    const walk = async (rel = "") => {
        const abs = rel ? path.join(modDir, rel) : modDir;
        const entries = await fsp.readdir(abs, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.name.startsWith(".") || skipNames.has(entry.name)) continue;
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(childRel);
            } else if (!excludeExts.some((ext) => entry.name.endsWith(ext))) {
                files.push(childRel);
            }
        }
    };
    await walk();
    return files.sort();
};

export const computeModCodeHash = async (modDir) => {
    const files = await walkModFiles(modDir, { excludeNames: ["settings.toml"], excludeExts: [".test.mjs", ".zip"] });
    const hash = crypto.createHash("sha256");
    for (const rel of files) {
        hash.update(rel);
        hash.update("\0");
        hash.update(await fsp.readFile(path.join(modDir, rel)));
        hash.update("\0");
    }
    return hash.digest("hex");
};

export const ensureModsWorkspaceTypes = async (modsDir = resolveDefaultModsDir()) => {
    await fsp.mkdir(modsDir, { recursive: true });
    if (fs.existsSync(BASE_TYPES_PATH)) {
        const typesDir = path.join(modsDir, ".tmod-types");
        await fsp.mkdir(typesDir, { recursive: true });
        await fsp.copyFile(BASE_TYPES_PATH, path.join(typesDir, "trafficity-mods.d.ts"));
    }
    const jsconfigPath = path.join(modsDir, "jsconfig.json");
    if (!fs.existsSync(jsconfigPath)) {
        await fsp.writeFile(
            jsconfigPath,
            JSON.stringify(
                {
                    compilerOptions: {
                        target: "ES2022",
                        module: "ESNext",
                        moduleResolution: "bundler",
                        moduleDetection: "force",
                        allowJs: true,
                        checkJs: false,
                    },
                    include: ["**/*.js", "**/*.mjs", "**/*.d.ts", ".tmod-types/**/*.d.ts"],
                },
                null,
                2,
            ) + "\n",
        );
    }
};

export const fetchRegistry = async (registryUrl = process.env.TRAFFICITY_REGISTRY_URL || DEFAULT_REGISTRY_URL) => {
    let data;
    try {
        const res = await fetch(registryUrl);
        if (!res.ok) {
            throw new Error(`Failed to fetch registry (${res.status}): ${registryUrl}`);
        }
        data = await res.json();
    } catch (err) {
        if (registryUrl === DEFAULT_REGISTRY_URL && fs.existsSync(LOCAL_REGISTRY_PATH)) {
            data = JSON.parse(await fsp.readFile(LOCAL_REGISTRY_PATH, "utf8"));
        } else {
            throw err;
        }
    }
    if (!Array.isArray(data)) {
        throw new Error("Registry JSON must be an array of mod entries");
    }
    return data;
};

export const installModFromZip = async ({ downloadUrl, sha256 = null, id = null, modsDir = resolveDefaultModsDir() }) => {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
        throw new Error(`Failed to download mod (${res.status}): ${downloadUrl}`);
    }
    const zipBuffer = Buffer.from(await res.arrayBuffer());

    if (sha256) {
        const actual = crypto.createHash("sha256").update(zipBuffer).digest("hex");
        if (actual.toLowerCase() !== sha256.toLowerCase()) {
            throw new Error(`SHA-256 mismatch: expected ${sha256}, got ${actual}`);
        }
    }

    const tempDir = path.join(modsDir, `.tmp-install-${Date.now()}`);
    try {
        await extractZipBuffer(zipBuffer, tempDir);

        // Support both flat zip (mod.json at root) and single-folder zip (<folder>/mod.json)
        let modRoot = tempDir;
        if (!fs.existsSync(path.join(tempDir, "mod.json"))) {
            const entries = await fsp.readdir(tempDir, { withFileTypes: true });
            const subDirs = entries.filter((e) => e.isDirectory());
            if (subDirs.length === 1 && fs.existsSync(path.join(tempDir, subDirs[0].name, "mod.json"))) {
                modRoot = path.join(tempDir, subDirs[0].name);
            } else {
                throw new Error("Downloaded ZIP does not contain a mod.json manifest");
            }
        }

        const manifest = JSON.parse(await fsp.readFile(path.join(modRoot, "mod.json"), "utf-8"));
        const manifestId = String(manifest.id || id || "mod").trim();
        const targetId = (id || manifest.id || "mod").replace(/[^a-zA-Z0-9._-]/g, "-");
        const finalDir = path.join(modsDir, targetId);

        await fsp.mkdir(modsDir, { recursive: true });
        // Remove any existing folder in modsDir with the same mod id (e.g. *-mod vs *) to prevent duplicates
        for (const existing of await fsp.readdir(modsDir, { withFileTypes: true })) {
            if (!existing.isDirectory() || existing.name.startsWith(".tmp-install-")) continue;
            const existingManifestPath = path.join(modsDir, existing.name, "mod.json");
            if (!fs.existsSync(existingManifestPath)) continue;
            try {
                const existingManifest = JSON.parse(await fsp.readFile(existingManifestPath, "utf-8"));
                if (String(existingManifest.id || existing.name).trim() === manifestId) {
                    await fsp.rm(path.join(modsDir, existing.name), { recursive: true, force: true });
                }
            } catch {
                // ignore malformed manifest
            }
        }
        await fsp.rm(finalDir, { recursive: true, force: true });
        await fsp.cp(modRoot, finalDir, { recursive: true });
        const codeHash = await computeModCodeHash(finalDir);
        await fsp.writeFile(
            path.join(finalDir, ".tmod-origin.json"),
            JSON.stringify(
                {
                    source: "registry",
                    originalId: manifestId,
                    originalVersion: manifest.version || "1.0.0",
                    codeHash,
                },
                null,
                2,
            ) + "\n",
        );
        await ensureModsWorkspaceTypes(modsDir);

        return { id: targetId, dir: finalDir, manifest };
    } finally {
        await fsp.rm(tempDir, { recursive: true, force: true });
    }
};

export const installModByIdOrUrl = async (idOrUrl, options = {}) => {
    const modsDir = options.modsDir || resolveDefaultModsDir();
    if (/^https?:\/\//i.test(idOrUrl)) {
        return installModFromZip({ downloadUrl: idOrUrl, modsDir });
    }
    const registry = await fetchRegistry(options.registryUrl);
    const entry = registry.find((m) => m.id === idOrUrl);
    if (!entry) {
        throw new Error(`Mod '${idOrUrl}' not found in registry`);
    }
    if (!entry.downloadUrl) {
        throw new Error(`Mod '${idOrUrl}' has no downloadUrl in registry`);
    }
    return installModFromZip({
        downloadUrl: entry.downloadUrl,
        sha256: entry.sha256 || null,
        id: entry.id,
        modsDir,
    });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.includes("--list")) {
        const list = await fetchRegistry();
        console.log(JSON.stringify(list, null, 2));
    } else {
        const idx = args.indexOf("--install");
        const target = idx !== -1 ? args[idx + 1] : args[0];
        if (!target) {
            console.error("Usage: node src/registry.mjs --list | --install <mod-id-or-zip-url>");
            process.exit(1);
        }
        const installed = await installModByIdOrUrl(target);
        console.log(`Installed ${installed.id} to ${installed.dir}`);
    }
}
