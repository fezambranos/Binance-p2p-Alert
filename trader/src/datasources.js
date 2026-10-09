/**
 * datasources.js
 *
 * Free, public, raw data only — prices, volumes, supply, on-chain usage and
 * protocol revenue. No news, influencers or paid "signals": the inputs are
 * numbers anyone can audit.
 *
 *   Binance      prices, 24h volume, daily candles, perpetual funding rates
 *   CoinGecko    market cap, fully diluted valuation (dilution risk)
 *   DefiLlama    TVL and fees/revenue (real usage of a protocol or chain)
 *   alternative.me  Crypto Fear & Greed index (crowd sentiment)
 */

const { dayKey } = require("./direction");

async function getJson(url, fetchImpl = fetch) {
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
    return response.json();
}

async function coingeckoMarkets({ pages = 2, fetchImpl } = {}) {
    const out = [];
    for (let page = 1; page <= pages; page++) {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`;
        const rows = await getJson(url, fetchImpl);
        out.push(...rows.map((r) => ({
            id: r.id,
            symbol: String(r.symbol).toUpperCase(),
            name: r.name,
            marketCap: r.market_cap,
            fdv: r.fully_diluted_valuation,
            volume24h: r.total_volume,
        })));
    }
    return out;
}

// TVL, 30d TVL change and 30d fees keyed by CoinGecko id (protocols and chains).
async function defillamaFundamentals({ fetchImpl } = {}) {
    const [protocols, chains, fees] = await Promise.all([
        getJson("https://api.llama.fi/protocols", fetchImpl),
        getJson("https://api.llama.fi/v2/chains", fetchImpl),
        getJson("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true", fetchImpl).catch(() => ({ protocols: [] })),
    ]);

    const byGecko = {};
    const idToGecko = {};
    const nameToGecko = {};
    for (const p of protocols) {
        if (!p.gecko_id) continue;
        idToGecko[String(p.id)] = p.gecko_id;
        nameToGecko[String(p.name).toLowerCase()] = p.gecko_id;
        const entry = byGecko[p.gecko_id] || { tvl: 0, tvlChange30d: null, fees30d: null };
        entry.tvl += Number(p.tvl) || 0;
        const change = p.change_1m ?? p.change_7d;
        if (Number.isFinite(change) && entry.tvlChange30d == null) entry.tvlChange30d = change / 100;
        byGecko[p.gecko_id] = entry;
    }
    for (const c of chains) {
        if (!c.gecko_id) continue;
        const entry = byGecko[c.gecko_id] || { tvl: 0, tvlChange30d: null, fees30d: null };
        entry.tvl = Math.max(entry.tvl, Number(c.tvl) || 0);
        byGecko[c.gecko_id] = entry;
    }
    for (const f of fees.protocols || []) {
        const gecko = f.gecko_id || idToGecko[String(f.defillamaId)] || nameToGecko[String(f.name).toLowerCase()];
        if (!gecko || !Number.isFinite(f.total30d)) continue;
        const entry = byGecko[gecko] || { tvl: 0, tvlChange30d: null, fees30d: null };
        entry.fees30d = (entry.fees30d || 0) + f.total30d;
        byGecko[gecko] = entry;
    }
    return byGecko;
}

async function binanceTickers24h({ fetchImpl, baseUrl = "https://api.binance.com" } = {}) {
    const rows = await getJson(`${baseUrl}/api/v3/ticker/24hr`, fetchImpl);
    return Object.fromEntries(rows.map((r) => [r.symbol, { quoteVolume: Number(r.quoteVolume), lastPrice: Number(r.lastPrice) }]));
}

// Daily average funding rate of the BTC perpetual (positive = longs crowded).
async function binanceFunding({ symbol = "BTCUSDT", startTime, fetchImpl } = {}) {
    const byDay = {};
    let cursor = startTime ?? Date.UTC(2019, 8, 10);
    for (let guard = 0; guard < 50; guard++) {
        const rows = await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000&startTime=${cursor}`, fetchImpl);
        if (!rows.length) break;
        for (const r of rows) {
            const key = dayKey(r.fundingTime);
            (byDay[key] = byDay[key] || []).push(Number(r.fundingRate));
        }
        cursor = rows.at(-1).fundingTime + 1;
        if (rows.length < 1000) break;
    }
    return Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}

async function fearGreedHistory({ fetchImpl } = {}) {
    const body = await getJson("https://api.alternative.me/fng/?limit=0&format=json", fetchImpl);
    return Object.fromEntries((body.data || []).map((d) => [dayKey(Number(d.timestamp) * 1000), Number(d.value)]));
}

module.exports = { getJson, coingeckoMarkets, defillamaFundamentals, binanceTickers24h, binanceFunding, fearGreedHistory };
