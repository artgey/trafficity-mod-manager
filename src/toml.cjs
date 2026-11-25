// Zero-dependency TOML subset parser/updater for mod settings.toml files.
// Supports flat `key = value` pairs and `[settingKey]` tables with `value`, `type`,
// `label`, `description`, `min`, `max`, and `options` metadata.

/** @param {string} line */
const stripInlineComment = (line) => {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\" && inDouble) {
            escaped = true;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (ch === "#" && !inSingle && !inDouble) {
            return line.slice(0, i);
        }
    }
    return line;
};

/**
 * @typedef {string | number | boolean | TomlValue[]} TomlValue
 * @typedef {{ key: string, value: TomlValue, type: string, label: string, description: string, min?: number, max?: number, options?: TomlValue[] }} TomlSettingSchema
 */

/**
 * @param {string} rawVal
 * @returns {TomlValue}
 */
const parseTomlValue = (rawVal) => {
    const val = rawVal.trim();
    if (val === "true") return true;
    if (val === "false") return false;
    if (/^[+-]?\d+(\.\d+)?$/.test(val)) return Number(val);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        const inner = val.slice(1, -1);
        return val.startsWith('"')
            ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
            : inner;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        if (!inner) return [];
        const items = [];
        let cur = "";
        let inSingle = false;
        let inDouble = false;
        let escaped = false;
        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (escaped) {
                cur += ch;
                escaped = false;
                continue;
            }
            if (ch === "\\" && inDouble) {
                cur += ch;
                escaped = true;
                continue;
            }
            if (ch === '"' && !inSingle) inDouble = !inDouble;
            else if (ch === "'" && !inDouble) inSingle = !inSingle;
            if (ch === "," && !inSingle && !inDouble) {
                if (cur.trim()) items.push(parseTomlValue(cur));
                cur = "";
            } else {
                cur += ch;
            }
        }
        if (cur.trim()) items.push(parseTomlValue(cur));
        return items;
    }
    return val;
};

/**
 * @param {unknown} val
 * @returns {string}
 */
const formatTomlValue = (val) => {
    if (typeof val === "boolean") return val ? "true" : "false";
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
    if (Array.isArray(val)) return `[${val.map(formatTomlValue).join(", ")}]`;
    const str = String(val ?? "");
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
};

/** @param {string} rawText */
const parseToml = (rawText) => {
    /** @type {Record<string, TomlValue>} */
    const flat = {};
    /** @type {Record<string, Record<string, TomlValue>>} */
    const sections = {};
    /** @type {string | null} */
    let currentSection = null;

    for (const rawLine of String(rawText || "").split(/\r?\n/)) {
        const clean = stripInlineComment(rawLine).trim();
        if (!clean) continue;

        const secMatch = clean.match(/^\[([A-Za-z0-9_.-]+)\]$/);
        if (secMatch) {
            currentSection = secMatch[1];
            if (!sections[currentSection]) sections[currentSection] = {};
            continue;
        }

        const eqIdx = clean.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = clean.slice(0, eqIdx).trim();
        const val = parseTomlValue(clean.slice(eqIdx + 1));
        if (!key) continue;

        if (currentSection) {
            sections[currentSection][key] = val;
        } else {
            flat[key] = val;
        }
    }

    return { flat, sections };
};

/**
 * @param {unknown} val
 * @param {string} [explicitType]
 * @param {TomlValue[]} [options]
 */
const inferType = (val, explicitType, options) => {
    if (explicitType) return explicitType;
    if (Array.isArray(options) && options.length > 0) return "select";
    if (typeof val === "boolean") return "boolean";
    if (typeof val === "number") return "number";
    return "string";
};

/** @param {string} rawText */
const extractSettingsSchema = (rawText) => {
    const { flat, sections } = parseToml(rawText);
    /** @type {TomlSettingSchema[]} */
    const schema = [];

    for (const [key, value] of Object.entries(flat)) {
        schema.push({
            key,
            value,
            type: inferType(value),
            label: key,
            description: "",
        });
    }

    for (const [key, sec] of Object.entries(sections)) {
        const value = Object.prototype.hasOwnProperty.call(sec, "value") ? sec.value : sec.default ?? "";
        const options = Array.isArray(sec.options) ? sec.options : [];
        /** @type {TomlSettingSchema} */
        const entry = {
            key,
            value,
            type: inferType(value, typeof sec.type === "string" ? sec.type : "", options),
            label: typeof sec.label === "string" && sec.label ? sec.label : key,
            description: typeof sec.description === "string" ? sec.description : "",
        };
        if (typeof sec.min === "number") entry.min = sec.min;
        if (typeof sec.max === "number") entry.max = sec.max;
        if (options.length > 0) entry.options = options;
        schema.push(entry);
    }

    return schema;
};

/** @param {string} rawText */
const extractConfigValues = (rawText) => {
    /** @type {Record<string, TomlValue>} */
    const out = {};
    for (const item of extractSettingsSchema(rawText)) {
        out[item.key] = item.value;
    }
    return out;
};

/**
 * @param {string} rawText
 * @param {Record<string, unknown>} updates
 */
const updateTomlValues = (rawText, updates) => {
    if (!updates || typeof updates !== "object") return String(rawText || "");
    const remaining = new Set(Object.keys(updates));
    const lines = String(rawText || "").split(/\r?\n/);
    let currentSection = null;
    const outLines = [];

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const clean = stripInlineComment(rawLine).trim();
        const secMatch = clean.match(/^\[([A-Za-z0-9_.-]+)\]$/);
        if (secMatch) {
            currentSection = secMatch[1];
            outLines.push(rawLine);
            continue;
        }

        const eqIdx = clean.indexOf("=");
        if (eqIdx > 0) {
            const key = clean.slice(0, eqIdx).trim();
            if (currentSection && key === "value" && remaining.has(currentSection)) {
                outLines.push(`value = ${formatTomlValue(updates[currentSection])}`);
                remaining.delete(currentSection);
                continue;
            }
            if (!currentSection && remaining.has(key)) {
                outLines.push(`${key} = ${formatTomlValue(updates[key])}`);
                remaining.delete(key);
                continue;
            }
        }
        outLines.push(rawLine);
    }

    if (remaining.size > 0) {
        if (outLines.length > 0 && outLines[outLines.length - 1].trim() !== "") {
            outLines.push("");
        }
        for (const key of remaining) {
            outLines.push(`${key} = ${formatTomlValue(updates[key])}`);
        }
    }

    return outLines.join("\n").replace(/\n*$/, "\n");
};

module.exports = {
    parseToml,
    extractSettingsSchema,
    extractConfigValues,
    updateTomlValues,
    formatTomlValue,
};
