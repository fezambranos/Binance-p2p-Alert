/**
 * backtest.js
 *
 * Replays historical candles through the same TradingEngine used live, with
 * a SimulatedBroker (fees + slippage). Stops are assumed to hit before
 * take-profits when both fall inside the same candle (conservative).
 * `exposureAt(time)` optionally plugs in Bot 1's walk-forward forecasts.
 */

const { TradingEngine } = require("./engine");
const { SimulatedBroker } = require("./brokers");
const { kellyStats } = require("./risk");

async function runBacktest({ config, data, regimeCandles, exposureAt }) {
    const broker = new SimulatedBroker({ feeRate: config.feeRate, slippage: config.slippage });
    const engine = new TradingEngine({ config, broker });
    const window = Math.max(config.strategy.emaSlow * 3, 300);

    const times = new Set();
    for (const candles of Object.values(data)) for (const c of candles) times.add(c.closeTime);
    const timeline = [...times].sort((a, b) => a - b);

    const indexBySymbol = Object.fromEntries(Object.keys(data).map((s) => [s, new Map(data[s].map((c, i) => [c.closeTime, i]))]));
    const regimeIndex = regimeCandles ? new Map(regimeCandles.map((c, i) => [c.closeTime, i])) : null;

    const equityCurve = [];
    for (const time of timeline) {
        if (exposureAt) engine.setExposure(exposureAt(time), time);
        if (regimeIndex?.has(time)) {
            const i = regimeIndex.get(time);
            engine.updateRegime(regimeCandles.slice(Math.max(0, i - window + 1), i + 1));
        }
        for (const [symbol, candles] of Object.entries(data)) {
            const i = indexBySymbol[symbol].get(time);
            if (i === undefined) continue;
            await engine.onPrice(symbol, candles[i], time);
            await engine.onBarClose(symbol, candles.slice(Math.max(0, i - window + 1), i + 1), time);
        }
        equityCurve.push({ time, equity: engine.totalEquity(), reserve: engine.state.reserve });
    }

    return { engine, equityCurve, metrics: computeMetrics(engine, equityCurve, config) };
}

function computeMetrics(engine, equityCurve, config) {
    const trades = engine.state.closedTrades;
    const initial = config.initialCapital;
    const final = equityCurve.at(-1)?.equity ?? initial;

    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
        peak = Math.max(peak, point.equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
    }

    const grossWin = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0));
    const years = equityCurve.length > 1 ? (equityCurve.at(-1).time - equityCurve[0].time) / (365.25 * 24 * 3600 * 1000) : 0;
    const stats = kellyStats(trades);

    return {
        initial,
        final,
        reserve: engine.state.reserve,
        totalReturn: final / initial - 1,
        cagr: years > 0 && final > 0 ? Math.pow(final / initial, 1 / years) - 1 : 0,
        years,
        maxDrawdown,
        trades: trades.length,
        winRate: stats.winRate,
        avgWinR: stats.avgWinR,
        avgLossR: stats.avgLossR,
        expectancyR: stats.expectancyR,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
        kelly: stats.kelly,
        halted: engine.state.halted,
        haltReason: engine.state.haltReason,
    };
}

module.exports = { runBacktest, computeMetrics };
