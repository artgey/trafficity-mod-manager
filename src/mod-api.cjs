const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wav": "audio/wav",
    ".webp": "image/webp",
};

const setIsolationHeaders = (res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
};

const sendJson = (res, statusCode, payload) => {
    res.statusCode = statusCode;
    setIsolationHeaders(res);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
};

const readJsonBody = async (req, maxBytes = 1024 * 1024) => {
    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) {
            throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
        }
        chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) {
        return {};
    }

    return JSON.parse(raw);
};

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

const getConfigPath = (modsDir) => {
    return path.join(path.dirname(modsDir), "mods-config.json");
};

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
        if (err && err.code === "ENOENT") {
            return { enabled: {}, configs: {} };
        }
        return { enabled: {}, configs: {} };
    }
};

const writeModsConfig = async (modsDir, config) => {
    const configPath = getConfigPath(modsDir);
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
};

const listMods = async (modsDir) => {
    await fsp.mkdir(modsDir, { recursive: true });
    const config = await readModsConfig(modsDir);
    const entries = await fsp.readdir(modsDir, { withFileTypes: true });
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

            mods.push({
                id,
                folder: folderName,
                name: typeof manifest.name === "string" ? manifest.name : id,
                version: typeof manifest.version === "string" ? manifest.version : "1.0.0",
                author: typeof manifest.author === "string" ? manifest.author : "",
                description: typeof manifest.description === "string" ? manifest.description : "",
                entry: typeof manifest.entry === "string" ? manifest.entry : null,
                styles: Array.isArray(manifest.styles) ? manifest.styles.filter((s) => typeof s === "string") : [],
                dependencies: Array.isArray(manifest.dependencies)
                    ? manifest.dependencies.filter((d) => typeof d === "string" && d.trim())
                    : [],
                optionalDependencies: Array.isArray(manifest.optionalDependencies)
                    ? manifest.optionalDependencies.filter((d) => typeof d === "string" && d.trim())
                    : [],
                enabled: config.enabled[id] === true,
                config: config.configs[id] && typeof config.configs[id] === "object" ? config.configs[id] : {},
            });
        } catch (err) {
            mods.push({
                id: folderName,
                folder: folderName,
                name: folderName,
                version: "0.0.0",
                author: "",
                description: `Invalid mod.json: ${err && err.message ? err.message : String(err)}`,
                entry: null,
                styles: [],
                dependencies: [],
                optionalDependencies: [],
                enabled: false,
                config: {},
                error: true,
            });
        }
    }

    mods.sort((a, b) => a.name.localeCompare(b.name));
    return { modsDir, mods };
};

const createModRequestHandler = ({ rootDir, getPlayerSavesDir }) => {
    const loaderPath = path.join(rootDir, "electron", "mod-loader.js");

    return async (req, res, url) => {
        if (url.pathname === "/api/mods" && req.method === "GET") {
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const data = await listMods(modsDir);
            if (url.searchParams.get("enabled") === "1") {
                data.mods = data.mods.filter((m) => m.enabled && !m.error);
            }
            sendJson(res, 200, data);
            return true;
        }

        if (url.pathname === "/api/mods/toggle" && req.method === "POST") {
            const body = await readJsonBody(req);
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
            const body = await readJsonBody(req);
            if (typeof body.id !== "string" || !body.id.trim()) {
                sendJson(res, 400, { error: "Missing mod id" });
                return true;
            }
            const modsDir = await resolveModsDir(getPlayerSavesDir);
            const config = await readModsConfig(modsDir);
            config.configs[body.id.trim()] = body.config && typeof body.config === "object" ? body.config : {};
            await writeModsConfig(modsDir, config);
            sendJson(res, 200, { ok: true });
            return true;
        }

        if (url.pathname === "/mods-runtime/loader.js" && req.method === "GET") {
            const data = await fsp.readFile(loaderPath);
            res.statusCode = 200;
            setIsolationHeaders(res);
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
            res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
            res.end(data);
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
    createModRequestHandler,
};
