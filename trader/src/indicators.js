/**
 * indicators.js
 *
 * Minimal technical indicators over arrays. Every function returns an array
 * aligned with its input, with `null` where there is not enough history yet.
 */

function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;

    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    out[period - 1] = sum / period;

    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
        out[i] = values[i] * k + out[i - 1] * (1 - k);
    }
    return out;
}

// Wilder's Average True Range.
function atr(candles, period) {
    const out = new Array(candles.length).fill(null);
    if (candles.length < period + 1) return out;

    const tr = candles.map((c, i) => {
        if (i === 0) return c.high - c.low;
        const prevClose = candles[i - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    });

    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    out[period] = sum / period;
    for (let i = period + 1; i < candles.length; i++) {
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
    }
    return out;
}

// Highest value in values[end - lookback, end) — i.e. excluding index `end`.
function highestBefore(values, end, lookback) {
    if (end - lookback < 0) return null;
    let max = -Infinity;
    for (let i = end - lookback; i < end; i++) max = Math.max(max, values[i]);
    return max;
}

module.exports = { ema, atr, highestBefore };
