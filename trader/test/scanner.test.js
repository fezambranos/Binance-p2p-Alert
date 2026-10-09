const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreUniverse, selectUniverse, percentileRanks, scan } = require("../src/scanner");
const { makeConfig } = require("./helpers");

const cfg = makeConfig().scanner;

function coin(symbol, extra = {}) {
    return {
        symbol, name: symbol, binanceSymbol: `${symbol}USDT`, marketCap: 1e9, fdv: 1.2e9, quoteVolume: 50e6,
        rs30: 0, rs90: 0, fees30d: 1e6, tvlChange30d: 0, ...extra,
    };
}

test("percentile ranks ignore missing values", () => {
    assert.deepEqual(percentileRanks([3, null, 1, 2]), [1, null, 0, 0.5]);
});

test("hard filters remove stablecoins, wrapped tokens, illiquid, diluted and unlisted coins", () => {
    const { ranked, rejected } = scoreUniverse([
        coin("USDC"),
        coin("WBTC"),
        coin("XYZ", { name: "Wrapped Something" }),
        coin("THIN", { quoteVolume: 1e5 }),
        coin("SMALL", { marketCap: 1e7 }),
        coin("UNLOCK", { fdv: 10e9 }),
        coin("NOPAIR", { binanceSymbol: null }),
        coin("GOOD"),
    ], cfg);
    assert.deepEqual(ranked.map((r) => r.symbol), ["GOOD"]);
    assert.equal(rejected.length, 7);
});

test("strong momentum, cheap valuation and growing usage rank first", () => {
    const { ranked } = scoreUniverse([
        coin("LAGGARD", { rs30: -0.2, rs90: -0.3, fees30d: 1e5, tvlChange30d: -0.2 }),
        coin("LEADER", { rs30: 0.3, rs90: 0.5, fees30d: 5e6, tvlChange30d: 0.3 }),
        coin("MIDDLE", { rs30: 0.05, rs90: 0.1, fees30d: 1e6, tvlChange30d: 0.05 }),
    ], cfg);
    assert.deepEqual(ranked.map((r) => r.symbol), ["LEADER", "MIDDLE", "LAGGARD"]);
});

test("coins without verifiable fundamentals are penalized, not excluded", () => {
    const { ranked } = scoreUniverse([
        coin("MEME", { rs30: 0.3, rs90: 0.5, fees30d: null, tvlChange30d: null }),
        coin("PROTO", { rs30: 0.3, rs90: 0.5 }),
        coin("OTHER", { rs30: 0, rs90: 0, fees30d: 1e5 }),
    ], cfg);
    const meme = ranked.find((r) => r.symbol === "MEME");
    assert.equal(meme.components.valuation, cfg.missingScore);
    assert.ok(ranked.findIndex((r) => r.symbol === "PROTO") < ranked.findIndex((r) => r.symbol === "MEME"));
});

test("universe = core + top N above the minimum score", () => {
    const ranked = [
        { binanceSymbol: "AUSDT", score: 0.9 },
        { binanceSymbol: "ETHUSDT", score: 0.8 },
        { binanceSymbol: "BUSDT", score: 0.7 },
        { binanceSymbol: "CUSDT", score: 0.4 },
    ];
    assert.deepEqual(selectUniverse(ranked, { ...cfg, topN: 4 }), ["BTCUSDT", "ETHUSDT", "AUSDT", "BUSDT"]);
});

test("scan joins CoinGecko, DefiLlama and Binance data", async () => {
    const candles = (end) => Array.from({ length: 120 }, (_, i) => ({ close: 100 * Math.pow(end, i / 119) }));
    const client = { klines: async (symbol) => (symbol === "BTCUSDT" ? candles(1.1) : symbol === "AAAUSDT" ? candles(2) : candles(1)) };
    const sources = {
        coingeckoMarkets: async () => [
            { id: "aaa", symbol: "AAA", name: "Aaa", marketCap: 2e9, fdv: 2.5e9, volume24h: 1e8 },
            { id: "bbb", symbol: "BBB", name: "Bbb", marketCap: 2e9, fdv: 2.5e9, volume24h: 1e8 },
            { id: "usdc", symbol: "USDC", name: "USD Coin", marketCap: 5e10, fdv: 5e10, volume24h: 1e9 },
        ],
        defillamaFundamentals: async () => ({ aaa: { fees30d: 2e7, tvlChange30d: 0.1 } }),
        binanceTickers24h: async () => ({ AAAUSDT: { quoteVolume: 3e7 }, BBBUSDT: { quoteVolume: 3e7 }, USDCUSDT: { quoteVolume: 1e9 } }),
    };
    const { ranked, rejected } = await scan({ client, cfg, sources });
    assert.equal(ranked[0].symbol, "AAA");
    assert.ok(ranked[0].raw.rs30 > 0);
    assert.equal(rejected[0].symbol, "USDC");
});
