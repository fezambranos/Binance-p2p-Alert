const test = require("node:test");
const assert = require("node:assert/strict");
const { simulate, syntheticRs } = require("../src/montecarlo");
const { runBacktest } = require("../src/backtest");
const { generateCandles } = require("../src/synthetic");
const { makeConfig } = require("./helpers");

const riskCfg = makeConfig().risk;

test("Monte Carlo is deterministic for a given seed", () => {
    const rMultiples = syntheticRs({ winRate: 0.4, avgWinR: 2.5, avgLossR: 1 });
    const a = simulate({ rMultiples, trades: 100, paths: 500, initialCapital: 500, riskCfg, seed: 7 });
    const b = simulate({ rMultiples, trades: 100, paths: 500, initialCapital: 500, riskCfg, seed: 7 });
    assert.deepEqual(a, b);
});

test("Monte Carlo: a positive edge grows the median, a negative one loses", () => {
    const good = simulate({ rMultiples: syntheticRs({ winRate: 0.45, avgWinR: 2.5, avgLossR: 1 }), trades: 150, paths: 1000, initialCapital: 500, riskCfg });
    const bad = simulate({ rMultiples: syntheticRs({ winRate: 0.3, avgWinR: 1.5, avgLossR: 1 }), trades: 150, paths: 1000, initialCapital: 500, riskCfg });
    assert.ok(good.median > 1000);
    assert.ok(bad.median < 500);
    assert.ok(bad.probHalt > good.probHalt);
});

test("backtest ledger is consistent: equity = cash + reserve + open positions", async () => {
    const config = makeConfig({ symbols: ["AAAUSDT", "BBBUSDT"], regimeSymbol: "AAAUSDT" });
    const data = { AAAUSDT: generateCandles({ bars: 1500, seed: 3 }), BBBUSDT: generateCandles({ bars: 1500, seed: 4 }) };
    const { engine, metrics, equityCurve } = await runBacktest({ config, data, regimeCandles: data.AAAUSDT });

    let positionsValue = 0;
    for (const [s, p] of Object.entries(engine.state.positions)) positionsValue += p.qty * engine.state.lastPrices[s];
    assert.ok(Math.abs(metrics.final - (engine.state.cash + engine.state.reserve + positionsValue)) < 1e-6);
    assert.ok(engine.state.cash >= 0);
    assert.ok(metrics.trades > 0);
    assert.equal(equityCurve.length, 1500);
    for (const t of engine.state.closedTrades) assert.ok(t.r > -1.5, `loss beyond stop: ${t.r}R`);
});
