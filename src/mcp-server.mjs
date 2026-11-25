import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { evalInGame, fetchConsoleLogs } from "./dev-bridge-cli.mjs";

const TOOLS = [
    {
        name: "get_console_logs",
        description:
            "Read live console.log/warn/error and uncaught exception entries from the running Trafficity game (requires dev-bridge mod enabled).",
        inputSchema: {
            type: "object",
            properties: {
                since: { type: "number", description: "Only return entries with seq > since." },
                level: { type: "string", enum: ["log", "info", "warn", "error"], description: "Filter by console level." },
                q: { type: "string", description: "Case-insensitive substring filter." },
                limit: { type: "number", description: "Maximum number of entries to return (default 100)." },
            },
        },
    },
    {
        name: "eval_in_game",
        description:
            "Evaluate a JavaScript expression or async statement block inside the live Trafficity renderer with (mods, game) in scope.",
        inputSchema: {
            type: "object",
            properties: {
                code: { type: "string", description: "JavaScript expression or statements to execute in-game." },
                timeoutMs: { type: "number", description: "Execution timeout in milliseconds (default 10000)." },
            },
            required: ["code"],
        },
    },
];

/**
 * Handles a single JSON-RPC 2.0 MCP request object and returns a response object (or `null` for notifications).
 * @param {{ jsonrpc?: string, id?: string | number | null, method?: string, params?: Record<string, unknown> }} req
 * @returns {Promise<Record<string, unknown> | null>}
 */
export const handleMcpRequest = async (req) => {
    const id = req.id ?? null;
    const method = req.method || "";

    if (method === "notifications/initialized" || method.startsWith("notifications/")) {
        return null;
    }

    if (method === "initialize") {
        return {
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "trafficity-dev-bridge", version: "1.4.2" },
            },
        };
    }

    if (method === "tools/list") {
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }

    if (method === "tools/call") {
        const params = req.params || {};
        const name = typeof params.name === "string" ? params.name : "";
        const args =
            params.arguments && typeof params.arguments === "object"
                ? /** @type {Record<string, unknown>} */ (params.arguments)
                : {};
        try {
            if (name === "get_console_logs") {
                const data = await fetchConsoleLogs({
                    since: typeof args.since === "number" ? args.since : 0,
                    level: typeof args.level === "string" ? args.level : "",
                    q: typeof args.q === "string" ? args.q : "",
                    limit: typeof args.limit === "number" ? args.limit : 100,
                });
                return {
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] },
                };
            }
            if (name === "eval_in_game") {
                const code = typeof args.code === "string" ? args.code : "";
                const out = await evalInGame(code, {
                    timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : 10000,
                });
                return {
                    jsonrpc: "2.0",
                    id,
                    result: {
                        isError: !out.ok,
                        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
                    },
                };
            }
            return {
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: `Unknown tool: ${name}` },
            };
        } catch (err) {
            return {
                jsonrpc: "2.0",
                id,
                result: {
                    isError: true,
                    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
                },
            };
        }
    }

    return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
    };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
            const req = JSON.parse(trimmed);
            const res = await handleMcpRequest(req);
            if (res) {
                process.stdout.write(JSON.stringify(res) + "\n");
            }
        } catch (err) {
            process.stdout.write(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: null,
                    error: { code: -32700, message: err instanceof Error ? err.message : "Parse error" },
                }) + "\n",
            );
        }
    });
}
