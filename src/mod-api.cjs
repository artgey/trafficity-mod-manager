const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { extractConfigValues, extractSettingsSchema, updateTomlValues } = require("./toml.cjs");

/** @type {Record<string, string>} */
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".toml": "text/plain; charset=utf-8",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

/** @param {import("node:http").ServerResponse} res */
const setIsolationHeaders = (res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
};

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} statusCode
 * @param {unknown} payload
 */
const sendJson = (res, statusCode, payload) => {
    res.statusCode = statusCode;
    setIsolationHeaders(res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<Record<string, unknown>>}
 */
const readJsonBody = async (req, maxBytes = 1024 * 1024) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
            throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
        }
        chunks.push(buf);
    }

    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) {
        return {};
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Object.assign(new Error("Invalid JSON request body"), { statusCode: 400 });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw Object.assign(new Error("Request body must be a JSON object"), { statusCode: 400 });
    }
    return /** @type {Record<string, unknown>} */ (parsed);
};

/**
 * @param {string} rootDir
 * @param {string} requestPath
 */
const safeJoin = (rootDir, requestPath) => {
    const decoded = decodeURIComponent(requestPath.split("?")[0]);
    const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    const resolved = path.resolve(rootDir, normalized.replace(/^[/\\]+/, ""));
    const base = path.resolve(rootDir);

    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        return null;
    }

    return resolved;
};

/** @param {() => Promise<string> | string} getPlayerSavesDir */
const resolveModsDir = async (getPlayerSavesDir) => {
    if (process.env.TRAFFICITY_MODS_DIR) {
        const dir = path.resolve(process.env.TRAFFICITY_MODS_DIR);
        await fsp.mkdir(dir, { recursive: true });
        return dir;
    }

    const savesDir = await getPlayerSavesDir();
    const modsDir = path.join(path.dirname(savesDir), "mods");
    await fsp.mkdir(modsDir, { recursive: true });
    return modsDir;
};

/** @param {string} modsDir */
const getConfigPath = (modsDir) => {
    return path.join(path.dirname(modsDir), "mods-config.json");
};

const MAX_LOG_SESSIONS = 10;
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_RECENT_CRASH_CONTEXT = 100;

/** @param {number} ts */
const formatFileStamp = (ts) => {
    return new Date(ts).toISOString().replace(/[:.]/g, "-").slice(0, 19);
};

/**
 * @param {string} logsDir
 * @param {number} maxSessions
 */
const pruneLogArchivesSync = (logsDir, maxSessions) => {
    try {
        const entries = fs.readdirSync(logsDir)
            .filter((name) => /^(session|crash)-.+\.log$/i.test(name))
            .map((name) => {
                const fullPath = path.join(logsDir, name);
                let mtimeMs = 0;
                try {
                    mtimeMs = fs.statSync(fullPath).mtimeMs;
                } catch {
                    mtimeMs = 0;
                }
                return { name, fullPath, mtimeMs };
            })
            .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));

        while (entries.length > maxSessions) {
            const oldest = entries.shift();
            if (!oldest) break;
            try {
                fs.unlinkSync(oldest.fullPath);
            } catch {
                // ignore unlink race
            }
        }
    } catch {
        // ignore prune errors
    }
};

/**
 * Creates a passive disk session & crash logger storing logs under `<modsDir>/logs/`.
 * @param {{ maxSessions?: number, maxBytes?: number }} [options]
 */
const createSessionLogger = ({ maxSessions = MAX_LOG_SESSIONS, maxBytes = MAX_LOG_BYTES } = {}) => {
    /** @type {string | null} */
    let activeLogsDir = null;
    let currentBytes = 0;
    /** @type {string[]} */
    const recentLines = [];

    /**
     * @param {string} logsDir
     * @param {string} reasonLine
     */
    const startFreshLatestSync = (logsDir, reasonLine) => {
        const latestPath = path.join(logsDir, "latest.log");
        try {
            if (fs.existsSync(latestPath)) {
                const stat = fs.statSync(latestPath);
                if (stat.size > 0) {
                    const stamp = formatFileStamp(stat.mtimeMs || Date.now());
                    let archivePath = path.join(logsDir, `session-${stamp}.log`);
                    if (fs.existsSync(archivePath)) {
                        archivePath = path.join(logsDir, `session-${stamp}-${process.pid}.log`);
                    }
                    fs.renameSync(latestPath, archivePath);
                    pruneLogArchivesSync(logsDir, maxSessions);
                }
            }
        } catch {
            // ignore rotation error
        }
        const header = `[${new Date().toISOString()}] [INFO] ${reasonLine}\n`;
        try {
            fs.writeFileSync(latestPath, header, "utf-8");
            currentBytes = Buffer.byteLength(header, "utf-8");
        } catch {
            currentBytes = 0;
        }
    };

    /** @param {string} modsDir */
    const ensureInitializedSync = (modsDir) => {
        const logsDir = path.join(modsDir, "logs");
        if (activeLogsDir === logsDir) {
            return logsDir;
        }
        try {
            fs.mkdirSync(logsDir, { recursive: true });
            activeLogsDir = logsDir;
            startFreshLatestSync(logsDir, `[modloader] Session started (pid=${process.pid}, platform=${process.platform})`);
            return logsDir;
        } catch {
            return null;
        }
    };

    /**
     * @param {string} modsDir
     * @param {{ ts?: number, level?: string, text?: string, crash?: boolean }} entry
     */
    const appendSync = (modsDir, entry) => {
        const logsDir = ensureInitializedSync(modsDir);
        if (!logsDir) return;
        const ts = typeof entry.ts === "number" ? entry.ts : Date.now();
        const level = (typeof entry.level === "string" ? entry.level : "log").toUpperCase();
        const text = typeof entry.text === "string" ? entry.text : String(entry.text ?? "");
        const line = `[${new Date(ts).toISOString()}] [${level}] ${text.replace(/\r\n/g, "\n")}\n`;
        const bytes = Buffer.byteLength(line, "utf-8");

        recentLines.push(line.trimEnd());
        if (recentLines.length > MAX_RECENT_CRASH_CONTEXT) {
            recentLines.shift();
        }

        if (currentBytes + bytes > maxBytes) {
            startFreshLatestSync(logsDir, `[modloader] Log rotated after exceeding ${maxBytes} bytes`);
        }

        const latestPath = path.join(logsDir, "latest.log");
        try {
            fs.appendFileSync(latestPath, line, "utf-8");
            currentBytes += bytes;
        } catch {
            // ignore write error
        }

        const isCrash = Boolean(
            entry.crash
            || /\[(Uncaught Error|Unhandled Rejection|Main uncaughtException|Main unhandledRejection|render-process-gone|child-process-gone)\]/i.test(text),
        );
        if (isCrash) {
            const crashPath = path.join(logsDir, `crash-${formatFileStamp(ts)}.log`);
            const snapshot = [
                `=== Trafficity Crash Snapshot (${new Date(ts).toISOString()}) ===`,
                `PID: ${process.pid} | Platform: ${process.platform}`,
                "",
                "--- Crash Event ---",
                line.trimEnd(),
                "",
                `--- Recent Context (last ${recentLines.length} lines) ---`,
                ...recentLines,
                "",
            ].join("\n");
            try {
                fs.writeFileSync(crashPath, snapshot, "utf-8");
                pruneLogArchivesSync(logsDir, maxSessions);
            } catch {
                // ignore crash file write error
            }
        }
    };

    return {
        ensureInitializedSync,
        appendSync,
        getLogsDir: () => activeLogsDir,
    };
};

/** @type {ReturnType<typeof createSessionLogger> | null} */
let sharedSessionLogger = null;

const getSharedSessionLogger = () => {
    if (!sharedSessionLogger) {
        sharedSessionLogger = createSessionLogger();
    }
    return sharedSessionLogger;
};

/**
 * Installs Electron main-process crash & process-gone handlers that flush synchronously to `<modsDir>/logs/`.
 * @param {{ app: { on: (event: string, listener: (...args: unknown[]) => void) => void }, getPlayerSavesDir: () => Promise<string> | string }} options
 */
const installMainCrashHandlers = ({ app, getPlayerSavesDir }) => {
    const logger = getSharedSessionLogger();
    /** @type {string | null} */
    let cachedModsDir = process.env.TRAFFICITY_MODS_DIR ? path.resolve(process.env.TRAFFICITY_MODS_DIR) : null;

    const refreshModsDir = async () => {
        try {
            cachedModsDir = await resolveModsDir(getPlayerSavesDir);
            logger.ensureInitializedSync(cachedModsDir);
        } catch {
            // ignore if saves dir isn't ready yet
        }
    };
    void refreshModsDir();

    /**
     * @param {string} tag
     * @param {unknown} errOrDetail
     */
    const recordMainCrash = (tag, errOrDetail) => {
        if (!cachedModsDir) {
            try {
                if (process.env.TRAFFICITY_MODS_DIR) {
                    cachedModsDir = path.resolve(process.env.TRAFFICITY_MODS_DIR);
                } else {
                    const maybe = getPlayerSavesDir();
                    if (typeof maybe === "string") {
                        cachedModsDir = path.join(path.dirname(maybe), "mods");
                    }
                }
            } catch {
                // ignore
            }
        }
        if (!cachedModsDir) return;
        let detail;
        if (errOrDetail instanceof Error) {
            detail = errOrDetail.stack || `${errOrDetail.name}: ${errOrDetail.message}`;
        } else if (typeof errOrDetail === "string") {
            detail = errOrDetail;
        } else {
            try {
                detail = JSON.stringify(errOrDetail);
            } catch {
                detail = String(errOrDetail);
            }
        }
        logger.appendSync(cachedModsDir, {
            ts: Date.now(),
            level: "error",
            text: `[${tag}] ${detail}`,
            crash: true,
        });
    };

    process.on("uncaughtException", (err) => {
        recordMainCrash("Main uncaughtException", err);
    });
    process.on("unhandledRejection", (reason) => {
        recordMainCrash("Main unhandledRejection", reason);
    });
    if (app && typeof app.on === "function") {
        app.on("render-process-gone", (_event, _webContents, details) => {
            recordMainCrash("render-process-gone", details);
        });
        app.on("child-process-gone", (_event, details) => {
            recordMainCrash("child-process-gone", details);
        });
    }
};

/**
 * @param {string} modsDir
 * @returns {Promise<{ enabled: Record<string, boolean>, configs: Record<string, Record<string, unknown>> }>}
 */
const readModsConfig = async (modsDir) => {
    const configPath = getConfigPath(modsDir);
    try {
        const raw = await fsp.readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
            enabled: parsed && typeof parsed.enabled === "object" && parsed.enabled !== null ? parsed.enabled : {},
            configs: parsed && typeof parsed.configs === "object" && parsed.configs !== null ? parsed.configs : {},
        };
    } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? err.code : null;
        if (code !== "ENOENT") {
            console.warn(`[TrafficityMods] Failed to parse ${configPath}; using defaults:`, err instanceof Error ? err.message : String(err));
        }
        return { enabled: {}, configs: {} };
    }
};

/**
 * @param {string} modsDir
 * @param {{ enabled: Record<string, boolean>, configs: Record<string, Record<string, unknown>> }} config
 */
const writeModsConfig = async (modsDir, config) => {
    const configPath = getConfigPath(modsDir);
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
};

/** @param {string} modsDir */
const listMods = async (modsDir) => {
    await fsp.mkdir(modsDir, { recursive: true });
    const config = await readModsConfig(modsDir);
    const entries = await fsp.readdir(modsDir, { withFileTypes: true });
    /** @type {Array<Record<string, unknown> & { id: string, folder: string, name: string, enabled: boolean, error?: string | null }>} */
    const mods = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const folderName = entry.name;
        const manifestPath = path.join(modsDir, folderName, "mod.json");
        if (!fs.existsSync(manifestPath)) {
            continue;
        }

        try {
            const raw = await fsp.readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(raw);
            const id = typeof manifest.id === "string" && manifest.id.trim() ? manifest.id.trim() : folderName;
            const settingsTomlPath = path.join(modsDir, folderName, "settings.toml");
            /** @type {ReturnType<typeof extractSettingsSchema>} */
            let settingsSchema = [];
            /** @type {Record<string, unknown>} */
            let tomlConfig = {};
            if (fs.existsSync(settingsTomlPath)) {
                const rawToml = await fsp.readFile(settingsTomlPath, "utf-8");
                settingsSchema = extractSettingsSchema(rawToml);
                tomlConfig = extractConfigValues(rawToml);
            }
            const legacyConfig = config.configs[id] && typeof config.configs[id] === "object" ? config.configs[id] : {};

            mods.push({
                id,
                folder: folderName,
                name: typeof manifest.name === "string" ? manifest.name : id,
                version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
                modloaderVersion: typeof manifest.modloaderVersion === "string" ? manifest.modloaderVersion.trim() : "",
                author: typeof manifest.author === "string" ? manifest.author : "",
                description: typeof manifest.description === "string" ? manifest.description : "",
                entry: typeof manifest.entry === "string" ? manifest.entry : null,
                styles: Array.isArray(manifest.styles) ? manifest.styles.filter((/** @type {unknown} */ s) => typeof s === "string") : [],
                dependencies: Array.isArray(manifest.dependencies)
                    ? manifest.dependencies.filter((/** @type {unknown} */ d) => typeof d === "string" && d.trim())
                    : [],
                optionalDependencies: Array.isArray(manifest.optionalDependencies)
                    ? manifest.optionalDependencies.filter((/** @type {unknown} */ d) => typeof d === "string" && d.trim())
                    : [],
                enabled: config.enabled[id] === true,
                hasSettings: fs.existsSync(settingsTomlPath),
                settingsSchema,
                forkedFrom: manifest.forkedFrom && typeof manifest.forkedFrom === "object" ? manifest.forkedFrom : null,
                lineage: Array.isArray(manifest.lineage) ? manifest.lineage : [],
                config: { ...legacyConfig, ...tomlConfig },
                error: null,
            });
        } catch (err) {
            const errorMessage = `Invalid mod.json: ${err instanceof Error ? err.message : String(err)}`;
            mods.push({
                id: folderName,
                folder: folderName,
                name: folderName,
                version: "0.0.0",
                author: "",
                description: errorMessage,
                entry: null,
                styles: [],
                dependencies: [],
                optionalDependencies: [],
                enabled: false,
                config: {},
                error: errorMessage,
            });
        }
    }

    mods.sort((a, b) => a.name.localeCompare(b.name));
    return { modsDir, mods };
};

/**
 * @param {{ rootDir: string, getPlayerSavesDir: () => Promise<string> | string }} options
 */
const createModRequestHandler = ({ rootDir, getPlayerSavesDir }) => {
    const loaderPath = path.join(rootDir, "electron", "mod-loader.js");
    const errorReportingPath = path.join(rootDir, "dist", "error-reporting.json");

    const MAX_CONSOLE_LOGS = 500;
    /** @type {Array<{ seq: number, ts: number, level: string, text: string }>} */
    const consoleBuffer = [];
    let nextSeq = 1;
    /** @type {Array<{ id: string, code: string }>} */
    const evalQueue = [];
    /** @type {Map<string, { resolve: (val: { ok: boolean, result?: unknown, error?: string }) => void, timer: ReturnType<typeof setTimeout> }>} */
    const pendingEvals = new Map();
    let evalCounter = 1;
    let bridgeFileWritten = false;

    /**
     * @param {string} modsDir
     * @param {import("node:http").IncomingMessage} req
     */
    const ensureBridgeFile = async (modsDir, req) => {
        if (bridgeFileWritten) return;
        const host = typeof req.headers.host === "string" && req.headers.host ? req.headers.host : null;
        if (!host) return;
        bridgeFileWritten = true;
        const bridgePath = path.join(path.dirname(modsDir), "dev-bridge.json");
        try {
            await fsp.writeFile(
                bridgePath,
                JSON.stringify({ url: `http://${host}`, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2) + "\n",
                "utf-8",
            );
        } catch {
            bridgeFileWritten = false;
        }
    };

    const readGameRelease = async () => {
        try {
            const raw = await fsp.readFile(errorReportingPath, "utf-8");
            const parsed = JSON.parse(raw);
            return typeof parsed.release === "string" ? parsed.release : null;
        } catch {
            return null;
        }
    };

    /**
     * @param {import("node:http").IncomingMessage} req
     * @param {import("node:http").ServerResponse} res
     * @param {URL} url
     */
    return async (req, res, url) => {
        if (url.pathname === "/api/mods" && req.method === "GET") {
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const listed = await listMods(modsDir);
            const data = {
                ...listed,
                gameRelease: await readGameRelease(),
            };
            if (url.searchParams.get("enabled") === "1") {
                data.mods = data.mods.filter((m) => m.enabled && !m.error);
            }
            sendJson(res, 200, data);
            return true;
        }

        if (url.pathname === "/api/mods/toggle" && req.method === "POST") {
            /** @type {Record<string, unknown>} */
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                const status = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 400;
                sendJson(res, status, { error: err instanceof Error ? err.message : "Invalid request body" });
                return true;
            }
            if (typeof body.id !== "string" || !body.id.trim()) {
                sendJson(res, 400, { error: "Missing mod id" });
                return true;
            }
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const config = await readModsConfig(modsDir);
            config.enabled[body.id.trim()] = body.enabled === true;
            await writeModsConfig(modsDir, config);
            sendJson(res, 200, { ok: true, id: body.id.trim(), enabled: config.enabled[body.id.trim()] });
            return true;
        }

        if (url.pathname === "/api/mods/config" && req.method === "POST") {
            /** @type {Record<string, unknown>} */
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                const status = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 400;
                sendJson(res, status, { error: err instanceof Error ? err.message : "Invalid request body" });
                return true;
            }
            if (typeof body.id !== "string" || !body.id.trim()) {
                sendJson(res, 400, { error: "Missing mod id" });
                return true;
            }
            const modId = body.id.trim();
            const nextConfig =
                body.config && typeof body.config === "object" && !Array.isArray(body.config)
                    ? /** @type {Record<string, unknown>} */ (body.config)
                    : {};
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const { mods } = await listMods(modsDir);
            const targetMod = mods.find((m) => m.id === modId);
            const settingsTomlPath = targetMod ? path.join(modsDir, targetMod.folder, "settings.toml") : null;
            if (settingsTomlPath && fs.existsSync(settingsTomlPath)) {
                const rawToml = await fsp.readFile(settingsTomlPath, "utf-8");
                await fsp.writeFile(settingsTomlPath, updateTomlValues(rawToml, nextConfig), "utf-8");
            } else {
                const config = await readModsConfig(modsDir);
                config.configs[modId] = nextConfig;
                await writeModsConfig(modsDir, config);
            }
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (url.pathname === "/mods-runtime/loader.js" && req.method === "GET") {
            const data = await fsp.readFile(loaderPath);
            res.statusCode = 200;
            setIsolationHeaders(res);
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.end(data);
            return true;
        }

        if (url.pathname.startsWith("/mods-runtime/mods/") && req.method === "GET") {
            const rest = url.pathname.slice("/mods-runtime/mods/".length);
            const slashIdx = rest.indexOf("/");
            if (slashIdx <= 0) {
                res.statusCode = 404;
                setIsolationHeaders(res);
                res.end("Not found");
                return true;
            }

            const modIdOrFolder = decodeURIComponent(rest.slice(0, slashIdx));
            const relFile = rest.slice(slashIdx + 1);
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const { mods } = await listMods(modsDir);
            const mod = mods.find((m) => m.id === modIdOrFolder || m.folder === modIdOrFolder);

            if (!mod) {
                res.statusCode = 404;
                setIsolationHeaders(res);
                res.end("Mod not found");
                return true;
            }

            const modRoot = path.join(modsDir, mod.folder);
            const filePath = safeJoin(modRoot, relFile);
            if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                res.statusCode = 404;
                setIsolationHeaders(res);
                res.end("File not found");
                return true;
            }

            const data = await fsp.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            res.statusCode = 200;
            setIsolationHeaders(res);
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
            res.end(data);
            return true;
        }

        if (url.pathname === "/api/dev/console/push" && req.method === "POST") {
            /** @type {Record<string, unknown>} */
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                const status = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 400;
                sendJson(res, status, { error: err instanceof Error ? err.message : "Invalid request body" });
                return true;
            }
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            if (body.passive !== true) {
                await ensureBridgeFile(modsDir, req);
            }
            const logger = getSharedSessionLogger();
            const rawEntries = Array.isArray(body.entries) ? body.entries : [];
            for (const item of rawEntries) {
                if (!item || typeof item !== "object") continue;
                const rec = /** @type {Record<string, unknown>} */ (item);
                const entry = {
                    seq: nextSeq++,
                    ts: typeof rec.ts === "number" ? rec.ts : Date.now(),
                    level: typeof rec.level === "string" ? rec.level : "log",
                    text: typeof rec.text === "string" ? rec.text : String(rec.text ?? ""),
                };
                consoleBuffer.push(entry);
                if (consoleBuffer.length > MAX_CONSOLE_LOGS) {
                    consoleBuffer.shift();
                }
                logger.appendSync(modsDir, { ...entry, crash: rec.crash === true });
            }
            sendJson(res, 200, { ok: true, latestSeq: nextSeq - 1 });
            return true;
        }

        if (url.pathname === "/api/dev/console" && req.method === "GET") {
            const since = Number(url.searchParams.get("since") || "0") || 0;
            const levelFilter = (url.searchParams.get("level") || "").trim().toLowerCase();
            const qFilter = (url.searchParams.get("q") || "").trim().toLowerCase();
            const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || "100") || 100));

            let entries = consoleBuffer.filter((e) => e.seq > since);
            if (levelFilter) {
                entries = entries.filter((e) => e.level.toLowerCase() === levelFilter);
            }
            if (qFilter) {
                entries = entries.filter((e) => e.text.toLowerCase().includes(qFilter));
            }
            if (entries.length > limit) {
                entries = entries.slice(-limit);
            }
            sendJson(res, 200, { latestSeq: nextSeq - 1, entries });
            return true;
        }

        if (url.pathname === "/api/dev/eval/poll" && req.method === "GET") {
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            await ensureBridgeFile(modsDir, req);
            const items = evalQueue.splice(0, evalQueue.length);
            sendJson(res, 200, { items });
            return true;
        }

        if (url.pathname === "/api/dev/eval/result" && req.method === "POST") {
            /** @type {Record<string, unknown>} */
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                const status = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 400;
                sendJson(res, status, { error: err instanceof Error ? err.message : "Invalid request body" });
                return true;
            }
            const id = typeof body.id === "string" ? body.id : "";
            const pending = pendingEvals.get(id);
            if (pending) {
                clearTimeout(pending.timer);
                pendingEvals.delete(id);
                pending.resolve({
                    ok: body.ok === true,
                    ...(body.ok === true ? { result: body.result } : { error: typeof body.error === "string" ? body.error : "Eval failed" }),
                });
            }
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (url.pathname === "/api/dev/eval" && req.method === "POST") {
            const origin = req.headers.origin;
            if (typeof origin === "string" && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
                sendJson(res, 403, { ok: false, error: "Forbidden origin" });
                return true;
            }
            /** @type {Record<string, unknown>} */
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                const status = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 400;
                sendJson(res, status, { ok: false, error: err instanceof Error ? err.message : "Invalid request body" });
                return true;
            }
            const code = typeof body.code === "string" ? body.code : "";
            if (!code.trim()) {
                sendJson(res, 400, { ok: false, error: "Missing code" });
                return true;
            }
            const timeoutMs = Math.max(500, Math.min(30000, typeof body.timeoutMs === "number" ? body.timeoutMs : 10000));
            const id = `eval-${Date.now()}-${evalCounter++}`;
            const outcome = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    pendingEvals.delete(id);
                    const qIdx = evalQueue.findIndex((item) => item.id === id);
                    if (qIdx !== -1) evalQueue.splice(qIdx, 1);
                    resolve({ ok: false, error: "Eval timed out (is Trafficity running with dev-bridge mod enabled?)" });
                }, timeoutMs);
                pendingEvals.set(id, { resolve, timer });
                evalQueue.push({ id, code });
            });
            sendJson(res, outcome.ok ? 200 : outcome.error?.includes("timed out") ? 504 : 200, outcome);
            return true;
        }

        return false;
    };
};

module.exports = {
    resolveModsDir,
    readModsConfig,
    writeModsConfig,
    listMods,
    createSessionLogger,
    installMainCrashHandlers,
    createModRequestHandler,
};
