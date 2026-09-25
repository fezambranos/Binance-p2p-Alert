const test = require("node:test");
const assert = require("node:assert/strict");
const direction = require("../src/direction");
const { mulberry32 } = require("../src/montecarlo");
const { makeConfig } = require("./helpers");

const DAY = 864e5;

function series(closeAt, n) {
    const out = [];
    let prev = closeAt(0);
    for (let i = 0; i < n; i++) {
        const close = closeAt(i);
        out.push({ openTime: i * DAY, open: prev, high: Math.max(prev, close) * 1.005, low: Math.min(prev, close) * 0.995, close, closeTime: i * DAY + DAY - 1 });
        prev = close;
    }
    return out;
}

function randomWalk(n, seed) {
    const r = mulberry32(seed);
    let p = 100;
    return series(() => (p *= Math.exp(0.0005 + 0.05 * (r() - 0.5))), n);
}

// Slow, noisy cycles: direction is genuinely predictable from recent momentum.
function cycles(n, seed) {
    const r = mulberry32(seed);
    return series((i) => 100 * Math.exp(0.3 * Math.sin((2 * Math.PI * i) / 120) + 0.01 * (r() - 0.5)), n);
}

test("dataset labels look forward exactly `horizon` days and the last rows are unlabeled", () => {
    const candles = randomWalk(500, 1);
    const ds = direction.buildDataset(candles, { horizon: 7 });
    const i = ds.rows.findIndex((r) => r.time === candles[400].closeTime);
    assert.equal(ds.rows[i].y, candles[407].close > candles[400].close ? 1 : 0);
    assert.equal(ds.rows.at(-1).y, null);
    assert.equal(ds.rows.at(-8).y !== null, true);
    assert.equal(ds.names.length, ds.rows[0].x.length);
});

test("walk-forward never trains on labels unknown at prediction time", () => {
    const ds = direction.buildDataset(randomWalk(1200, 2), { horizon: 7 });
    const seen = [];
    const original = ds.rows;
    // Poison every label from index 700 on: predictions before 700+horizon must not change.
    const poisoned = { ...ds, rows: original.map((r, i) => (i >= 700 ? { ...r, y: 1 - (r.y ?? 0) } : r)) };
    const a = direction.walkForward(ds, { minTrain: 540 });
    const b = direction.walkForward(poisoned, { minTrain: 540 });
    for (let k = 0; k < a.length; k++) {
        const idx = original.findIndex((r) => r.time === a[k].time);
        if (idx < 700 + 7) seen.push(Math.abs(a[k].p - b[k].p) < 1e-12);
    }
    assert.ok(seen.length > 100);
    assert.ok(seen.every(Boolean));
});

test("on pure noise, validation passes rarely (false-positive rate ≤ 10%)", () => {
    // Any single noise series can look "significant" by luck — which is exactly
    // why a single 58% claim proves little. What matters is how often it happens.
    let passed = 0;
    const runs = 20;
    for (let seed = 1; seed <= runs; seed++) {
        const ds = direction.buildDataset(randomWalk(2000, seed), { horizon: 7 });
        if (direction.evaluate(direction.walkForward(ds, { minTrain: 540 }), { horizon: 7, simulations: 300 }).passed) passed++;
    }
    assert.ok(passed / runs <= 0.1, `${passed}/${runs} noise series passed`);
});

test("a genuinely predictable market passes validation", () => {
    const ds = direction.buildDataset(cycles(2000, 4), { horizon: 7 });
    const v = direction.evaluate(direction.walkForward(ds, { minTrain: 540 }), { horizon: 7, simulations: 1000 });
    assert.equal(v.passed, true, v.reasons.join("; "));
    assert.ok(v.accuracy > 0.7);
    assert.ok(v.pValue < 0.01);
});

test("probability bands map to exposure", () => {
    const bands = makeConfig().direction.bands;
    assert.equal(direction.exposureFromProbability(0.6, bands), 1);
    assert.equal(direction.exposureFromProbability(0.5, bands), 0.5);
    assert.equal(direction.exposureFromProbability(0.3, bands), 0);
});

test("unvalidated forecasts leave exposure at 1", () => {
    const f = direction.forecast(randomWalk(2000, 5), { ...makeConfig().direction, simulations: 500 });
    assert.equal(f.validated, false);
    assert.equal(f.exposure, 1);
    assert.ok(f.probability > 0 && f.probability < 1);
});

test("exposureSeries uses the latest forecast at or before a time", () => {
    const bands = makeConfig().direction.bands;
    const at = direction.exposureSeries([{ time: 10, p: 0.6 }, { time: 20, p: 0.3 }], bands);
    assert.equal(at(5), 1);
    assert.equal(at(15), 1);
    assert.equal(at(20), 0);
    assert.equal(at(99), 0);
});

test("optional funding and fear & greed features are included when provided", () => {
    const candles = randomWalk(500, 6);
    const funding = {};
    const fearGreed = {};
    for (const c of candles) {
        const key = direction.dayKey(c.closeTime);
        funding[key] = 0.0001;
        fearGreed[key] = 50;
    }
    const ds = direction.buildDataset(candles, { horizon: 7, extras: { funding, fearGreed } });
    assert.deepEqual(ds.names.slice(-2), ["funding7", "fearGreed"]);
    assert.equal(ds.rows[0].x.at(-1), 0.5);
});
