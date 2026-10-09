/**
 * binance.js
 *
 * Minimal Binance Spot REST client (no dependencies, uses global fetch).
 * Signed endpoints use HMAC-SHA256 as documented by Binance.
 */

const crypto = require("node:crypto");

const BASE_URLS = {
    live: "https://api.binance.com",
    testnet: "https://testnet.binance.vision",
};

class BinanceClient {
    constructor({ apiKey, apiSecret, testnet = false, baseUrl, fetchImpl, recvWindow = 5000 } = {}) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = baseUrl || (testnet ? BASE_URLS.testnet : BASE_URLS.live);
        this.fetch = fetchImpl || ((...args) => fetch(...args));
        this.recvWindow = recvWindow;
    }

    sign(query) {
        return crypto.createHmac("sha256", this.apiSecret).update(query).digest("hex");
    }

    async request(method, path, params = {}, { signed = false } = {}) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) search.append(key, String(value));
        }
        const headers = {};
        if (signed) {
            if (!this.apiKey || !this.apiSecret) throw new Error("Faltan BINANCE_API_KEY / BINANCE_API_SECRET");
            search.append("recvWindow", String(this.recvWindow));
            search.append("timestamp", String(Date.now()));
            search.append("signature", this.sign(search.toString()));
            headers["X-MBX-APIKEY"] = this.apiKey;
        }
        const query = search.toString();
        const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
        const response = await this.fetch(url, { method, headers });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(`Binance ${response.status}: ${body.msg || "error"} (code ${body.code})`);
            err.code = body.code;
            err.status = response.status;
            throw err;
        }
        return body;
    }

    async klines(symbol, interval, { limit = 500, startTime, endTime } = {}) {
        const rows = await this.request("GET", "/api/v3/klines", { symbol, interval, limit, startTime, endTime });
        return rows.map(parseKline);
    }

    async tickerPrice(symbol) {
        const body = await this.request("GET", "/api/v3/ticker/price", { symbol });
        return Number(body.price);
    }

    exchangeInfo(symbols) {
        return this.request("GET", "/api/v3/exchangeInfo", { symbols: JSON.stringify(symbols) });
    }

    account() {
        return this.request("GET", "/api/v3/account", {}, { signed: true });
    }

    newOrder(params) {
        return this.request("POST", "/api/v3/order", params, { signed: true });
    }

    cancelOrder(symbol, orderId) {
        return this.request("DELETE", "/api/v3/order", { symbol, orderId }, { signed: true });
    }

    getOrder(symbol, orderId) {
        return this.request("GET", "/api/v3/order", { symbol, orderId }, { signed: true });
    }
}

function parseKline(row) {
    return {
        openTime: row[0],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: row[6],
    };
}

function parseFilters(symbolInfo) {
    const byType = Object.fromEntries((symbolInfo.filters || []).map((f) => [f.filterType, f]));
    const lot = byType.LOT_SIZE || {};
    const price = byType.PRICE_FILTER || {};
    const notional = byType.NOTIONAL || byType.MIN_NOTIONAL || {};
    return {
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        stepSize: lot.stepSize || "0.00000001",
        minQty: Number(lot.minQty || 0),
        tickSize: price.tickSize || "0.00000001",
        minNotional: Number(notional.minNotional || 0),
    };
}

function decimalsOf(step) {
    const s = String(step);
    if (!s.includes(".")) return 0;
    return s.replace(/0+$/, "").split(".")[1]?.length || 0;
}

function floorToStep(value, step) {
    const n = Number(step);
    const decimals = decimalsOf(step);
    return Number((Math.floor(value / n + 1e-9) * n).toFixed(decimals));
}

function roundToStep(value, step) {
    const n = Number(step);
    const decimals = decimalsOf(step);
    return Number((Math.round(value / n) * n).toFixed(decimals));
}

const INTERVAL_MS = {
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
};

// Downloads [startTime, endTime) in pages of 1000 candles.
async function fetchHistory(client, symbol, interval, startTime, endTime) {
    const step = INTERVAL_MS[interval];
    if (!step) throw new Error(`Intervalo no soportado: ${interval}`);
    const out = [];
    let cursor = startTime;
    while (cursor < endTime) {
        const page = await client.klines(symbol, interval, { limit: 1000, startTime: cursor, endTime: endTime - 1 });
        if (page.length === 0) break;
        out.push(...page);
        cursor = page.at(-1).openTime + step;
        if (page.length < 1000) break;
    }
    return out;
}

module.exports = {
    BASE_URLS,
    INTERVAL_MS,
    BinanceClient,
    parseKline,
    parseFilters,
    floorToStep,
    roundToStep,
    fetchHistory,
};
