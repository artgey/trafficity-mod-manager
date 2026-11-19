import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";
import { inspectAsarStatus, resolveDefaultAsarPath, resolveDefaultModsDir } from "./patch.mjs";
import { DEFAULT_REGISTRY_URL, ensureModsWorkspaceTypes } from "./registry.mjs";

const require = createRequire(import.meta.url);
const { extractSettingsSchema } = require("./toml.cjs");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const runHealthCheck = async ({
    gameDir = null,
    modsDir = resolveDefaultModsDir(),
    checkRemote = true,
} = {}) => {
    const checks = [];
    const addCheck = (id, status, title, detail, fixAction = "") => {
        checks.push({ id, status, title, detail, fixAction });
    };

    // 1. Node & dependencies
    const hasAsar = fs.existsSync(path.join(REPO_ROOT, "node_modules", "@electron", "asar", "package.json"));
    if (hasAsar) {
        addCheck("node-deps", "pass", "Node.js & Dependencies", `Node ${process.version} with @electron/asar installed.`);
    } else {
        addCheck("node-deps", "fail", "Node.js & Dependencies", "Missing @electron/asar in node_modules. Run npm install.", "");
    }

    // 2. Game installation & backup
    const asarPath = gameDir
        ? path.resolve(gameDir, "resources", "app.asar")
        : resolveDefaultAsarPath();
    const asarStatus = inspectAsarStatus(asarPath);

    if (!asarStatus.found) {
        addCheck("game-install", "fail", "Game Installation", `Could not find resources/app.asar at ${asarPath}. Set the Trafficity folder path.`, "");
    } else if (!asarStatus.backupExists) {
        addCheck(
            "game-install",
            "warn",
            "Game Installation",
            `Found ${asarStatus.gameDir} (${asarStatus.gameRelease || "unknown release"}), but app.asar.bak backup does not exist yet.`,
            asarStatus.patched ? "" : "patch",
        );
    } else {
        addCheck(
            "game-install",
            "pass",
            "Game Installation",
            `Found ${asarStatus.gameDir} (${asarStatus.gameRelease || "unknown release"}) with app.asar.bak backup.`,
        );
    }

    // 3. ASAR patch & hook integrity
    if (!asarStatus.found) {
        addCheck("asar-hooks", "fail", "ASAR Patch & Hooks", "Skipped because app.asar was not found.", "");
    } else if (!asarStatus.patched) {
        addCheck("asar-hooks", "warn", "ASAR Patch & Hooks", "app.asar is currently stock (unpatched). Click Fix to patch it.", "patch");
    } else {
        let missingAssets = [];
        try {
            const files = asar.listPackage(asarPath);
            for (const reqFile of ["/electron/mod-api.cjs", "/electron/toml.cjs", "/electron/mod-loader.js"]) {
                if (!files.includes(reqFile)) missingAssets.push(reqFile.slice(1));
            }
        } catch (err) {
            missingAssets.push(err instanceof Error ? err.message : String(err));
        }

        if (!asarStatus.hooksOk || missingAssets.length > 0) {
            const parts = [];
            if (!asarStatus.hooksOk) parts.push(`missing Router hooks: ${asarStatus.missingHooks.join(", ")}`);
            if (missingAssets.length > 0) parts.push(`missing bundled runtime files: ${missingAssets.join(", ")}`);
            addCheck("asar-hooks", "warn", "ASAR Patch & Hooks", `Patch is outdated (${parts.join("; ")}). Re-patch to update.`, "patch");
        } else {
            addCheck("asar-hooks", "pass", "ASAR Patch & Hooks", "Patched cleanly with all Router hooks, mod-api.cjs, toml.cjs, and mod-loader.js.");
        }
    }

    // 4. Mods workspace & LSP types
    const resolvedModsDir = path.resolve(modsDir);
    if (!fs.existsSync(resolvedModsDir)) {
        addCheck("mods-workspace", "warn", "Mods Folder & LSP Types", `Mods folder does not exist yet at ${resolvedModsDir}.`, "sync-types");
    } else {
        const hasJsConfig = fs.existsSync(path.join(resolvedModsDir, "jsconfig.json"));
        const hasTypes = fs.existsSync(path.join(resolvedModsDir, ".tmod-types", "trafficity-mods.d.ts"));
        if (!hasJsConfig || !hasTypes) {
            addCheck(
                "mods-workspace",
                "warn",
                "Mods Folder & LSP Types",
                `Mods folder exists at ${resolvedModsDir}, but jsconfig.json or .tmod-types/trafficity-mods.d.ts is missing.`,
                "sync-types",
            );
        } else {
            addCheck("mods-workspace", "pass", "Mods Folder & LSP Types", `Ready at ${resolvedModsDir} with jsconfig.json and TrafficityMods types.`);
        }
    }

    // 5. mods-config.json validity
    const configPath = path.join(path.dirname(resolvedModsDir), "mods-config.json");
    let enabledMap = {};
    if (!fs.existsSync(configPath)) {
        addCheck("mods-config", "pass", "Mod Config File", "No mods-config.json yet (will be created when you toggle a mod).");
    } else {
        try {
            const parsed = JSON.parse(await fsp.readFile(configPath, "utf8"));
            if (!parsed || typeof parsed !== "object") {
                throw new Error("Root value must be a JSON object");
            }
            enabledMap = parsed.enabled && typeof parsed.enabled === "object" ? parsed.enabled : {};
            addCheck("mods-config", "pass", "Mod Config File", `Valid JSON at ${configPath}.`);
        } catch (err) {
            addCheck("mods-config", "fail", "Mod Config File", `Invalid JSON in ${configPath}: ${err instanceof Error ? err.message : String(err)}`, "");
        }
    }

    // 6. Installed mods validation (mod.json, entry/styles, settings.toml, dependencies)
    const modIssues = [];
    const discoveredIds = new Set();
    const enabledMods = [];
    let modCount = 0;

    if (fs.existsSync(resolvedModsDir)) {
        const entries = await fsp.readdir(resolvedModsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
            const folderDir = path.join(resolvedModsDir, entry.name);
            const manifestPath = path.join(folderDir, "mod.json");
            if (!fs.existsSync(manifestPath)) continue;
            modCount += 1;
            try {
                const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
                const id = String(manifest.id || entry.name).trim();
                discoveredIds.add(id);

                if (typeof manifest.entry === "string" && manifest.entry.trim()) {
                    const entryPath = path.join(folderDir, manifest.entry);
                    if (!fs.existsSync(entryPath)) {
                        modIssues.push(`${id}: missing entry file '${manifest.entry}'`);
                    }
                }
                if (Array.isArray(manifest.styles)) {
                    for (const styleRel of manifest.styles) {
                        if (typeof styleRel === "string" && !fs.existsSync(path.join(folderDir, styleRel))) {
                            modIssues.push(`${id}: missing style '${styleRel}'`);
                        }
                    }
                }
                const settingsPath = path.join(folderDir, "settings.toml");
                if (fs.existsSync(settingsPath)) {
                    const rawToml = await fsp.readFile(settingsPath, "utf8");
                    const schema = extractSettingsSchema(rawToml);
                    if (!Array.isArray(schema)) {
                        modIssues.push(`${id}: failed to parse settings.toml`);
                    }
                }
                if (manifest.forkedFrom !== undefined) {
                    if (!manifest.forkedFrom || typeof manifest.forkedFrom !== "object" || !String(manifest.forkedFrom.id || "").trim() || !String(manifest.forkedFrom.name || "").trim()) {
                        modIssues.push(`${id}: invalid forkedFrom metadata (requires id and name)`);
                    }
                }
                if (enabledMap[id] === true) {
                    enabledMods.push({ id, dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : [] });
                }
            } catch (err) {
                modIssues.push(`${entry.name}: invalid mod.json (${err instanceof Error ? err.message : String(err)})`);
            }
        }
    }

    for (const mod of enabledMods) {
        for (const dep of mod.dependencies) {
            if (!discoveredIds.has(dep)) {
                modIssues.push(`${mod.id}: missing required dependency '${dep}'`);
            } else if (enabledMap[dep] !== true) {
                modIssues.push(`${mod.id}: required dependency '${dep}' is installed but disabled`);
            }
        }
    }

    if (modIssues.length > 0) {
        addCheck("mods-validation", "fail", "Installed Mods & Dependencies", modIssues.join(" | "), "");
    } else {
        addCheck("mods-validation", "pass", "Installed Mods & Dependencies", `Validated ${modCount} mod(s) with no manifest, asset, settings.toml, or dependency errors.`);
    }

    // 7. Community registry reachability
    if (checkRemote) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(DEFAULT_REGISTRY_URL, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
                addCheck("registry-network", "pass", "Community Registry", `Online (${DEFAULT_REGISTRY_URL}).`);
            } else {
                addCheck("registry-network", "warn", "Community Registry", `Remote returned HTTP ${res.status}; local registry.json fallback will be used.`);
            }
        } catch (err) {
            addCheck("registry-network", "warn", "Community Registry", `Offline or unreachable (${err instanceof Error ? err.message : String(err)}); local fallback available.`);
        }
    }

    const passed = checks.filter((c) => c.status === "pass").length;
    const warnings = checks.filter((c) => c.status === "warn").length;
    const errors = checks.filter((c) => c.status === "fail").length;

    return {
        ok: errors === 0,
        passed,
        warnings,
        errors,
        summary: `${passed} passed, ${warnings} warning(s), ${errors} error(s)`,
        checks,
    };
};

const parseArgs = (argv) => {
    const out = { gameDir: null, offline: false, json: false, syncTypes: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--game-dir" && argv[i + 1]) {
            out.gameDir = argv[++i];
        } else if (arg === "--offline") {
            out.offline = true;
        } else if (arg === "--json") {
            out.json = true;
        } else if (arg === "--sync-types") {
            out.syncTypes = true;
        }
    }
    return out;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = parseArgs(process.argv.slice(2));
    if (args.syncTypes) {
        const modsDir = resolveDefaultModsDir();
        await ensureModsWorkspaceTypes(modsDir);
        console.log(JSON.stringify({ ok: true, modsDir }));
    } else {
        const report = await runHealthCheck({
            gameDir: args.gameDir,
            checkRemote: !args.offline,
        });
        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(`Health Check: ${report.summary}`);
            for (const c of report.checks) {
                console.log(`[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`);
            }
        }
        if (!report.ok) {
            process.exitCode = 1;
        }
    }
}
