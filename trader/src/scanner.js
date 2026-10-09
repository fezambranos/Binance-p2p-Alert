/**
 * scanner.js — Bot 2: altcoin selection.
 *
 * Hard filters remove what should never be traded with a small account
 * (stablecoins, wrapped tokens, illiquid coins, heavy future dilution,
 * coins not tradable on Binance). The survivors are ranked by a composite
 * of percentile scores:
 *
 *   momentum   strength vs BTC over 30 and 90 days (the most persistent
 *              cross-sectional effect in crypto)
 *   valuation  annualized fees / market cap (a P/E-like ratio for protocols)
 *   usage      30-day TVL change (is real usage growing?)
 *   dilution   market cap / FDV (how much supply is still to be unlocked)
 *   liquidity  Binance 24h volume (cheap fills, no slippage surprises)
 *
 * Coins without verifiable fundamentals are not excluded but get a low
 * score on those components: no data is not good news.
 */

const EXCLUDED = new Set([
    "USDT", "USDC", "FDUSD", "DAI", "TUSD", "USDE", "USDD", "PYUSD", "USDS", "BUSD", "USD1", "RLUSD", "USDP", "GUSD",
    "FRAX", "LUSD", "EURC", "EURT", "XAUT", "PAXG", "WBTC", "WETH", "STETH", "WSTETH", "WEETH", "CBBTC", "CBETH",
    "RETH", "BTCB", "WBNB", "METH", "EZETH", "RSETH", "SOLVBTC", "LBTC", "JITOSOL", "MSOL", "BNSOL", "LEO", "OKB",
]);
const EXCLUDED_NAME = /(wrapped|staked|bridged|restaked|liquid staking|\busd\b|stablecoin)/i;

function percentileRanks(values) {
    const present = values.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length).fill(null);
    if (present.length === 1) out[present[0][1]] = 0.5;
    present.forEach(([, i], rank) => {
        if (present.length > 1) out[i] = rank / (present.length - 1);
    });
    return out;
}

/**
 * coins: [{ symbol, name, marketCap, fdv, binanceSymbol, quoteVolume,
 *           rs30, rs90, fees30d, tvlChange30d }]
 */
function scoreUniverse(coins, cfg) {
    const rejected = [];
    const candidates = [];
    for (const c of coins) {
        const reason = hardFilter(c, cfg);
        if (reason) rejected.push({ symbol: c.symbol, reason });
        else candidates.push(c);
    }

    const rs30 = percentileRanks(candidates.map((c) => c.rs30));
    const rs90 = percentileRanks(candidates.map((c) => c.rs90));
    const valuation = percentileRanks(candidates.map((c) => (c.fees30d > 0 ? (c.fees30d * 12) / c.marketCap : null)));
    const usage = percentileRanks(candidates.map((c) => c.tvlChange30d));
    const dilution = percentileRanks(candidates.map((c) => (c.fdv > 0 ? c.marketCap / c.fdv : null)));
    const liquidity = percentileRanks(candidates.map((c) => c.quoteVolume));
    const w = cfg.weights;
    const missing = cfg.missingScore;

    const ranked = candidates.map((c, i) => {
        const components = {
            momentum: rs30[i] == null || rs90[i] == null ? missing : 0.5 * rs30[i] + 0.5 * rs90[i],
            valuation: valuation[i] ?? missing,
            usage: usage[i] ?? missing,
            dilution: dilution[i] ?? 0.5,
            liquidity: liquidity[i] ?? missing,
        };
        const score = Object.entries(w).reduce((a, [k, weight]) => a + weight * components[k], 0);
        return { symbol: c.symbol, binanceSymbol: c.binanceSymbol, score, components, raw: c };
    });
    ranked.sort((a, b) => b.score - a.score);
    return { ranked, rejected };
}

function hardFilter(c, cfg) {
    if (EXCLUDED.has(c.symbol) || EXCLUDED_NAME.test(c.name || "")) return "stablecoin / token envuelto";
    if (!c.binanceSymbol) return "no cotiza contra USDT en Binance";
    if (!(c.marketCap >= cfg.minMarketCap)) return "capitalización baja";
    if (!(c.quoteVolume >= cfg.minQuoteVolume)) return "poca liquidez en Binance";
    if (c.fdv > 0 && c.marketCap / c.fdv < cfg.minCirculatingRatio) return "dilución futura alta (mucho supply por desbloquear)";
    return null;
}

function relativeStrength(candles, btcCandles, days) {
    if (candles.length <= days || btcCandles.length <= days) return null;
    const own = candles.at(-1).close / candles.at(-1 - days).close - 1;
    const btc = btcCandles.at(-1).close / btcCandles.at(-1 - days).close - 1;
    return own - btc;
}

/**
 * Collects the data and ranks. `sources` is injectable for tests; defaults
 * to the public APIs in datasources.js.
 */
async function scan({ client, cfg, quoteAsset = "USDT", sources }) {
    const ds = sources || require("./datasources");
    const [markets, fundamentals, tickers] = await Promise.all([
        ds.coingeckoMarkets(),
        ds.defillamaFundamentals().catch(() => ({})),
        ds.binanceTickers24h(),
    ]);

    const seen = new Set();
    const coins = [];
    for (const m of markets) {
        if (seen.has(m.symbol)) continue;
        seen.add(m.symbol);
        const pair = `${m.symbol}${quoteAsset}`;
        const f = fundamentals[m.id] || {};
        coins.push({
            ...m,
            binanceSymbol: tickers[pair] ? pair : null,
            quoteVolume: tickers[pair]?.quoteVolume ?? 0,
            fees30d: f.fees30d ?? null,
            tvlChange30d: f.tvlChange30d ?? null,
        });
    }

    // Price history only for coins that survive the cheap filters.
    const btc = await client.klines(`BTC${quoteAsset}`, "1d", { limit: 120 });
    for (const c of coins) {
        if (hardFilter(c, cfg)) continue;
        try {
            const candles = await client.klines(c.binanceSymbol, "1d", { limit: 120 });
            c.rs30 = relativeStrength(candles, btc, 30);
            c.rs90 = relativeStrength(candles, btc, 90);
        } catch {
            c.rs30 = c.rs90 = null;
        }
    }
    return scoreUniverse(coins, cfg);
}

// Trading universe: core coins plus the best-ranked altcoins.
function selectUniverse(ranked, cfg) {
    const out = [...cfg.core];
    for (const r of ranked) {
        if (out.length >= cfg.core.length + cfg.topN) break;
        if (r.score < cfg.minScore || out.includes(r.binanceSymbol)) continue;
        out.push(r.binanceSymbol);
    }
    return out;
}

module.exports = { scoreUniverse, scan, selectUniverse, percentileRanks, relativeStrength, hardFilter };
