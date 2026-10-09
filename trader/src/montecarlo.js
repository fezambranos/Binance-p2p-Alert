/**
 * montecarlo.js
 *
 * Resamples trade outcomes (in R multiples) thousands of times through the
 * phase / drawdown risk rules to estimate the distribution of results:
 * how likely the kill switch is, how likely doubling is, typical drawdown.
 * A single backtest is one path; this shows the range of paths.
 */

const { tierFor, drawdownMultiplier } = require("./risk");

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function syntheticRs({ winRate, avgWinR, avgLossR }) {
    const wins = Math.round(winRate * 1000);
    return [...Array(wins).fill(avgWinR), ...Array(1000 - wins).fill(-avgLossR)];
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
}

function simulate({ rMultiples, trades = 200, paths = 5000, initialCapital, riskCfg, seed = 42 }) {
    if (!rMultiples.length) throw new Error("Se necesitan resultados de trades (R) para simular");
    const random = mulberry32(seed);
    const finals = [];
    const maxDrawdowns = [];
    let halts = 0;
    let doubled = 0;
    let tenX = 0;

    for (let p = 0; p < paths; p++) {
        let equity = initialCapital;
        let peak = equity;
        let maxDd = 0;
        for (let t = 0; t < trades; t++) {
            const dd = (peak - equity) / peak;
            const tier = tierFor(equity, riskCfg.tiers);
            const riskPct = tier.riskPerTrade * drawdownMultiplier(dd, riskCfg.drawdownThrottle);
            const r = rMultiples[Math.floor(random() * rMultiples.length)];
            equity = Math.max(0, equity * (1 + riskPct * r));
            peak = Math.max(peak, equity);
            maxDd = Math.max(maxDd, (peak - equity) / peak);
            if (maxDd >= riskCfg.haltDrawdown) {
                halts++;
                break;
            }
        }
        finals.push(equity);
        maxDrawdowns.push(maxDd);
        if (equity >= initialCapital * 2) doubled++;
        if (equity >= initialCapital * 10) tenX++;
    }

    finals.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);
    return {
        paths,
        trades,
        p5: percentile(finals, 0.05),
        p25: percentile(finals, 0.25),
        median: percentile(finals, 0.5),
        p75: percentile(finals, 0.75),
        p95: percentile(finals, 0.95),
        probHalt: halts / paths,
        probDouble: doubled / paths,
        probTenX: tenX / paths,
        probLoss: finals.filter((f) => f < initialCapital).length / paths,
        medianMaxDrawdown: percentile(maxDrawdowns, 0.5),
        p95MaxDrawdown: percentile(maxDrawdowns, 0.95),
    };
}

module.exports = { simulate, syntheticRs, mulberry32, percentile };
