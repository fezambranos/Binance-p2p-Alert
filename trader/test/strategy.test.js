const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateEntry, trailingStop, isBullishRegime } = require("../src/strategy");
const { makeConfig, candlesFromCloses, breakoutSeries } = require("./helpers");

const params = makeConfig().strategy;

test("signals a long on a breakout inside an uptrend, stop 2 ATR below", () => {
    const signal = evaluateEntry(breakoutSeries(), params);
    assert.equal(signal.signal, true, signal.reason);
    assert.ok(signal.stop < signal.entry);
    assert.ok(Math.abs(signal.entry - signal.stop - 2 * signal.atr) < 1e-9);
});

test("no signal in a downtrend", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 200 * Math.pow(0.997, i));
    const signal = evaluateEntry(candlesFromCloses(closes), params);
    assert.equal(signal.signal, false);
    assert.equal(signal.reason, "sin tendencia alcista");
});

test("no signal without enough history", () => {
    assert.equal(evaluateEntry(breakoutSeries().slice(-50), params).signal, false);
});

test("no signal when uptrend continues without breaking the recent high", () => {
    const candles = breakoutSeries().slice(0, -1);
    assert.equal(evaluateEntry(candles, params).reason, "sin ruptura");
});

test("trailing stop never moves down", () => {
    const candles = breakoutSeries();
    const low = trailingStop(candles, { stop: 1e9, highest: 1 }, params);
    assert.equal(low, 1e9);
    const raised = trailingStop(candles, { stop: 1, highest: candles.at(-1).close }, params);
    assert.ok(raised > 1);
});

test("regime is bullish above the slow EMA", () => {
    assert.equal(isBullishRegime(breakoutSeries(), params), true);
    const down = candlesFromCloses(Array.from({ length: 260 }, (_, i) => 200 * Math.pow(0.997, i)));
    assert.equal(isBullishRegime(down, params), false);
});
