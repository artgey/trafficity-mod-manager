const MOD_ID = "dev-bridge";

const DEFAULTS = {
    capture_console: true,
    allow_eval: true,
    poll_interval_ms: 250,
};

/**
 * Safely converts arbitrary JS values (including circular objects, Errors, TypedArrays, and DOM nodes)
 * into a JSON-serializable representation.
 * @param {unknown} value
 * @param {number} [maxDepth]
 * @returns {unknown}
 */
export const toJsonSafe = (value, maxDepth = 4) => {
    const seen = new WeakSet();
    /**
     * @param {unknown} val
     * @param {number} depth
     * @returns {unknown}
     */
    const walk = (val, depth) => {
        if (val === null || val === undefined) return val;
        const t = typeof val;
        if (t === "string" || t === "number" || t === "boolean") return val;
        if (t === "bigint") return `${val}n`;
        if (t === "symbol") return String(val);
        if (t === "function") return `[Function: ${/** @type {{ name?: string }} */ (val).name || "anonymous"}]`;
        if (val instanceof Error) {
            return { name: val.name, message: val.message, stack: val.stack };
        }
        if (ArrayBuffer.isView(val)) {
            const arr = /** @type {ArrayLike<number>} */ (/** @type {unknown} */ (val));
            return `[${val.constructor?.name || "TypedArray"}(${arr.length})]`;
        }
        if (typeof Element !== "undefined" && val instanceof Element) {
            return `<${val.tagName.toLowerCase()}${val.id ? `#${val.id}` : ""}>`;
        }
        if (depth >= maxDepth) {
            return Array.isArray(val) ? `[Array(${val.length})]` : "[Object]";
        }
        if (typeof val === "object") {
            if (seen.has(val)) return "[Circular]";
            seen.add(val);
            if (Array.isArray(val)) {
                return val.slice(0, 100).map((item) => walk(item, depth + 1));
            }
            if (val instanceof Map) {
                return `[Map(${val.size})]`;
            }
            if (val instanceof Set) {
                return `[Set(${val.size})]`;
            }
            /** @type {Record<string, unknown>} */
            const out = {};
            const keys = Object.keys(val);
            for (let i = 0; i < Math.min(keys.length, 60); i++) {
                const k = keys[i];
                try {
                    out[k] = walk(/** @type {Record<string, unknown>} */ (val)[k], depth + 1);
                } catch {
                    out[k] = "[Unreadable]";
                }
            }
            if (keys.length > 60) out.__truncatedKeys = keys.length - 60;
            return out;
        }
        return String(val);
    };
    return walk(value, 0);
};

/**
 * Formats console arguments into a single readable string.
 * @param {unknown[]} args
 * @returns {string}
 */
export const formatConsoleArgs = (args) =>
    args
        .map((arg) => {
            if (typeof arg === "string") return arg;
            const safe = toJsonSafe(arg);
            try {
                return JSON.stringify(safe);
            } catch {
                return String(arg);
            }
        })
        .join(" ");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Evaluates a JS expression or statement block with `(mods, game)` in scope.
 * @param {string} code
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 * @returns {Promise<{ ok: boolean, result?: unknown, error?: string }>}
 */
export const evaluateSnippet = async (code, mods, game) => {
    try {
        /** @type {((mods: TrafficityModsApi, game: TrafficityGameFacade) => Promise<unknown>)} */
        let fn;
        try {
            fn = new AsyncFunction("mods", "game", `"use strict"; return (${code});`);
        } catch {
            fn = new AsyncFunction("mods", "game", `"use strict"; ${code}`);
        }
        const raw = await fn(mods, game);
        return { ok: true, result: toJsonSafe(raw) };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        };
    }
};

/**
 * @param {TrafficityModsApi} mods
 * @param {TrafficityGameFacade} game
 */
export default function setupDevBridge(mods, game) {
    const cfg = mods.getConfig(MOD_ID, DEFAULTS);
    const captureConsole = cfg.capture_console !== false;
    const allowEval = cfg.allow_eval !== false;
    const pollIntervalMs = Math.max(50, Math.min(2000, Number(cfg.poll_interval_ms) || DEFAULTS.poll_interval_ms));

    /** @type {Array<{ ts: number, level: string, text: string }>} */
    const queue = [];
    let flushing = false;
    let polling = false;

    const flushLogs = async () => {
        if (flushing || queue.length === 0 || typeof fetch !== "function") return;
        flushing = true;
        const batch = queue.splice(0, queue.length);
        try {
            await fetch("/api/dev/console/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entries: batch }),
            });
        } catch {
            // Drop on disconnect so we don't loop or leak memory
        } finally {
            flushing = false;
        }
    };

    /**
     * @param {string} level
     * @param {unknown[]} args
     */
    const enqueueLog = (level, args) => {
        queue.push({ ts: Date.now(), level, text: formatConsoleArgs(args) });
        if (queue.length > 250) queue.shift();
        if (level === "error") {
            void flushLogs();
        }
    };

    if (captureConsole && typeof console !== "undefined" && !/** @type {{ __trafficityLogged?: boolean }} */ (console.log).__trafficityLogged) {
        /** @type {Array<"log" | "info" | "warn" | "error">} */
        const levels = ["log", "info", "warn", "error"];
        for (const level of levels) {
            const orig = console[level].bind(console);
            console[level] = (/** @type {unknown[]} */ ...args) => {
                orig(...args);
                enqueueLog(level, args);
            };
        }

        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("error", (ev) => {
                enqueueLog("error", [`[Uncaught Error] ${ev.message || "Error"} (${ev.filename || ""}:${ev.lineno || 0})`]);
            });
            window.addEventListener("unhandledrejection", (ev) => {
                enqueueLog("error", ["[Unhandled Rejection]", ev.reason]);
            });
        }
    }

    const pollEval = async () => {
        if (!allowEval || polling || typeof fetch !== "function") return;
        polling = true;
        try {
            const res = await fetch("/api/dev/eval/poll");
            if (!res.ok) return;
            const data = /** @type {{ items?: Array<{ id: string, code: string }> }} */ (await res.json());
            for (const item of data.items || []) {
                const outcome = await evaluateSnippet(item.code, mods, game);
                await fetch("/api/dev/eval/result", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: item.id, ...outcome }),
                });
            }
        } catch {
            // ignore transient poll errors
        } finally {
            polling = false;
        }
    };

    // Announce bridge presence immediately so dev-bridge.json is written even before any console output
    enqueueLog("info", ["[dev-bridge] Active", { captureConsole, allowEval, pollIntervalMs }]);
    void flushLogs();

    if (typeof setInterval === "function") {
        setInterval(() => {
            void flushLogs();
            void pollEval();
        }, pollIntervalMs);
    }
}
