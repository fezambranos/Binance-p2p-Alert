const test = require("node:test");
const assert = require("node:assert/strict");
const { runTournament, segmentStats } = require("../src/tournament");
const { loadConfig, applyVariant } = require("../src/config");
const { generateCandles } = require("../src/synthetic");
const { makeConfig } = require("./helpers");

test("segment stats: return and max drawdown", () => {
    const s = segmentStats([{ equity: 100 }, { equity: 120 }, { equity: 90 }, { equity: 110 }]);
    assert.ok(Math.abs(s.ret - 0.1) < 1e-12);
    assert.ok(Math.abs(s.maxDrawdown - 0.25) < 1e-12);
});

test("variants override the base config", () => {
    const cfg = applyVariant(makeConfig(), "rapida");
    assert.equal(cfg.strategy.breakoutLookback, 10);
    assert.equal(cfg.strategy.emaSlow, 200);
    assert.equal(cfg.variantName, "rapida");
    assert.throws(() => loadConfig({ variant: "nope" }), /Variante desconocida/);
});

test("tournament ranks variants on in-sample data and reports the holdout", async () => {
    const config = makeConfig({ symbols: ["AAAUSDT"], regimeSymbol: "AAAUSDT" });
    const data = { AAAUSDT: generateCandles({ bars: 1200, seed: 5 }) };
    const t = await runTournament({ config, data, regimeCandles: data.AAAUSDT, variants: ["base", "rapida", "lenta"], windows: 4 });
    assert.equal(t.results.length, 3);
    assert.ok(t.results[0].inSampleScore >= t.results[1].inSampleScore);
    assert.equal(t.results[0].windowReturns.length, 4);
    assert.equal(typeof t.winnerHoldsUp, "boolean");
});
