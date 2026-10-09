const test = require("node:test");
const assert = require("node:assert/strict");
const { TradingEngine } = require("../src/engine");
const { SimulatedBroker } = require("../src/brokers");
const { makeConfig, breakoutSeries, H4 } = require("./helpers");

function setup(overrides = {}) {
    const config = makeConfig({ slippage: 0, feeRate: 0, ...overrides });
    const broker = new SimulatedBroker({ feeRate: config.feeRate, slippage: config.slippage });
    const engine = new TradingEngine({ config, broker });
    return { config, engine };
}

async function openBreakout(engine) {
    const candles = breakoutSeries();
    const t = candles.at(-1).closeTime;
    engine.updateRegime(candles);
    await engine.onBarClose("BTCUSDT", candles, t);
    return { candles, t, pos: engine.state.positions.BTCUSDT };
}

test("opens a position risking the phase percentage", async () => {
    const { engine } = setup();
    const { pos } = await openBreakout(engine);
    assert.ok(pos, "position opened");
    const riskAmount = (pos.entry - pos.stop) * pos.qty;
    assert.ok(riskAmount <= 500 * 0.03 + 1e-9);
    assert.ok(pos.qty * pos.entry <= 500 * 0.6 + 1e-9);
    assert.equal(pos.tier, "Guerrilla");
});

test("does not enter when the regime is bearish", async () => {
    const { engine } = setup();
    const candles = breakoutSeries();
    engine.state.regimeBullish = false;
    await engine.onBarClose("BTCUSDT", candles, candles.at(-1).closeTime);
    assert.equal(Object.keys(engine.state.positions).length, 0);
});

test("stop hit closes the position for about -1R and books the loss", async () => {
    const { engine } = setup();
    const { t, pos } = await openBreakout(engine);
    const stop = pos.stop;
    await engine.onPrice("BTCUSDT", { open: pos.entry, high: pos.entry, low: stop * 0.99, close: stop * 0.99 }, t + H4);
    assert.equal(engine.state.positions.BTCUSDT, undefined);
    const trade = engine.state.closedTrades[0];
    assert.ok(Math.abs(trade.r + 1) < 1e-9);
    assert.ok(Math.abs(engine.totalEquity() - (500 + trade.pnl)) < 1e-9);
});

test("gap below the stop exits at the open, not at the stop", async () => {
    const { engine } = setup();
    const { t, pos } = await openBreakout(engine);
    const gap = pos.stop * 0.95;
    await engine.onPrice("BTCUSDT", { open: gap, high: gap, low: gap * 0.99, close: gap }, t + H4);
    assert.equal(engine.state.closedTrades[0].exit, gap);
});

test("partial take-profit at 2R then stop to breakeven, rest exits flat", async () => {
    const { engine } = setup();
    const { t, pos } = await openBreakout(engine);
    const { entry, target, initialQty } = pos;
    await engine.onPrice("BTCUSDT", { open: entry, high: target * 1.001, low: entry, close: target }, t + H4);
    const after = engine.state.positions.BTCUSDT;
    assert.ok(after.partialTaken);
    assert.ok(Math.abs(after.qty - initialQty / 2) < 1e-6);
    assert.equal(after.stop, entry);

    await engine.onPrice("BTCUSDT", { open: entry * 1.01, high: entry * 1.01, low: entry * 0.99, close: entry * 0.99 }, t + 2 * H4);
    assert.equal(engine.state.positions.BTCUSDT, undefined);
    const trade = engine.state.closedTrades[0];
    assert.ok(trade.pnl > 0);
    assert.ok(Math.abs(trade.r - 1) < 0.01, `r=${trade.r}`);
});

test("kill switch flattens positions and blocks new entries", async () => {
    const { engine } = setup();
    const { t, pos } = await openBreakout(engine);
    engine.state.peakEquity = 2000;
    await engine.onPrice("BTCUSDT", { open: pos.entry, high: pos.entry, low: pos.entry, close: pos.entry }, t + H4);
    assert.equal(engine.state.halted, true);
    assert.equal(Object.keys(engine.state.positions).length, 0);
    await openBreakout(engine);
    assert.equal(Object.keys(engine.state.positions).length, 0);
});

test("fees reduce cash on both legs", async () => {
    const { engine } = setup({ feeRate: 0.001 });
    const { t, pos } = await openBreakout(engine);
    const cost = pos.totalCost;
    assert.ok(cost > pos.qty * pos.entry);
    await engine.onPrice("BTCUSDT", { open: pos.entry, high: pos.entry, low: pos.stop, close: pos.stop }, t + H4);
    const trade = engine.state.closedTrades[0];
    assert.ok(trade.r < -1);
});
