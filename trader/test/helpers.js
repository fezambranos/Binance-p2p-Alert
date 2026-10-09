const { DEFAULTS, deepMerge } = require("../src/config");

const H4 = 4 * 3600 * 1000;

function makeConfig(overrides = {}) {
    return deepMerge(DEFAULTS, overrides);
}

// Candles from a list of closes; high/low are +/- `spread` around open/close.
function candlesFromCloses(closes, { spread = 0.005, startTime = Date.UTC(2024, 0, 1) } = {}) {
    return closes.map((close, i) => {
        const open = i === 0 ? close : closes[i - 1];
        const openTime = startTime + i * H4;
        return {
            openTime,
            open,
            high: Math.max(open, close) * (1 + spread),
            low: Math.min(open, close) * (1 - spread),
            close,
            volume: 0,
            closeTime: openTime + H4 - 1,
        };
    });
}

// Steady uptrend with a pullback, finishing on a fresh breakout candle.
function breakoutSeries() {
    const closes = [];
    let p = 100;
    for (let i = 0; i < 260; i++) {
        p *= 1.003 + (i % 2 === 0 ? 0.004 : -0.004);
        closes.push(p);
    }
    for (let i = 0; i < 10; i++) closes.push(closes.at(-1) * 0.995);
    const peak = Math.max(...closes);
    closes.push(peak * 1.02);
    return candlesFromCloses(closes);
}

module.exports = { H4, makeConfig, candlesFromCloses, breakoutSeries };
