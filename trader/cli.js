#!/usr/bin/env node
/**
 * cli.js — entry point.
 *
 *   node cli.js plan                         Show the risk phases and rules
 *   node cli.js backtest [--from 2021-01-01] [--to 2025-01-01] [--symbols A,B] [--interval 4h]
 *   node cli.js backtest --synthetic         Offline demo on generated data
 *   node cli.js montecarlo --trades-file backtest-trades.json
 *   node cli.js montecarlo --winrate 0.4 --avgwin 2.5 --avgloss 1
 *   node cli.js direction                    Bot 1: validate + forecast BTC direction
 *   node cli.js scan                         Bot 2: rank altcoins, print the universe
 *   node cli.js tournament [--from ...]      Compare strategy variants (holdout test)
 *   node cli.js backtest --direction         Backtest with Bot 1 controlling exposure
 *   node cli.js paper [--variant name]       Real prices, simulated orders
 *   node cli.js live --confirm-live          Real orders (needs API keys)
 *   node cli.js status [--mode paper|live]
 *   node cli.js reset-halt [--mode paper|live]
 *
 * Common flags: --config <file>, --capital <usdt>, --testnet, --variant <name>,
 *               --no-direction, --no-scanner
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./src/config");
const { BinanceClient, fetchHistory, INTERVAL_MS } = require("./src/binance");
const { runBacktest } = require("./src/backtest");
const { simulate, syntheticRs } = require("./src/montecarlo");
const { SimulatedBroker, LiveBroker } = require("./src/brokers");
const { runLoop, statePath, loadState, saveState } = require("./src/runner");
const { createNotifier } = require("./src/notifier");
const { generateCandles } = require("./src/synthetic");
const { TradingEngine } = require("./src/engine");
const risk = require("./src/risk");
const direction = require("./src/direction");
const datasources = require("./src/datasources");
const { scan, selectUniverse } = require("./src/scanner");
const { runTournament } = require("./src/tournament");

const MARKET_DATA_URL = "https://data-api.binance.vision";

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) {
            args._.push(a);
            continue;
        }
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) args[key] = true;
        else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const usd = (x) => `${Number(x).toFixed(2)} USDT`;

function buildConfig(args, mode) {
    const overrides = {};
    if (mode) overrides.mode = mode;
    if (args.capital) overrides.initialCapital = Number(args.capital);
    if (args.symbols) overrides.symbols = String(args.symbols).split(",").map((s) => s.trim().toUpperCase());
    if (args.interval) overrides.interval = args.interval;
    if (args.testnet || process.env.BINANCE_TESTNET === "true") overrides.testnet = true;
    if (args["no-direction"]) overrides.direction = { enabled: false };
    if (args["no-scanner"]) overrides.scanner = { enabled: false };
    return loadConfig({ file: args.config, overrides, variant: args.variant });
}

function printPlan(config) {
    const r = config.risk;
    console.log(`\nPLAN DE RIESGO POR FASES (capital inicial ${usd(config.initialCapital)})\n`);
    let from = 0;
    for (const t of r.tiers) {
        const range = t.upTo == null ? `≥ ${from}` : `${from} – ${t.upTo}`;
        console.log(`  ${t.name.padEnd(14)} ${range.padEnd(14)} riesgo/trade ${pct(t.riskPerTrade).padStart(5)}  máx. posiciones ${t.maxOpenPositions}`);
        from = t.upTo;
    }
    console.log("\nFRENOS");
    for (const s of r.drawdownThrottle) console.log(`  Drawdown ≥ ${pct(s.drawdown, 0)} desde el pico → riesgo x${s.multiplier}`);
    console.log(`  Drawdown ≥ ${pct(r.haltDrawdown, 0)} → KILL SWITCH: cierra todo y se detiene hasta reset-halt`);
    console.log(`  Pérdida diaria ≥ ${pct(r.dailyLossLimit, 0)} → sin entradas nuevas hasta el día siguiente (UTC)`);
    console.log(`  ${r.maxConsecutiveLosses} pérdidas seguidas → ${r.cooldownHours} h de enfriamiento`);
    console.log(`  Riesgo abierto total máx. ${pct(r.maxTotalOpenRisk, 0)} · posición máx. ${pct(r.maxPositionPct, 0)} del capital operable`);
    console.log(`  Con ≥ ${r.kelly.minTrades} trades: riesgo ≤ ${r.kelly.fraction} x Kelly; sin ventaja → ${pct(r.kelly.noEdgeRisk)}`);
    if (r.profitLock.enabled) {
        console.log(`\nASEGURAR GANANCIAS\n  Cada +${pct(r.profitLock.triggerGain, 0)} del capital operable → ${pct(r.profitLock.lockFraction, 0)} de esa ganancia pasa a reserva intocable`);
    }
    const d = config.direction;
    console.log(`\nBOT 1 — DIRECCIÓN BTC ${d.enabled ? "" : "(desactivado)"}`);
    console.log(`  P(BTC sube en ${d.horizon} días) → exposición: ${d.bands.map((b) => `≥${pct(b.minProbability, 0)} x${b.exposure}`).join(" · ")}`);
    console.log(`  Solo actúa si supera la validación walk-forward (${d.simulations} simulaciones, p<0,05, gana a 'siempre alcista', estable)`);
    const sc = config.scanner;
    console.log(`\nBOT 2 — SELECCIÓN DE ALTCOINS ${sc.enabled ? "" : "(desactivado)"}`);
    console.log(`  Universo: ${sc.core.join(", ")} + top ${sc.topN} (score ≥ ${sc.minScore}), refresco cada ${sc.refreshHours} h`);
    console.log(`  Pesos: ${Object.entries(sc.weights).map(([k, v]) => `${k} ${pct(v, 0)}`).join(" · ")}`);
    console.log(`  Pérdida de efectividad: si los últimos ${r.alphaDecay.window} trades rinden < ${r.alphaDecay.minExpectancyR}R → riesgo x${r.alphaDecay.multiplier}`);
    const s = config.strategy;
    console.log(`\nESTRATEGIA (${config.interval}, spot, solo largos) en ${config.symbols.join(", ")}`);
    console.log(`  Entrada: cierre > EMA${s.emaSlow}, EMA${s.emaFast} > EMA${s.emaSlow}, ruptura del máximo de ${s.breakoutLookback} velas, ${config.regimeSymbol} sobre su EMA${s.emaSlow}`);
    console.log(`  Stop inicial ${s.stopAtr} ATR · toma ${pct(s.partialFraction, 0)} en +${s.partialTakeR}R y stop a breakeven · trailing ${s.trailAtr} ATR\n`);
}

function printMetrics(m) {
    console.log("\nRESULTADO DEL BACKTEST");
    console.log(`  Capital: ${usd(m.initial)} → ${usd(m.final)} (reserva asegurada ${usd(m.reserve)})`);
    console.log(`  Retorno total ${pct(m.totalReturn)} · CAGR ${pct(m.cagr)} en ${m.years.toFixed(2)} años`);
    console.log(`  Drawdown máximo ${pct(m.maxDrawdown)}`);
    console.log(`  Trades ${m.trades} · acierto ${pct(m.winRate)} · ganancia media ${m.avgWinR.toFixed(2)}R · pérdida media ${m.avgLossR.toFixed(2)}R`);
    console.log(`  Expectativa ${m.expectancyR.toFixed(3)}R/trade · profit factor ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"} · Kelly ${pct(m.kelly)}`);
    if (m.halted) console.log(`  ⛔ Kill switch activado: ${m.haltReason}`);
    console.log("");
}

function printMonteCarlo(res, initial) {
    console.log(`\nMONTE CARLO (${res.paths} caminos × ${res.trades} trades, capital ${usd(initial)})`);
    console.log(`  Capital final  p5 ${usd(res.p5)} · p25 ${usd(res.p25)} · mediana ${usd(res.median)} · p75 ${usd(res.p75)} · p95 ${usd(res.p95)}`);
    console.log(`  Prob. terminar en pérdida ${pct(res.probLoss)} · duplicar ${pct(res.probDouble)} · x10 ${pct(res.probTenX)}`);
    console.log(`  Prob. de activar el kill switch ${pct(res.probHalt)}`);
    console.log(`  Drawdown máximo: mediana ${pct(res.medianMaxDrawdown)} · p95 ${pct(res.p95MaxDrawdown)}\n`);
}

async function loadHistory(config, symbols, from, to, dataDir, interval = config.interval) {
    config = { ...config, interval };
    const client = new BinanceClient({ baseUrl: MARKET_DATA_URL });
    const data = {};
    fs.mkdirSync(dataDir, { recursive: true });
    for (const symbol of symbols) {
        const file = path.join(dataDir, `${symbol}-${config.interval}-${from}-${to}.json`);
        if (fs.existsSync(file)) {
            data[symbol] = JSON.parse(fs.readFileSync(file, "utf8"));
            continue;
        }
        console.log(`Descargando ${symbol} ${config.interval}...`);
        data[symbol] = await fetchHistory(client, symbol, config.interval, Date.parse(from), Date.parse(to));
        fs.writeFileSync(file, JSON.stringify(data[symbol]));
    }
    return data;
}

async function loadBacktestData(args, config) {
    if (args.synthetic) {
        const step = INTERVAL_MS[config.interval];
        const data = Object.fromEntries(config.symbols.map((s, i) => [s, generateCandles({ bars: 4000, intervalMs: step, seed: i + 1 })]));
        console.log("⚠️  Datos SINTÉTICOS: sirve para probar el sistema, no para validar la estrategia.");
        return { data, regimeCandles: data[config.regimeSymbol] || data[config.symbols[0]] };
    }
    const from = args.from || "2021-01-01";
    const to = args.to || new Date().toISOString().slice(0, 10);
    const all = await loadHistory(config, [...new Set([config.regimeSymbol, ...config.symbols])], from, to, path.join(__dirname, "data"));
    let exposureAt;
    if (args.direction) {
        // Train from well before the backtest so walk-forward forecasts cover it.
        const btcDaily = (await loadHistory(config, ["BTCUSDT"], "2017-08-17", to, path.join(__dirname, "data"), "1d")).BTCUSDT;
        const extras = await loadDirectionExtras(config);
        const dataset = direction.buildDataset(btcDaily, { horizon: config.direction.horizon, extras });
        const predictions = direction.walkForward(dataset, { minTrain: config.direction.minTrain });
        const validation = direction.evaluate(predictions, { horizon: config.direction.horizon, simulations: config.direction.simulations });
        printDirectionValidation(validation);
        exposureAt = direction.exposureSeries(predictions, config.direction.bands);
    }
    return { data: Object.fromEntries(config.symbols.map((s) => [s, all[s]])), regimeCandles: all[config.regimeSymbol], exposureAt };
}

async function cmdBacktest(args) {
    const config = buildConfig(args, "backtest");
    const { data, regimeCandles, exposureAt } = await loadBacktestData(args, config);
    const { engine, metrics, equityCurve } = await runBacktest({ config, data, regimeCandles, exposureAt });
    printMetrics(metrics);

    const tradesFile = args["save-trades"] || path.join(__dirname, "backtest-trades.json");
    fs.writeFileSync(tradesFile, JSON.stringify(engine.state.closedTrades, null, 2));
    if (args["save-equity"]) {
        fs.writeFileSync(args["save-equity"], "time,equity,reserve\n" + equityCurve.map((p) => `${new Date(p.time).toISOString()},${p.equity.toFixed(2)},${p.reserve.toFixed(2)}`).join("\n"));
    }
    console.log(`Trades guardados en ${tradesFile} (úsalo con: node cli.js montecarlo --trades-file ${path.basename(tradesFile)})`);
}

async function cmdTournament(args) {
    const config = buildConfig(args, "backtest");
    const { data, regimeCandles, exposureAt } = await loadBacktestData(args, config);
    const variants = args.variants ? String(args.variants).split(",") : undefined;
    const t = await runTournament({ config, data, regimeCandles, exposureAt, windows: Number(args.windows ?? 6), variants });
    const split = t.results[0]?.splitTime;
    console.log(`\nTORNEO DE VARIANTES — se elige en el periodo de entrenamiento, se juzga en el reservado (desde ${split ? new Date(split).toISOString().slice(0, 10) : "?"})\n`);
    console.log("  variante        entreno ret/DD      reservado ret/DD    ventanas +   peor ventana  trades");
    for (const r of t.results) {
        console.log(`  ${r.name.padEnd(14)}  ${pct(r.inSample.ret).padStart(8)} / ${pct(r.inSample.maxDrawdown).padStart(6)}   ${pct(r.holdout.ret).padStart(8)} / ${pct(r.holdout.maxDrawdown).padStart(6)}   ${pct(r.positiveWindows, 0).padStart(6)}     ${pct(r.worstWindow).padStart(8)}     ${r.metrics.trades}`);
    }
    console.log(`\n  Ganadora en entrenamiento: ${t.winner}. En el periodo reservado ${t.winnerHoldsUp ? "SE SOSTIENE ✅" : "NO se sostiene ❌ (probable sobreajuste o cambio de mercado)"}\n`);
}

function cmdMonteCarlo(args) {
    const config = buildConfig(args);
    let rMultiples;
    if (args["trades-file"]) {
        rMultiples = JSON.parse(fs.readFileSync(args["trades-file"], "utf8")).map((t) => t.r).filter(Number.isFinite);
    } else {
        rMultiples = syntheticRs({
            winRate: Number(args.winrate ?? 0.4),
            avgWinR: Number(args.avgwin ?? 2.5),
            avgLossR: Number(args.avgloss ?? 1),
        });
    }
    const res = simulate({
        rMultiples,
        trades: Number(args.trades ?? 200),
        paths: Number(args.paths ?? 5000),
        initialCapital: config.initialCapital,
        riskCfg: config.risk,
        seed: Number(args.seed ?? 42),
    });
    printMonteCarlo(res, config.initialCapital);
}

async function loadDirectionExtras(config) {
    const extras = {};
    if (config.direction.useFunding) {
        extras.funding = await datasources.binanceFunding().catch((err) => {
            console.log(`(funding no disponible: ${err.message})`);
            return {};
        });
    }
    if (config.direction.useFearGreed) {
        extras.fearGreed = await datasources.fearGreedHistory().catch((err) => {
            console.log(`(Fear & Greed no disponible: ${err.message})`);
            return {};
        });
    }
    return extras;
}

async function directionForecast(config) {
    const to = new Date().toISOString().slice(0, 10);
    const client = new BinanceClient({ baseUrl: MARKET_DATA_URL });
    const candles = await fetchHistory(client, "BTCUSDT", "1d", Date.parse("2017-08-17"), Date.parse(to) + 24 * 3600 * 1000);
    const closed = candles.filter((c) => c.closeTime < Date.now());
    return direction.forecast(closed, config.direction, await loadDirectionExtras(config));
}

function printDirectionValidation(v) {
    if (!v.n) return console.log("\nBot 1: sin datos suficientes para validar.\n");
    console.log(`\nBOT 1 — VALIDACIÓN WALK-FORWARD (${v.n} periodos independientes)`);
    console.log(`  Precisión del modelo ${pct(v.accuracy)} vs 'siempre alcista' ${pct(v.baselineAccuracy)} (BTC subió en ${pct(v.upRate)} de los periodos)`);
    console.log(`  p-valor ${v.pValue.toFixed(4)} con ${v.simulations} simulaciones de predictores al azar`);
    console.log(`  Brier ${v.brier.toFixed(4)} vs tasa base ${v.baselineBrier.toFixed(4)} (menor = mejores probabilidades)`);
    console.log(`  Operarlo (largo si p>50%, liquidez si no): ${pct(v.strategyReturn)} vs comprar y mantener ${pct(v.holdReturn)}`);
    console.log(v.passed ? "  ✅ Supera la validación: puede ajustar la exposición." : `  ❌ No supera la validación: ${v.reasons.join("; ")}. No influirá en el riesgo.`);
}

async function cmdDirection(args) {
    const config = buildConfig(args);
    const f = await directionForecast(config);
    if (f.validation) printDirectionValidation(f.validation);
    if (f.probability == null) return console.log(`Sin pronóstico: ${f.reasons.join("; ")}`);
    console.log(`\n  Variables: ${f.features.join(", ")}`);
    console.log(`  P(BTC más alto en ${config.direction.horizon} días) = ${pct(f.probability)} → exposición x${f.exposure}${f.validated ? "" : " (modelo no validado: sin efecto)"}\n`);
}

async function scanUniverse(config) {
    const client = new BinanceClient({ baseUrl: MARKET_DATA_URL });
    const result = await scan({ client, cfg: config.scanner, quoteAsset: config.quoteAsset });
    return { ...result, universe: selectUniverse(result.ranked, config.scanner) };
}

async function cmdScan(args) {
    const config = buildConfig(args);
    const { ranked, rejected, universe } = await scanUniverse(config);
    console.log(`\nBOT 2 — RANKING DE ALTCOINS (${ranked.length} candidatas, ${rejected.length} descartadas)\n`);
    console.log("  #   par            score  moment. valorac. uso    dilución liquidez");
    ranked.slice(0, Number(args.top ?? 20)).forEach((r, i) => {
        const c = r.components;
        console.log(`  ${String(i + 1).padStart(2)}  ${r.binanceSymbol.padEnd(13)} ${r.score.toFixed(2)}   ${c.momentum.toFixed(2)}    ${c.valuation.toFixed(2)}     ${c.usage.toFixed(2)}   ${c.dilution.toFixed(2)}     ${c.liquidity.toFixed(2)}`);
    });
    const reasons = {};
    for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    console.log(`\n  Descartes: ${Object.entries(reasons).map(([k, v]) => `${k} (${v})`).join(", ")}`);
    console.log(`  Universo a operar: ${universe.join(", ")}\n`);
    fs.mkdirSync(path.join(__dirname, "state"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "state", "watchlist.json"), JSON.stringify({ at: new Date().toISOString(), universe, ranked: ranked.slice(0, 30) }, null, 2));
}

function makeLogger(config) {
    const logFile = path.join(__dirname, "state", `${config.mode}${config.variantName ? `-${config.variantName}` : ""}.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    return (entry) => {
        const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
        console.log(line);
        fs.appendFileSync(logFile, line + "\n");
    };
}

async function cmdRun(args, mode) {
    const config = buildConfig(args, mode);
    const log = makeLogger(config);
    const notify = createNotifier();
    const publicClient = new BinanceClient({ testnet: config.testnet });
    let broker;

    if (mode === "live") {
        if (!args["confirm-live"] && process.env.LIVE_TRADING !== "yes") {
            console.error("Modo live requiere --confirm-live (o LIVE_TRADING=yes). Opera dinero real.");
            process.exit(1);
        }
        const client = new BinanceClient({
            apiKey: process.env.BINANCE_API_KEY,
            apiSecret: process.env.BINANCE_API_SECRET,
            testnet: config.testnet,
        });
        broker = new LiveBroker({ client, quoteAsset: config.quoteAsset, feeRate: config.feeRate, log });
        await broker.loadFilters([...new Set([...config.symbols, ...config.scanner.core])]);
        const account = await client.account();
        const free = Number(account.balances.find((b) => b.asset === config.quoteAsset)?.free || 0);
        log({ type: "balance", asset: config.quoteAsset, free });
        if (!loadState(statePath(config)) && free < config.initialCapital) {
            console.error(`Saldo libre ${free} ${config.quoteAsset} < capital configurado ${config.initialCapital}.`);
            process.exit(1);
        }
    } else {
        broker = new SimulatedBroker({ feeRate: config.feeRate, slippage: config.slippage });
    }

    const controller = new AbortController();
    process.on("SIGINT", () => controller.abort());
    process.on("SIGTERM", () => controller.abort());
    await runLoop({
        config,
        client: publicClient,
        broker,
        log,
        notify,
        signal: controller.signal,
        refreshDirection: config.direction.enabled ? () => directionForecast(config) : undefined,
        refreshUniverse: config.scanner.enabled ? async () => (await scanUniverse(config)).universe : undefined,
    });
    log({ type: "stop" });
}

function stateArgs(args) {
    const mode = args.mode || "paper";
    return buildConfig(args, mode === "paper" ? "paper" : "live");
}

function cmdStatus(args) {
    const config = stateArgs(args);
    const state = loadState(statePath(config));
    if (!state) return console.log(`Sin estado guardado en ${statePath(config)}`);
    const engine = new TradingEngine({ config, broker: new SimulatedBroker(), state });
    const total = engine.totalEquity();
    const eff = risk.effectiveRisk(state, total, config.risk);
    console.log(`\nESTADO (${config.mode}${config.testnet ? " testnet" : ""})`);
    console.log(`  Capital total ${usd(total)} = operable ${usd(engine.tradingEquity())} + reserva ${usd(state.reserve)}`);
    console.log(`  Resultado vs inicial: ${pct(total / config.initialCapital - 1)} · drawdown actual ${pct(eff.drawdown)}`);
    console.log(`  Fase ${eff.tier.name} · riesgo efectivo por trade ${pct(eff.pct, 2)} ${eff.notes.length ? `(${eff.notes.join("; ")})` : ""}`);
    if (state.halted) console.log(`  ⛔ DETENIDO: ${state.haltReason}`);
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) console.log(`  ⏸ Enfriamiento hasta ${new Date(state.cooldownUntil).toISOString()}`);
    const positions = Object.values(state.positions);
    console.log(`  Posiciones abiertas: ${positions.length}`);
    for (const p of positions) {
        const last = state.lastPrices[p.symbol] ?? p.entry;
        console.log(`    ${p.symbol} qty ${p.qty} entrada ${p.entry.toFixed(4)} último ${last.toFixed(4)} stop ${p.stop.toFixed(4)} ${p.partialTaken ? "(parcial tomada)" : ""}`);
    }
    const stats = risk.kellyStats(state.closedTrades);
    console.log(`  Trades cerrados ${stats.n} · acierto ${pct(stats.winRate)} · expectativa ${stats.expectancyR.toFixed(3)}R\n`);
}

function cmdResetHalt(args) {
    const config = stateArgs(args);
    const file = statePath(config);
    const state = loadState(file);
    if (!state) return console.log("Sin estado guardado.");
    const engine = new TradingEngine({ config, broker: new SimulatedBroker(), state });
    risk.resetHalt(state, engine.totalEquity());
    saveState(file, state);
    console.log(`Kill switch reiniciado. Nuevo pico de referencia: ${usd(state.peakEquity)}`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const command = args._[0] || "plan";
    switch (command) {
        case "plan": return printPlan(buildConfig(args));
        case "backtest": return cmdBacktest(args);
        case "montecarlo": return cmdMonteCarlo(args);
        case "direction": return cmdDirection(args);
        case "scan": return cmdScan(args);
        case "tournament": return cmdTournament(args);
        case "paper": return cmdRun(args, "paper");
        case "live": return cmdRun(args, "live");
        case "status": return cmdStatus(args);
        case "reset-halt": return cmdResetHalt(args);
        default:
            console.error(`Comando desconocido: ${command}`);
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { parseArgs };
