const test = require("node:test");
const assert = require("node:assert/strict");
const { ema, atr, highestBefore } = require("../src/indicators");
const { candlesFromCloses } = require("./helpers");

test("ema of a constant series is the constant, null before warm-up", () => {
    const out = ema(Array(10).fill(5), 3);
    assert.equal(out[0], null);
    assert.equal(out[1], null);
    assert.equal(out[2], 5);
    assert.equal(out[9], 5);
});

test("ema follows a rising series from below", () => {
    const values = Array.from({ length: 50 }, (_, i) => i);
    const out = ema(values, 10);
    assert.ok(out[49] < 49 && out[49] > 40);
});

test("atr of flat candles equals the constant high-low range", () => {
    const candles = Array.from({ length: 30 }, () => ({ open: 100, high: 101, low: 99, close: 100 }));
    const out = atr(candles, 14);
    assert.equal(out[13], null);
    assert.ok(Math.abs(out[29] - 2) < 1e-9);
});

test("highestBefore excludes the current index", () => {
    assert.equal(highestBefore([1, 5, 3, 9], 3, 3), 5);
    assert.equal(highestBefore([1, 5, 3, 9], 1, 3), null);
});

test("atr needs period + 1 candles", () => {
    assert.equal(atr(candlesFromCloses([1, 2, 3]), 14).at(-1), null);
});
