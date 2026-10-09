/**
 * strategy.js
 *
 * Long-only trend-following breakout ("buy strength, cut losers fast, let
 * winners run"). Operates on CLOSED candles only.
 *
 * Entry, all required:
 *   - close > EMA(slow) and EMA(fast) > EMA(slow)   → established uptrend
 *   - close > highest high of the previous N candles → breakout
 *   - ATR% inside [minAtrPct, maxAtrPct]            → not dead, not chaotic
 * Initial stop: close - stopAtr * ATR.
 * Management: partial take-profit at partialTakeR, then stop to breakeven,
 * and a chandelier trailing stop at highest-since-entry - trailAtr * ATR.
 */

const { ema, atr, highestBefore } = require("./indicators");

function minCandles(params) {
    return Math.max(params.emaSlow, params.breakoutLookback + 1, params.atrPeriod + 2);
}

function evaluateEntry(candles, params) {
    if (candles.length < minCandles(params)) return { signal: false, reason: "historial insuficiente" };

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const i = candles.length - 1;
    const close = closes[i];

    const fast = ema(closes, params.emaFast)[i];
    const slow = ema(closes, params.emaSlow)[i];
    const currentAtr = atr(candles, params.atrPeriod)[i];
    const breakoutLevel = highestBefore(highs, i, params.breakoutLookback);

    if (fast == null || slow == null || currentAtr == null) return { signal: false, reason: "indicadores sin datos" };
    if (!(close > slow && fast > slow)) return { signal: false, reason: "sin tendencia alcista" };
    if (!(close > breakoutLevel)) return { signal: false, reason: "sin ruptura" };

    const atrPct = currentAtr / close;
    if (atrPct < params.minAtrPct) return { signal: false, reason: "volatilidad demasiado baja" };
    if (atrPct > params.maxAtrPct) return { signal: false, reason: "volatilidad excesiva" };

    const stop = close - params.stopAtr * currentAtr;
    if (!(stop > 0)) return { signal: false, reason: "stop inválido" };

    return { signal: true, entry: close, stop, atr: currentAtr, reason: `ruptura de ${breakoutLevel}` };
}

// Returns the new stop (never lower than the current one).
function trailingStop(candles, position, params) {
    const currentAtr = atr(candles, params.atrPeriod).at(-1);
    if (currentAtr == null) return position.stop;
    const chandelier = position.highest - params.trailAtr * currentAtr;
    return Math.max(position.stop, chandelier);
}

function isBullishRegime(candles, params) {
    const closes = candles.map((c) => c.close);
    const slow = ema(closes, params.emaSlow).at(-1);
    if (slow == null) return true;
    return closes.at(-1) > slow;
}

module.exports = { evaluateEntry, trailingStop, isBullishRegime, minCandles };
