import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDefaultModsDir } from "./patch.mjs";

/**
 * Resolves the active `dev-bridge.json` path next to `mods/`.
 * @param {string} [modsDir]
 */
export const resolveDevBridgeFilePath = (modsDir = resolveDefaultModsDir()) =>
    path.join(path.dirname(path.resolve(modsDir)), "dev-bridge.json");

/**
 * Reads the running Trafficity dev-bridge server URL from `dev-bridge.json` or an explicit override.
 * @param {string | null} [explicitUrl]
 * @param {string} [modsDir]
 * @returns {Promise<string>}
 */
export const resolveDevBridgeUrl = async (explicitUrl = null, modsDir = resolveDefaultModsDir()) => {
    if (explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
        return explicitUrl.replace(/\/+$/, "");
    }
    const bridgePath = resolveDevBridgeFilePath(modsDir);
    if (!fs.existsSync(bridgePath)) {
        throw new Error(
            `No dev-bridge.json found at ${bridgePath}. Launch Trafficity with the 'dev-bridge' mod enabled (F9).`,
        );
    }
    const parsed = JSON.parse(await fsp.readFile(bridgePath, "utf8"));
    if (!parsed || typeof parsed.url !== "string" || !parsed.url) {
        throw new Error(`Invalid dev-bridge.json at ${bridgePath}`);
    }
    return parsed.url.replace(/\/+$/, "");
};

/**
 * Fetches console log entries from the running Trafficity dev-bridge server.
 * @param {{ url?: string | null, since?: number, level?: string, q?: string, limit?: number }} [options]
 * @returns {Promise<{ latestSeq: number, entries: Array<{ seq: number, ts: number, level: string, text: string }> }>}
 */
export const fetchConsoleLogs = async ({ url = null, since = 0, level = "", q = "", limit = 100 } = {}) => {
    const baseUrl = await resolveDevBridgeUrl(url);
    const params = new URLSearchParams();
    if (since > 0) params.set("since", String(since));
    if (level) params.set("level", level);
    if (q) params.set("q", q);
    if (limit > 0) params.set("limit", String(limit));
    const res = await fetch(`${baseUrl}/api/dev/console?${params.toString()}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch console logs (${res.status})`);
    }
    return /** @type {{ latestSeq: number, entries: Array<{ seq: number, ts: number, level: string, text: string }> }} */ (
        await res.json()
    );
};

/**
 * Evaluates a JS snippet inside the running Trafficity renderer via dev-bridge.
 * @param {string} code
 * @param {{ url?: string | null, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, result?: unknown, error?: string }>}
 */
export const evalInGame = async (code, { url = null, timeoutMs = 10000 } = {}) => {
    const baseUrl = await resolveDevBridgeUrl(url);
    const res = await fetch(`${baseUrl}/api/dev/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, timeoutMs }),
    });
    return /** @type {{ ok: boolean, result?: unknown, error?: string }} */ (await res.json());
};

/** @param {string[]} argv */
const parseArgs = (argv) => {
    /** @type {{ logs: boolean, file: boolean, crashes: boolean, follow: boolean, json: boolean, help: boolean, evalCode: string | null, level: string, q: string, since: number, limit: number, url: string | null }} */
    const out = {
        logs: false,
        file: false,
        crashes: false,
        follow: false,
        json: false,
        help: false,
        evalCode: null,
        level: "",
        q: "",
        since: 0,
        limit: 100,
        url: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--logs") out.logs = true;
        else if (arg === "--file") {
            out.logs = true;
            out.file = true;
        } else if (arg === "--crashes") {
            out.logs = true;
            out.file = true;
            out.crashes = true;
        } else if (arg === "--follow" || arg === "-f") {
            out.logs = true;
            out.follow = true;
        } else if (arg === "--json") out.json = true;
        else if (arg === "--help" || arg === "-h") out.help = true;
        else if (arg === "--eval" && argv[i + 1] !== undefined) out.evalCode = argv[++i];
        else if (arg === "--level" && argv[i + 1] !== undefined) out.level = argv[++i];
        else if (arg === "--q" && argv[i + 1] !== undefined) out.q = argv[++i];
        else if (arg === "--since" && argv[i + 1] !== undefined) out.since = Number(argv[++i]) || 0;
        else if ((arg === "--limit" || arg === "--tail") && argv[i + 1] !== undefined) out.limit = Number(argv[++i]) || 100;
        else if (arg === "--url" && argv[i + 1] !== undefined) out.url = argv[++i];
        else if (!arg.startsWith("-") && out.evalCode === null && !out.logs) out.evalCode = arg;
    }
    return out;
};

const USAGE = [
    "Usage: node src/dev-bridge-cli.mjs [options]",
    "  --logs [--follow|-f] [--since <seq>] [--level <log|info|warn|error>] [--q <substr>] [--limit <n>] [--json]",
    "  --file [--crashes] [--level <log|info|warn|error>] [--q <substr>] [--tail <n>]   Read passive disk logs (mods/logs/)",
    "  --eval <js-code> [--url <http://127.0.0.1:port>]",
    "  --help, -h",
].join("\n");

/**
 * Reads passive disk logs (`latest.log` or latest `crash-*.log`) from `<modsDir>/logs/`.
 * @param {{ modsDir?: string, crashes?: boolean, level?: string, q?: string, limit?: number }} [options]
 */
export const readDiskLogs = async ({
    modsDir = resolveDefaultModsDir(),
    crashes = false,
    level = "",
    q = "",
    limit = 100,
} = {}) => {
    const logsDir = path.join(path.resolve(modsDir), "logs");
    if (!fs.existsSync(logsDir)) {
        throw new Error(`No logs directory found at ${logsDir}. Launch Trafficity at least once after patching.`);
    }
    let targetFile = path.join(logsDir, "latest.log");
    /** @type {string[]} */
    let crashFiles = [];
    const entries = await fsp.readdir(logsDir);
    crashFiles = entries
        .filter((n) => /^crash-.+\.log$/i.test(n))
        .sort()
        .reverse();
    if (crashes) {
        if (crashFiles.length === 0) {
            throw new Error(`No crash-*.log files found in ${logsDir}.`);
        }
        targetFile = path.join(logsDir, crashFiles[0]);
    } else if (!fs.existsSync(targetFile)) {
        throw new Error(`No latest.log found in ${logsDir}.`);
    }

    const raw = await fsp.readFile(targetFile, "utf8");
    let lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (level) {
        const lvlTag = `[${level.trim().toUpperCase()}]`;
        lines = lines.filter((l) => l.includes(lvlTag));
    }
    if (q) {
        const needle = q.trim().toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(needle));
    }
    if (limit > 0 && lines.length > limit) {
        lines = lines.slice(-limit);
    }
    return { logsDir, targetFile, crashFiles, lines };
};

/** @param {{ seq: number, ts: number, level: string, text: string }} entry */
const formatEntry = (entry) => {
    const time = new Date(entry.ts).toISOString().slice(11, 23);
    return `[${time}] [${entry.level.toUpperCase()}] #${entry.seq} ${entry.text}`;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = parseArgs(process.argv.slice(2));
    try {
        if (args.help) {
            console.log(USAGE);
        } else if (args.evalCode !== null) {
            const res = await evalInGame(args.evalCode, { url: args.url });
            console.log(JSON.stringify(res, null, 2));
            if (!res.ok) process.exitCode = 1;
        } else if (args.file) {
            const res = await readDiskLogs({
                crashes: args.crashes,
                level: args.level,
                q: args.q,
                limit: args.limit,
            });
            if (args.json) {
                console.log(JSON.stringify(res, null, 2));
            } else {
                console.log(`# ${res.targetFile} (crash snapshots: ${res.crashFiles.length})`);
                for (const line of res.lines) {
                    console.log(line);
                }
            }
        } else {
            let since = args.since;
            const first = await fetchConsoleLogs({
                url: args.url,
                since,
                level: args.level,
                q: args.q,
                limit: args.limit,
            });
            if (args.json) {
                console.log(JSON.stringify(first, null, 2));
            } else {
                for (const entry of first.entries) {
                    console.log(formatEntry(entry));
                }
            }
            since = first.latestSeq;
            if (args.follow) {
                setInterval(async () => {
                    try {
                        const next = await fetchConsoleLogs({
                            url: args.url,
                            since,
                            level: args.level,
                            q: args.q,
                            limit: args.limit,
                        });
                        for (const entry of next.entries) {
                            console.log(args.json ? JSON.stringify(entry) : formatEntry(entry));
                        }
                        if (next.latestSeq > since) since = next.latestSeq;
                    } catch {
                        // wait for next poll
                    }
                }, 400);
            }
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
    }
}
