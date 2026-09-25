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
    return path.join(__dirname, "..", "state", `${suffix}.json`);
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

async function runLoop({ config, client, broker, log, notify, signal }) {
    const file = statePath(config);
    const state = loadState(file) || initialState(config);
    const onEvent = (e) => {
        log(e);
        notify(e);
    };
    const engine = new TradingEngine({ config, broker, state, log: onEvent });
    const symbols = [...new Set([config.regimeSymbol, ...config.symbols].filter(Boolean))];
    state.lastBarClose = state.lastBarClose || {};

    log({ type: "start", mode: config.mode, testnet: config.testnet, symbols: config.symbols, equity: engine.totalEquity() });

    while (!signal?.aborted) {
        const now = Date.now();
        try {
            for (const symbol of config.symbols) {
                const price = await client.tickerPrice(symbol);
                await engine.onPrice(symbol, { open: price, high: price, low: price, close: price }, now);
            }

            for (const symbol of symbols) {
                const candles = (await client.klines(symbol, config.interval, { limit: 600 })).filter((c) => c.closeTime < now);
                const lastClose = candles.at(-1)?.closeTime;
                if (!lastClose || lastClose === state.lastBarClose[symbol]) continue;
                state.lastBarClose[symbol] = lastClose;
                if (symbol === config.regimeSymbol) engine.updateRegime(candles);
                if (config.symbols.includes(symbol)) await engine.onBarClose(symbol, candles, now);
            }
        } catch (err) {
            onEvent({ type: "error", time: now, message: err.message });
        }
        saveState(file, state);
        await sleep(config.pollSeconds * 1000, signal);
    }
    saveState(file, state);
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
