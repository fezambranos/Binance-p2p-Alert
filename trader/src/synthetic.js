/**
 * synthetic.js
 *
 * Regime-switching random walk candles, for tests and for trying the
 * backtester offline. NOT evidence that the strategy works on real markets.
 */

const { mulberry32 } = require("./montecarlo");

function gaussian(random) {
    const u = Math.max(random(), 1e-12);
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function generateCandles({ bars = 3000, start = 100, intervalMs = 4 * 3600 * 1000, startTime = Date.UTC(2022, 0, 1), seed = 1 } = {}) {
    const random = mulberry32(seed);
    const regimes = [
        { drift: 0.002, vol: 0.02 },
        { drift: -0.0015, vol: 0.025 },
        { drift: 0, vol: 0.012 },
    ];
    let regime = regimes[2];
    let price = start;
    const out = [];
    for (let i = 0; i < bars; i++) {
        if (random() < 0.01) regime = regimes[Math.floor(random() * regimes.length)];
        const open = price;
        const close = Math.max(0.0001, open * Math.exp(regime.drift + regime.vol * gaussian(random)));
        const high = Math.max(open, close) * (1 + Math.abs(gaussian(random)) * regime.vol * 0.4);
        const low = Math.min(open, close) * (1 - Math.abs(gaussian(random)) * regime.vol * 0.4);
        const openTime = startTime + i * intervalMs;
        out.push({ openTime, open, high, low, close, volume: 0, closeTime: openTime + intervalMs - 1 });
        price = close;
    }
    return out;
}

module.exports = { generateCandles };
