import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const getDefaultModsDir = async () => (await import("./patch.mjs")).resolveDefaultModsDir();

const require = createRequire(import.meta.url);
const { extractConfigValues, updateTomlValues } = require("./toml.cjs");

export const DEFAULT_REGISTRY_URL =
    "https://raw.githubusercontent.com/dyri0n/trafficity-mod-manager/main/registry.json";

/**
 * Pure-Node ZIP extractor supporting Stored (method 0) and Deflate (method 8).
 * Validates entry paths to prevent directory traversal.
 * @param {Buffer | Uint8Array} zipBuffer
 * @param {string} destDir
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

/**
 * @param {string} modDir
 * @param {{ excludeNames?: string[], excludeExts?: string[] }} [options]
 */
export const walkModFiles = async (modDir, { excludeNames = [], excludeExts = [] } = {}) => {
    /** @type {string[]} */
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

/** @param {string} modDir */
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

/** @param {string} [modsDir] */
export const ensureModsWorkspaceTypes = async (modsDir) => {
    const targetModsDir = modsDir || (await getDefaultModsDir());
    await fsp.mkdir(targetModsDir, { recursive: true });
    if (fs.existsSync(BASE_TYPES_PATH)) {
        const typesDir = path.join(targetModsDir, ".tmod-types");
        await fsp.mkdir(typesDir, { recursive: true });
        await fsp.copyFile(BASE_TYPES_PATH, path.join(typesDir, "trafficity-mods.d.ts"));
    }
    const jsconfigPath = path.join(targetModsDir, "jsconfig.json");
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
                        checkJs: true,
                        strict: false,
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

/**
 * @param {{ downloadUrl: string, sha256?: string | null, id?: string | null, modsDir?: string | null }} options
 */
export const installModFromZip = async ({ downloadUrl, sha256 = null, id = null, modsDir = null }) => {
    const resolvedModsDir = modsDir || (await getDefaultModsDir());
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

    const tempDir = path.join(resolvedModsDir, `.tmp-install-${Date.now()}`);
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
        const installed = await installModDirectory({
            sourceDir: modRoot,
            targetDirName: targetId,
            manifestId,
            manifest,
            modsDir: resolvedModsDir,
            originSource: "registry",
        });
        await ensureModsWorkspaceTypes(resolvedModsDir);
        return installed;
    } finally {
        await fsp.rm(tempDir, { recursive: true, force: true });
    }
};

/**
 * @param {string} modsDir
 * @param {string} manifestId
 * @param {string} targetDirName
 */
const findMatchingInstalledDirs = async (modsDir, manifestId, targetDirName) => {
    /** @type {Array<{ name: string, dirPath: string, entryId: string | null }>} */
    const matches = [];
    if (!fs.existsSync(modsDir)) return matches;
    for (const entry of await fsp.readdir(modsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const dirPath = path.join(modsDir, entry.name);
        const manifestPath = path.join(dirPath, "mod.json");
        let entryId = null;
        if (fs.existsSync(manifestPath)) {
            try {
                const parsed = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
                entryId = String(parsed.id || entry.name).trim();
            } catch {
                // ignore malformed manifest
            }
        }
        if (entryId === manifestId || entry.name === targetDirName) {
            matches.push({ name: entry.name, dirPath, entryId });
        }
    }
    return matches;
};

/**
 * Installs or replaces a mod directory in `modsDir`, deduplicating folders that share
 * the same `manifestId` and preserving any user-modified `settings.toml` values.
 * @param {{ sourceDir: string, targetDirName: string, manifestId: string, manifest?: Record<string, unknown> | null, modsDir?: string | null, originSource?: string }} options
 */
export const installModDirectory = async ({
    sourceDir,
    targetDirName,
    manifestId,
    manifest = null,
    modsDir = null,
    originSource = "registry",
}) => {
    const targetModsDir = modsDir || (await getDefaultModsDir());
    const resolvedManifest =
        manifest || JSON.parse(await fsp.readFile(path.join(sourceDir, "mod.json"), "utf-8"));
    const finalDir = path.join(targetModsDir, targetDirName);
    await fsp.mkdir(targetModsDir, { recursive: true });

    const existingMatches = await findMatchingInstalledDirs(targetModsDir, manifestId, targetDirName);
    let savedTomlRaw = null;
    let savedTomlValues = null;
    for (const match of existingMatches) {
        const tomlPath = path.join(match.dirPath, "settings.toml");
        if (fs.existsSync(tomlPath)) {
            savedTomlRaw = await fsp.readFile(tomlPath, "utf-8");
            savedTomlValues = extractConfigValues(savedTomlRaw);
            break;
        }
    }

    for (const match of existingMatches) {
        await fsp.rm(match.dirPath, { recursive: true, force: true });
    }
    await fsp.rm(finalDir, { recursive: true, force: true });
    await fsp.cp(sourceDir, finalDir, {
        recursive: true,
        filter: (src) => {
            const base = path.basename(src);
            return !base.endsWith(".test.mjs") && !base.endsWith(".zip") && base !== ".tmod-origin.json";
        },
    });

    const destTomlPath = path.join(finalDir, "settings.toml");
    let preservedConfig = false;
    if (savedTomlValues && Object.keys(savedTomlValues).length > 0 && fs.existsSync(destTomlPath)) {
        const freshToml = await fsp.readFile(destTomlPath, "utf-8");
        await fsp.writeFile(destTomlPath, updateTomlValues(freshToml, savedTomlValues), "utf-8");
        preservedConfig = true;
    } else if (savedTomlRaw !== null && !fs.existsSync(destTomlPath)) {
        await fsp.writeFile(destTomlPath, savedTomlRaw, "utf-8");
        preservedConfig = true;
    }

    const codeHash = await computeModCodeHash(finalDir);
    await fsp.writeFile(
        path.join(finalDir, ".tmod-origin.json"),
        JSON.stringify(
            {
                source: originSource,
                originalId: manifestId,
                originalVersion: resolvedManifest.version || "1.0.0",
                codeHash,
            },
            null,
            2,
        ) + "\n",
    );

    return {
        id: targetDirName,
        dir: finalDir,
        manifest: resolvedManifest,
        deduplicated: Math.max(0, existingMatches.length - 1),
        replaced: existingMatches.length > 0,
        preservedConfig,
    };
};

/**
 * Syncs bundled example mods into `modsDir`:
 * - Installs missing example mods
 * - Deduplicates folders sharing the same `mod.json` `id`
 * - Replaces outdated or code-modified example mods while preserving user `settings.toml` values
 * - Leaves already up-to-date, unaffected example mods untouched
 */
/**
 * @param {{ modsDir?: string | null, examplesDir?: string }} [options]
 */
export const syncExampleMods = async ({
    modsDir = null,
    examplesDir = path.join(REPO_ROOT, "examples"),
} = {}) => {
    const targetModsDir = modsDir || (await getDefaultModsDir());
    /** @type {{ installed: string[], updated: string[], unchanged: string[], deduplicated: number }} */
    const result = { installed: [], updated: [], unchanged: [], deduplicated: 0 };
    if (!fs.existsSync(examplesDir)) {
        return result;
    }

    await fsp.mkdir(targetModsDir, { recursive: true });
    const entries = await fsp.readdir(examplesDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const exampleDir = path.join(examplesDir, entry.name);
        const manifestPath = path.join(exampleDir, "mod.json");
        if (!fs.existsSync(manifestPath)) continue;

        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8"));
        const manifestId = String(manifest.id || entry.name).trim();
        const targetDirName = manifestId.replace(/[^a-zA-Z0-9._-]/g, "-");
        const exampleHash = await computeModCodeHash(exampleDir);

        const matches = await findMatchingInstalledDirs(targetModsDir, manifestId, targetDirName);
        if (matches.length === 1 && matches[0].name === targetDirName) {
            const currentHash = await computeModCodeHash(matches[0].dirPath);
            let currentVersion = null;
            try {
                currentVersion = JSON.parse(
                    await fsp.readFile(path.join(matches[0].dirPath, "mod.json"), "utf-8"),
                ).version;
            } catch {
                // replace if manifest unreadable
            }
            if (currentHash === exampleHash && currentVersion === (manifest.version || "1.0.0")) {
                result.unchanged.push(manifestId);
                continue;
            }
        }

        const out = await installModDirectory({
            sourceDir: exampleDir,
            targetDirName,
            manifestId,
            manifest,
            modsDir: targetModsDir,
            originSource: "examples",
        });
        result.deduplicated += out.deduplicated;
        if (out.replaced) result.updated.push(manifestId);
        else result.installed.push(manifestId);
    }

    await ensureModsWorkspaceTypes(targetModsDir);
    return result;
};

/**
 * @param {string} idOrUrl
 * @param {{ modsDir?: string, registryUrl?: string }} [options]
 */
export const installModByIdOrUrl = async (idOrUrl, options = {}) => {
    const modsDir = options.modsDir || (await getDefaultModsDir());
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
    } else if (args.includes("--sync-examples")) {
        const summary = await syncExampleMods();
        console.log(JSON.stringify(summary));
    } else {
        const idx = args.indexOf("--install");
        const target = idx !== -1 ? args[idx + 1] : args[0];
        if (!target) {
            console.error("Usage: node src/registry.mjs --list | --sync-examples | --install <mod-id-or-zip-url>");
            process.exit(1);
        }
        const installed = await installModByIdOrUrl(target);
        console.log(`Installed ${installed.id} to ${installed.dir}`);
    }
}
