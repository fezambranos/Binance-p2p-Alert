/**
 * direction.js — Bot 1: BTC market direction.
 *
 * Estimates P(BTC is higher in `horizon` days) with a regularized logistic
 * regression over daily features, and — the important part — checks whether
 * that estimate deserves any trust:
 *
 *   - Walk-forward: every prediction is made by a model trained only on
 *     labels that were already known at that moment (no look-ahead).
 *   - Baseline: accuracy is compared with "always predict up", which in BTC
 *     is already above 50% because of its long-term drift.
 *   - Significance: thousands of random predictors (Monte Carlo) with the
 *     same up/down mix give the p-value of the observed accuracy, on
 *     non-overlapping periods so samples are not double counted.
 *   - Stability: the edge must appear in both halves of the test period;
 *     noise occasionally looks significant once, rarely twice.
 *
 * Only a model that passes validation is allowed to change risk exposure.
 */

const { ema } = require("./indicators");
const { mulberry32 } = require("./montecarlo");

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(time) {
    return new Date(time).toISOString().slice(0, 10);
}

function std(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

function rsi(closes, i, period = 14) {
    if (i < period) return null;
    let gain = 0;
    let loss = 0;
    for (let k = i - period + 1; k <= i; k++) {
        const d = closes[k] - closes[k - 1];
        if (d > 0) gain += d;
        else loss -= d;
    }
    if (gain + loss === 0) return 50;
    return (100 * gain) / (gain + loss);
}

/**
 * candles: daily candles, oldest first.
 * extras (optional): { funding: {"YYYY-MM-DD": rate}, fearGreed: {"YYYY-MM-DD": 0..100} }
 * Rows whose outcome is not known yet have y = null (used only for forecasting).
 */
function buildDataset(candles, { horizon = 7, extras = {} } = {}) {
    const closes = candles.map((c) => c.close);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const rets = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1])));
    const useFunding = extras.funding && Object.keys(extras.funding).length > 0;
    const useFng = extras.fearGreed && Object.keys(extras.fearGreed).length > 0;

    const names = ["ret7", "ret30", "ret90", "distEma50", "distEma200", "volRatio", "drawdown365", "rsi14"];
    if (useFunding) names.push("funding7");
    if (useFng) names.push("fearGreed");

    const rows = [];
    for (let i = 365; i < candles.length; i++) {
        if (ema200[i] == null) continue;
        let high = -Infinity;
        for (let k = i - 365; k <= i; k++) high = Math.max(high, closes[k]);
        const x = [
            closes[i] / closes[i - 7] - 1,
            closes[i] / closes[i - 30] - 1,
            closes[i] / closes[i - 90] - 1,
            closes[i] / ema50[i] - 1,
            closes[i] / ema200[i] - 1,
            std(rets.slice(i - 9, i + 1)) / (std(rets.slice(i - 59, i + 1)) || 1),
            closes[i] / high - 1,
            rsi(closes, i) / 100,
        ];
        const key = dayKey(candles[i].closeTime);
        if (useFunding) {
            const vals = [];
            for (let k = 0; k < 7; k++) {
                const v = extras.funding[dayKey(candles[i].closeTime - k * DAY_MS)];
                if (Number.isFinite(v)) vals.push(v);
            }
            x.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN);
        }
        if (useFng) x.push(Number.isFinite(extras.fearGreed[key]) ? extras.fearGreed[key] / 100 : NaN);

        const future = candles[i + horizon];
        rows.push({
            time: candles[i].closeTime,
            x,
            y: future ? (future.close > closes[i] ? 1 : 0) : null,
            fwdReturn: future ? future.close / closes[i] - 1 : null,
        });
    }
    return { names, rows, horizon };
}

function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

// Standardizes on the training rows; missing values become 0 (= training mean).
function trainLogistic(rows, { iterations = 400, learningRate = 0.1, l2 = 0.05 } = {}) {
    const d = rows[0].x.length;
    const mean = new Array(d).fill(0);
    const sd = new Array(d).fill(1);
    for (let j = 0; j < d; j++) {
        const col = rows.map((r) => r.x[j]).filter(Number.isFinite);
        mean[j] = col.length ? col.reduce((a, b) => a + b, 0) / col.length : 0;
        sd[j] = std(col) || 1;
    }
    const scale = (x) => x.map((v, j) => (Number.isFinite(v) ? (v - mean[j]) / sd[j] : 0));
    const X = rows.map((r) => scale(r.x));
    const Y = rows.map((r) => r.y);

    const w = new Array(d).fill(0);
    let b = 0;
    const n = X.length;
    for (let it = 0; it < iterations; it++) {
        const gw = new Array(d).fill(0);
        let gb = 0;
        for (let i = 0; i < n; i++) {
            let z = b;
            for (let j = 0; j < d; j++) z += w[j] * X[i][j];
            const err = sigmoid(z) - Y[i];
            for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
            gb += err;
        }
        for (let j = 0; j < d; j++) w[j] -= learningRate * (gw[j] / n + l2 * w[j]);
        b -= learningRate * (gb / n);
    }

    return {
        weights: w,
        bias: b,
        predict(x) {
            const s = scale(x);
            let z = b;
            for (let j = 0; j < d; j++) z += w[j] * s[j];
            return sigmoid(z);
        },
    };
}

/**
 * Retrains every `step` rows (days) on an expanding window. The training set stops
 * `horizon` rows before the prediction point, because those labels would
 * not have been known yet in real time.
 */
function walkForward(dataset, { minTrain = 540, step = 30, trainOptions } = {}) {
    const { rows, horizon } = dataset;
    const every = step;
    const predictions = [];
    for (let start = minTrain; start < rows.length; start += every) {
        const train = rows.slice(0, start - horizon + 1).filter((r) => r.y !== null);
        if (train.length < 100) continue;
        const model = trainLogistic(train, trainOptions);
        for (let i = start; i < Math.min(start + every, rows.length); i++) {
            predictions.push({ time: rows[i].time, p: model.predict(rows[i].x), y: rows[i].y, fwdReturn: rows[i].fwdReturn });
        }
    }
    return predictions;
}

function evaluate(predictions, { horizon = 7, simulations = 3000, seed = 42 } = {}) {
    // Non-overlapping sample: one prediction per horizon.
    const sample = predictions.filter((p, i) => p.y !== null && i % horizon === 0);
    const n = sample.length;
    if (n === 0) return { n: 0, passed: false, reasons: ["sin predicciones evaluables"] };

    const predictedUp = sample.map((p) => (p.p > 0.5 ? 1 : 0));
    const hits = sample.reduce((a, p, i) => a + (predictedUp[i] === p.y ? 1 : 0), 0);
    const accuracy = hits / n;
    const upRate = sample.reduce((a, p) => a + p.y, 0) / n;
    const baselineAccuracy = Math.max(upRate, 1 - upRate);
    const predictedUpRate = predictedUp.reduce((a, b) => a + b, 0) / n;

    const brier = sample.reduce((a, p) => a + (p.p - p.y) ** 2, 0) / n;
    const baselineBrier = sample.reduce((a, p) => a + (upRate - p.y) ** 2, 0) / n;

    // Monte Carlo: random predictors with the model's up/down mix.
    const random = mulberry32(seed);
    let atLeastAsGood = 0;
    for (let s = 0; s < simulations; s++) {
        let simHits = 0;
        for (const p of sample) simHits += ((random() < predictedUpRate ? 1 : 0) === p.y ? 1 : 0);
        if (simHits >= hits) atLeastAsGood++;
    }
    const pValue = (atLeastAsGood + 1) / (simulations + 1);

    // Does acting on it pay? Long when p > 0.5, cash otherwise, vs buy & hold.
    let strategy = 1;
    let hold = 1;
    for (const p of sample) {
        hold *= 1 + p.fwdReturn;
        if (p.p > 0.5) strategy *= 1 + p.fwdReturn;
    }

    // Stability: the edge must show up in both halves, not in one lucky stretch.
    const half = Math.floor(n / 2);
    const halfEdge = [sample.slice(0, half), sample.slice(half)].map((part) => {
        const ups = part.reduce((a, p) => a + p.y, 0) / part.length;
        const acc = part.reduce((a, p) => a + ((p.p > 0.5 ? 1 : 0) === p.y ? 1 : 0), 0) / part.length;
        return acc - Math.max(ups, 1 - ups);
    });

    const reasons = [];
    if (n < 40) reasons.push(`muestra pequeña (${n} periodos independientes)`);
    if (pValue >= 0.05) reasons.push(`no significativo (p=${pValue.toFixed(3)})`);
    if (accuracy < baselineAccuracy + 0.02) reasons.push("no supera a 'siempre alcista' por ≥2 puntos");
    if (brier >= baselineBrier) reasons.push("probabilidades peor calibradas que la tasa base");
    if (halfEdge.some((e) => e <= 0)) reasons.push("ventaja inestable (no aparece en ambas mitades del periodo)");

    return {
        n,
        accuracy,
        upRate,
        baselineAccuracy,
        brier,
        baselineBrier,
        pValue,
        simulations,
        halfEdge,
        strategyReturn: strategy - 1,
        holdReturn: hold - 1,
        passed: reasons.length === 0,
        reasons,
    };
}

function exposureFromProbability(p, bands) {
    for (const band of bands) if (p >= band.minProbability) return band.exposure;
    return 0;
}

// Latest forecast plus its validation. Unvalidated models return exposure 1 (no influence).
function forecast(candles, cfg, extras) {
    const dataset = buildDataset(candles, { horizon: cfg.horizon, extras });
    const labeled = dataset.rows.filter((r) => r.y !== null);
    if (labeled.length < cfg.minTrain + 100) {
        return { probability: null, exposure: 1, validated: false, reasons: ["historial insuficiente"] };
    }
    const predictions = walkForward(dataset, { minTrain: cfg.minTrain });
    const validation = evaluate(predictions, { horizon: cfg.horizon, simulations: cfg.simulations });
    const model = trainLogistic(labeled);
    const probability = model.predict(dataset.rows.at(-1).x);
    const exposure = validation.passed || !cfg.requireValidation ? exposureFromProbability(probability, cfg.bands) : 1;
    return {
        probability,
        exposure,
        validated: validation.passed,
        validation,
        features: dataset.names,
        time: dataset.rows.at(-1).time,
        predictions,
    };
}

// For backtests: exposure at any time from walk-forward predictions (no look-ahead).
function exposureSeries(predictions, bands) {
    const points = predictions.map((p) => ({ time: p.time, exposure: exposureFromProbability(p.p, bands) }));
    return function exposureAt(time) {
        let lo = 0;
        let hi = points.length - 1;
        let found = null;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (points[mid].time <= time) {
                found = points[mid];
                lo = mid + 1;
            } else hi = mid - 1;
        }
        return found ? found.exposure : 1;
    };
}

module.exports = { buildDataset, trainLogistic, walkForward, evaluate, exposureFromProbability, forecast, exposureSeries, dayKey };
