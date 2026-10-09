/**
 * risk.js
 *
 * Capital-phase risk management. Pure functions over the engine state.
 *
 * Effective risk per trade =
 *     min(phase risk, fractional Kelly once there is history)
 *   x drawdown multiplier
 * and every entry must also pass the circuit breakers in `canOpen`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function dayKey(time) {
    return new Date(time).toISOString().slice(0, 10);
}

function tierFor(totalEquity, tiers) {
    return tiers.find((t) => t.upTo == null || totalEquity < t.upTo) || tiers.at(-1);
}

function drawdownOf(state, totalEquity) {
    if (!(state.peakEquity > 0)) return 0;
    return Math.max(0, (state.peakEquity - totalEquity) / state.peakEquity);
}

function drawdownMultiplier(drawdown, throttle) {
    let multiplier = 1;
    for (const step of throttle) {
        if (drawdown >= step.drawdown) multiplier = Math.min(multiplier, step.multiplier);
    }
    return multiplier;
}

function kellyStats(trades) {
    const rs = trades.map((t) => t.r).filter(Number.isFinite);
    const wins = rs.filter((r) => r > 0);
    const losses = rs.filter((r) => r <= 0);
    const n = rs.length;
    if (n === 0) return { n, winRate: 0, avgWinR: 0, avgLossR: 0, payoff: 0, kelly: 0, expectancyR: 0 };

    const winRate = wins.length / n;
    const avgWinR = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLossR = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const payoff = avgLossR > 0 ? avgWinR / avgLossR : Infinity;
    const kelly = payoff === Infinity ? winRate : winRate - (1 - winRate) / payoff;
    const expectancyR = rs.reduce((a, b) => a + b, 0) / n;
    return { n, winRate, avgWinR, avgLossR, payoff, kelly, expectancyR };
}

function effectiveRisk(state, totalEquity, riskCfg) {
    const tier = tierFor(totalEquity, riskCfg.tiers);
    const notes = [];
    let base = tier.riskPerTrade;

    const stats = kellyStats(state.closedTrades || []);
    if (stats.n >= riskCfg.kelly.minTrades) {
        if (stats.kelly <= 0) {
            base = Math.min(base, riskCfg.kelly.noEdgeRisk);
            notes.push(`sin ventaja estadística en ${stats.n} trades: riesgo mínimo`);
        } else if (stats.kelly * riskCfg.kelly.fraction < base) {
            base = stats.kelly * riskCfg.kelly.fraction;
            notes.push(`limitado por Kelly fraccional (${(stats.kelly * 100).toFixed(1)}% Kelly)`);
        }
    }

    const drawdown = drawdownOf(state, totalEquity);
    let multiplier = drawdownMultiplier(drawdown, riskCfg.drawdownThrottle);
    if (multiplier < 1) notes.push(`drawdown ${(drawdown * 100).toFixed(1)}%: riesgo x${multiplier}`);

    const decay = alphaDecay(state.closedTrades || [], riskCfg.alphaDecay);
    if (decay.decaying) {
        multiplier *= riskCfg.alphaDecay.multiplier;
        notes.push(`pérdida de efectividad: ${decay.expectancyR.toFixed(2)}R en los últimos ${decay.window} trades`);
    }

    const exposure = Number.isFinite(state.exposure) ? state.exposure : 1;
    if (exposure < 1) notes.push(`Bot 1 (dirección): exposición x${exposure}`);

    return { pct: base * multiplier * exposure, tier, drawdown, multiplier, exposure, decay, notes, stats };
}

// Alpha decay: the recent trades stopped paying even if the long history still does.
function alphaDecay(trades, cfg) {
    if (!cfg || trades.length < cfg.window) return { decaying: false };
    const recent = trades.slice(-cfg.window).map((t) => t.r).filter(Number.isFinite);
    const expectancyR = recent.reduce((a, b) => a + b, 0) / recent.length;
    return { decaying: expectancyR < cfg.minExpectancyR, expectancyR, window: cfg.window };
}

// Rolls the daily window, tracks the peak and trips the kill switch.
function updateEquity(state, totalEquity, time, riskCfg) {
    const key = dayKey(time);
    if (state.dayKey !== key) {
        state.dayKey = key;
        state.dayStartEquity = totalEquity;
    }
    state.peakEquity = Math.max(state.peakEquity || 0, totalEquity);

    const drawdown = drawdownOf(state, totalEquity);
    if (!state.halted && drawdown >= riskCfg.haltDrawdown) {
        state.halted = true;
        state.haltReason = `drawdown ${(drawdown * 100).toFixed(1)}% >= ${(riskCfg.haltDrawdown * 100).toFixed(0)}%`;
        return { newlyHalted: true, reason: state.haltReason };
    }
    return { newlyHalted: false };
}

function canOpen(state, { totalEquity, tradingEquity, openPositions, openRisk, time }, riskCfg) {
    if (state.halted) return { ok: false, reason: `detenido: ${state.haltReason}` };
    if (state.cooldownUntil && time < state.cooldownUntil) {
        return { ok: false, reason: `enfriamiento tras ${riskCfg.maxConsecutiveLosses} pérdidas seguidas` };
    }
    if (state.dayStartEquity > 0) {
        const dayLoss = (state.dayStartEquity - totalEquity) / state.dayStartEquity;
        if (dayLoss >= riskCfg.dailyLossLimit) return { ok: false, reason: "límite de pérdida diaria alcanzado" };
    }
    const tier = tierFor(totalEquity, riskCfg.tiers);
    if (openPositions >= tier.maxOpenPositions) return { ok: false, reason: `máximo de posiciones (${tier.maxOpenPositions})` };
    if (tradingEquity > 0 && openRisk / tradingEquity >= riskCfg.maxTotalOpenRisk) {
        return { ok: false, reason: "riesgo abierto total al máximo" };
    }
    return { ok: true };
}

function sizePosition({ tradingEquity, cash, entry, stop, riskPct, openRisk, feeRate }, riskCfg) {
    const riskPerUnit = entry - stop;
    if (!(riskPerUnit > 0) || !(entry > 0)) return { qty: 0, riskAmount: 0, notional: 0 };

    const riskBudget = Math.max(0, riskCfg.maxTotalOpenRisk * tradingEquity - openRisk);
    const riskAmount = Math.min(tradingEquity * riskPct, riskBudget);
    let qty = riskAmount / riskPerUnit;

    const maxNotional = Math.min(tradingEquity * riskCfg.maxPositionPct, cash / (1 + 2 * feeRate));
    if (qty * entry > maxNotional) qty = maxNotional / entry;
    if (!(qty > 0)) return { qty: 0, riskAmount: 0, notional: 0 };

    return { qty, riskAmount: qty * riskPerUnit, notional: qty * entry };
}

function recordTradeClosed(state, trade, riskCfg, maxHistory = 500) {
    state.closedTrades = state.closedTrades || [];
    state.closedTrades.push(trade);
    if (state.closedTrades.length > maxHistory) state.closedTrades.splice(0, state.closedTrades.length - maxHistory);

    state.consecutiveLosses = trade.pnl < 0 ? (state.consecutiveLosses || 0) + 1 : 0;
    if (state.consecutiveLosses >= riskCfg.maxConsecutiveLosses) {
        state.cooldownUntil = trade.closedAt + riskCfg.cooldownHours * HOUR_MS;
        state.consecutiveLosses = 0;
    }
}

// Moves part of the gains to a reserve the bot will never trade. Returns the amount locked.
function applyProfitLock(state, tradingEquity, riskCfg) {
    const lock = riskCfg.profitLock;
    if (!lock || !lock.enabled) return 0;
    if (!(state.lockBase > 0)) state.lockBase = tradingEquity;
    if (tradingEquity < state.lockBase * (1 + lock.triggerGain)) return 0;

    const amount = Math.min((tradingEquity - state.lockBase) * lock.lockFraction, state.cash);
    if (!(amount > 0)) return 0;
    state.cash -= amount;
    state.reserve = (state.reserve || 0) + amount;
    state.lockBase = tradingEquity - amount;
    return amount;
}

function resetHalt(state, totalEquity) {
    state.halted = false;
    state.haltReason = null;
    state.peakEquity = totalEquity;
    state.cooldownUntil = null;
    state.consecutiveLosses = 0;
}

module.exports = {
    DAY_MS,
    HOUR_MS,
    dayKey,
    tierFor,
    drawdownOf,
    drawdownMultiplier,
    kellyStats,
    effectiveRisk,
    alphaDecay,
    updateEquity,
    canOpen,
    sizePosition,
    recordTradeClosed,
    applyProfitLock,
    resetHalt,
};
