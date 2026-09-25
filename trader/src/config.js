/**
 * config.js
 *
 * Default parameters for the bot. Anything here can be overridden by a
 * `config.json` next to cli.js (deep-merged) or by `--config <file>`.
 *
 * The risk section is the heart of the system: risk per trade is set by the
 * "capital phase" the account is in, and is then throttled by drawdown and
 * by the measured statistical edge (fractional Kelly).
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
    mode: "paper",
    testnet: false,
    quoteAsset: "USDT",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
    regimeSymbol: "BTCUSDT",
    interval: "4h",
    initialCapital: 500,
    feeRate: 0.001,
    slippage: 0.0005,
    pollSeconds: 60,

    strategy: {
        emaFast: 50,
        emaSlow: 200,
        breakoutLookback: 20,
        atrPeriod: 14,
        stopAtr: 2,
        trailAtr: 3,
        partialTakeR: 2,
        partialFraction: 0.5,
        minAtrPct: 0.005,
        maxAtrPct: 0.08,
    },

    risk: {
        // Capital phases, evaluated on total equity (trading + reserve).
        // `upTo: null` means no upper bound.
        tiers: [
            { name: "Guerrilla", upTo: 1000, riskPerTrade: 0.03, maxOpenPositions: 2 },
            { name: "Expansión", upTo: 2500, riskPerTrade: 0.025, maxOpenPositions: 3 },
            { name: "Consolidación", upTo: 5000, riskPerTrade: 0.02, maxOpenPositions: 3 },
            { name: "Preservación", upTo: null, riskPerTrade: 0.01, maxOpenPositions: 4 },
        ],
        // Sum of (entry - stop) * qty over open positions, as fraction of trading equity.
        maxTotalOpenRisk: 0.08,
        // Max notional of a single position, as fraction of trading equity (spot, no leverage).
        maxPositionPct: 0.6,
        // Risk multiplier applied once drawdown from the equity peak reaches `drawdown`.
        drawdownThrottle: [
            { drawdown: 0.10, multiplier: 0.5 },
            { drawdown: 0.20, multiplier: 0.25 },
        ],
        // Kill switch: flatten everything and stop until `reset-halt`.
        haltDrawdown: 0.30,
        // No new entries for the rest of the UTC day after losing this much.
        dailyLossLimit: 0.06,
        maxConsecutiveLosses: 4,
        cooldownHours: 24,
        // Once there is enough history, risk is capped at `fraction` x Kelly.
        kelly: { minTrades: 30, fraction: 0.5, noEdgeRisk: 0.005 },
        // Every time trading equity grows `triggerGain` over its base, move
        // `lockFraction` of that gain to a reserve the bot never trades.
        profitLock: { enabled: true, triggerGain: 0.5, lockFraction: 0.3 },
        minNotional: 10,
    },
};

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
    if (!isPlainObject(override)) return override === undefined ? base : override;
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
    }
    return out;
}

function loadConfig({ file, overrides = {} } = {}) {
    let fromFile = {};
    const candidate = file || path.join(__dirname, "..", "config.json");
    if (fs.existsSync(candidate)) {
        fromFile = JSON.parse(fs.readFileSync(candidate, "utf8"));
    } else if (file) {
        throw new Error(`Config file not found: ${file}`);
    }
    return deepMerge(deepMerge(DEFAULTS, fromFile), overrides);
}

module.exports = { DEFAULTS, deepMerge, loadConfig };
