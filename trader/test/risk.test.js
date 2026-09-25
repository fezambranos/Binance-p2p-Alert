const test = require("node:test");
const assert = require("node:assert/strict");
const risk = require("../src/risk");
const { makeConfig } = require("./helpers");

const cfg = makeConfig().risk;
const T0 = Date.UTC(2024, 0, 1, 12);

function baseState(extra = {}) {
    return { cash: 500, reserve: 0, peakEquity: 500, dayKey: risk.dayKey(T0), dayStartEquity: 500, closedTrades: [], ...extra };
}

test("capital phases get more conservative as equity grows", () => {
    assert.equal(risk.tierFor(500, cfg.tiers).name, "Guerrilla");
    assert.equal(risk.tierFor(1000, cfg.tiers).name, "Expansión");
    assert.equal(risk.tierFor(3000, cfg.tiers).name, "Consolidación");
    assert.equal(risk.tierFor(1e6, cfg.tiers).name, "Preservación");
});

test("drawdown throttle halves then quarters risk", () => {
    assert.equal(risk.drawdownMultiplier(0.05, cfg.drawdownThrottle), 1);
    assert.equal(risk.drawdownMultiplier(0.12, cfg.drawdownThrottle), 0.5);
    assert.equal(risk.drawdownMultiplier(0.25, cfg.drawdownThrottle), 0.25);
});

test("effective risk: phase risk, cut by drawdown", () => {
    assert.equal(risk.effectiveRisk(baseState(), 500, cfg).pct, 0.03);
    const eff = risk.effectiveRisk(baseState({ peakEquity: 600 }), 500, cfg);
    assert.ok(Math.abs(eff.pct - 0.015) < 1e-12);
});

test("effective risk drops to the floor when history shows no edge", () => {
    const trades = Array.from({ length: 40 }, (_, i) => ({ r: i % 4 === 0 ? 1 : -1 }));
    const eff = risk.effectiveRisk(baseState({ closedTrades: trades }), 500, cfg);
    assert.equal(eff.pct, cfg.kelly.noEdgeRisk);
});

test("effective risk capped by half Kelly with a small edge", () => {
    // 50% win, payoff 1.2 → Kelly = 0.5 - 0.5/1.2 ≈ 8.3%, half ≈ 4.2% > 3% phase risk.
    const good = Array.from({ length: 40 }, (_, i) => ({ r: i % 2 ? 1.2 : -1 }));
    assert.equal(risk.effectiveRisk(baseState({ closedTrades: good }), 500, cfg).pct, 0.03);
    // 40% win, payoff 1.6 → Kelly = 0.4 - 0.6/1.6 = 2.5%, half = 1.25%.
    const thin = Array.from({ length: 40 }, (_, i) => ({ r: i % 5 < 2 ? 1.6 : -1 }));
    assert.ok(Math.abs(risk.effectiveRisk(baseState({ closedTrades: thin }), 500, cfg).pct - 0.0125) < 1e-9);
});

test("position size risks the requested fraction of equity", () => {
    const s = risk.sizePosition({ tradingEquity: 500, cash: 500, entry: 100, stop: 90, riskPct: 0.03, openRisk: 0, feeRate: 0.001 }, cfg);
    assert.ok(Math.abs(s.riskAmount - 15) < 1e-9);
    assert.ok(Math.abs(s.qty - 1.5) < 1e-9);
});

test("position size is capped by max notional and by the open-risk budget", () => {
    const tight = risk.sizePosition({ tradingEquity: 500, cash: 500, entry: 100, stop: 99, riskPct: 0.03, openRisk: 0, feeRate: 0.001 }, cfg);
    assert.ok(tight.notional <= 500 * cfg.maxPositionPct + 1e-9);
    const budget = risk.sizePosition({ tradingEquity: 500, cash: 500, entry: 100, stop: 90, riskPct: 0.03, openRisk: 35, feeRate: 0.001 }, cfg);
    assert.ok(Math.abs(budget.riskAmount - 5) < 1e-9);
    const broke = risk.sizePosition({ tradingEquity: 500, cash: 0, entry: 100, stop: 90, riskPct: 0.03, openRisk: 0, feeRate: 0.001 }, cfg);
    assert.equal(broke.qty, 0);
});

test("circuit breakers block new entries", () => {
    const ctx = { totalEquity: 500, tradingEquity: 500, openPositions: 0, openRisk: 0, time: T0 };
    assert.equal(risk.canOpen(baseState(), ctx, cfg).ok, true);
    assert.equal(risk.canOpen(baseState({ halted: true, haltReason: "x" }), ctx, cfg).ok, false);
    assert.equal(risk.canOpen(baseState({ cooldownUntil: T0 + 1 }), ctx, cfg).ok, false);
    assert.equal(risk.canOpen(baseState({ dayStartEquity: 540 }), ctx, cfg).ok, false);
    assert.equal(risk.canOpen(baseState(), { ...ctx, openPositions: 2 }, cfg).ok, false);
    assert.equal(risk.canOpen(baseState(), { ...ctx, openRisk: 40 }, cfg).ok, false);
});

test("consecutive losses trigger a cooldown", () => {
    const state = baseState();
    for (let i = 0; i < cfg.maxConsecutiveLosses; i++) risk.recordTradeClosed(state, { pnl: -1, r: -1, closedAt: T0 }, cfg);
    assert.equal(state.cooldownUntil, T0 + cfg.cooldownHours * risk.HOUR_MS);
    assert.equal(state.consecutiveLosses, 0);
});

test("a win resets the losing streak", () => {
    const state = baseState();
    risk.recordTradeClosed(state, { pnl: -1, r: -1, closedAt: T0 }, cfg);
    risk.recordTradeClosed(state, { pnl: 2, r: 2, closedAt: T0 }, cfg);
    assert.equal(state.consecutiveLosses, 0);
});

test("kill switch trips at the halt drawdown and resets on demand", () => {
    const state = baseState({ peakEquity: 1000 });
    assert.equal(risk.updateEquity(state, 750, T0, cfg).newlyHalted, false);
    assert.equal(risk.updateEquity(state, 690, T0, cfg).newlyHalted, true);
    assert.equal(state.halted, true);
    assert.equal(risk.updateEquity(state, 600, T0, cfg).newlyHalted, false);
    risk.resetHalt(state, 600);
    assert.equal(state.halted, false);
    assert.equal(state.peakEquity, 600);
});

test("daily window rolls over at UTC midnight", () => {
    const state = baseState();
    risk.updateEquity(state, 480, T0 + risk.DAY_MS, cfg);
    assert.equal(state.dayStartEquity, 480);
});

test("profit lock moves part of the gain to reserve", () => {
    const state = baseState({ lockBase: 500 });
    assert.equal(risk.applyProfitLock(state, 700, cfg), 0);
    state.cash = 750;
    const locked = risk.applyProfitLock(state, 750, cfg);
    assert.ok(Math.abs(locked - 75) < 1e-9);
    assert.ok(Math.abs(state.reserve - 75) < 1e-9);
    assert.ok(Math.abs(state.cash - 675) < 1e-9);
    assert.ok(Math.abs(state.lockBase - 675) < 1e-9);
});

test("profit lock only takes available cash", () => {
    const state = baseState({ lockBase: 500, cash: 10 });
    assert.equal(risk.applyProfitLock(state, 1000, cfg), 10);
});
