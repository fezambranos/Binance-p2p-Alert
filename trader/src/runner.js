/**
 * runner.js
 *
 * Paper / live loop. Every `pollSeconds` it checks prices for stop and
 * take-profit hits; when a new candle closes it runs trailing stops and
 * entry signals. State is saved to disk after every cycle, so the bot can be
 * restarted without losing its ledger.
 */

const fs = require("node:fs");
const path = require("node:path");
const { TradingEngine, initialState } = require("./engine");

function statePath(config) {
    const suffix = config.mode === "live" ? (config.testnet ? "testnet" : "live") : "paper";
    const variant = config.variantName ? `-${config.variantName}` : "";
    return path.join(__dirname, "..", "state", `${suffix}${variant}.json`);
}

function loadState(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveState(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
}

/**
 * refreshDirection(): Promise<{ exposure, probability, validated }>  (Bot 1)
 * refreshUniverse(): Promise<string[]>                              (Bot 2)
 * Both are optional; when they fail the previous value is kept.
 */
async function runLoop({ config, client, broker, log, notify, signal, refreshDirection, refreshUniverse }) {
    const file = statePath(config);
    const state = loadState(file) || initialState(config);
    const onEvent = (e) => {
        log(e);
        notify(e);
    };
    const engine = new TradingEngine({ config, broker, state, log: onEvent });
    state.lastBarClose = state.lastBarClose || {};
    state.universe = state.universe || config.symbols;

    log({ type: "start", mode: config.mode, variant: config.variantName, testnet: config.testnet, symbols: state.universe, equity: engine.totalEquity() });

    while (!signal?.aborted) {
        const now = Date.now();
        try {
            if (refreshUniverse && isDue(state.universeUpdatedAt, config.scanner.refreshHours, now)) {
                const universe = await refreshUniverse();
                if (universe?.length) {
                    if (broker.loadFilters) await broker.loadFilters(universe);
                    state.universe = universe;
                    onEvent({ type: "universe", time: now, symbols: universe });
                }
                state.universeUpdatedAt = now;
            }
            if (refreshDirection && isDue(state.directionUpdatedAt, config.direction.refreshHours, now)) {
                const d = await refreshDirection();
                state.direction = { probability: d.probability, validated: d.validated, reasons: d.validation?.reasons, at: now };
                engine.setExposure(d.exposure, now, { probability: d.probability, validated: d.validated });
                state.directionUpdatedAt = now;
            }

            // Symbols with open positions stay managed even if they left the universe.
            const traded = [...new Set([...state.universe, ...Object.keys(state.positions)])];
            for (const symbol of traded) {
                const price = await client.tickerPrice(symbol);
                await engine.onPrice(symbol, { open: price, high: price, low: price, close: price }, now);
            }

            for (const symbol of [...new Set([config.regimeSymbol, ...traded].filter(Boolean))]) {
                const candles = (await client.klines(symbol, config.interval, { limit: 600 })).filter((c) => c.closeTime < now);
                const lastClose = candles.at(-1)?.closeTime;
                if (!lastClose || lastClose === state.lastBarClose[symbol]) continue;
                state.lastBarClose[symbol] = lastClose;
                if (symbol === config.regimeSymbol) engine.updateRegime(candles);
                if (traded.includes(symbol)) await engine.onBarClose(symbol, candles, now);
            }
        } catch (err) {
            onEvent({ type: "error", time: now, message: err.message });
        }
        saveState(file, state);
        await sleep(config.pollSeconds * 1000, signal);
    }
    saveState(file, state);
}

function isDue(lastAt, hours, now) {
    return !lastAt || now - lastAt >= hours * 3600 * 1000;
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

module.exports = { runLoop, statePath, loadState, saveState };
