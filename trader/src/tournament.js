/**
 * tournament.js
 *
 * Runs 3–5 strategy variants over the same history and judges them the way
 * that resists overfitting:
 *   - the winner is chosen ONLY on the in-sample period (first part);
 *   - it is then judged on a holdout period it never "saw" (last part);
 *   - consistency across time windows matters more than total return.
 * Testing many variants and keeping the best one guarantees a flattering
 * backtest; the holdout is what tells you whether it was luck.
 */

const { runBacktest } = require("./backtest");
const { applyVariant } = require("./config");

function segmentStats(curve) {
    if (curve.length < 2) return { ret: 0, maxDrawdown: 0 };
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const p of curve) {
        peak = Math.max(peak, p.equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - p.equity) / peak);
    }
    return { ret: curve.at(-1).equity / curve[0].equity - 1, maxDrawdown };
}

// Return / drawdown, floored so tiny drawdowns don't dominate.
function robustScore(stats) {
    return stats.ret / Math.max(stats.maxDrawdown, 0.05);
}

async function runTournament({ config, data, regimeCandles, exposureAt, windows = 6, holdoutFraction = 0.3, variants }) {
    const names = variants || Object.keys(config.variants || { base: {} });
    const results = [];
    for (const name of names) {
        const cfg = applyVariant(config, name);
        const { metrics, equityCurve } = await runBacktest({ config: cfg, data, regimeCandles, exposureAt });

        const split = Math.floor(equityCurve.length * (1 - holdoutFraction));
        const inSample = segmentStats(equityCurve.slice(0, split + 1));
        const holdout = segmentStats(equityCurve.slice(split));

        const size = Math.floor(equityCurve.length / windows);
        const windowReturns = [];
        for (let w = 0; w < windows && size > 1; w++) {
            windowReturns.push(segmentStats(equityCurve.slice(w * size, (w + 1) * size + 1)).ret);
        }

        results.push({
            name,
            metrics,
            inSample,
            holdout,
            inSampleScore: robustScore(inSample),
            windowReturns,
            positiveWindows: windowReturns.filter((r) => r > 0).length / (windowReturns.length || 1),
            worstWindow: Math.min(...windowReturns),
            splitTime: equityCurve[split]?.time,
        });
    }
    results.sort((a, b) => b.inSampleScore - a.inSampleScore);
    const winner = results[0];
    return {
        results,
        winner: winner?.name,
        winnerHoldsUp: winner ? winner.holdout.ret > 0 && winner.holdout.maxDrawdown < config.risk.haltDrawdown : false,
    };
}

module.exports = { runTournament, segmentStats, robustScore };
