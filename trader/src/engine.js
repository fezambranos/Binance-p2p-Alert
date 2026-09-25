/**
 * engine.js
 *
 * Shared trading logic for backtest, paper and live. The engine owns the
 * bot's ledger (cash, reserve, positions) and delegates order execution to a
 * broker: SimulatedBroker for backtest/paper, LiveBroker for real orders.
 *
 * Call order per candle: onPrice(bar) for intrabar stop / take-profit
 * checks, then onBarClose(candles) for trailing stops and new entries.
 */

const risk = require("./risk");
const { evaluateEntry, trailingStop, isBullishRegime } = require("./strategy");

function initialState(config) {
    return {
        cash: config.initialCapital,
        reserve: 0,
        positions: {},
        lastPrices: {},
        peakEquity: config.initialCapital,
        dayKey: null,
        dayStartEquity: config.initialCapital,
        halted: false,
        haltReason: null,
        consecutiveLosses: 0,
        cooldownUntil: null,
        closedTrades: [],
        lockBase: config.initialCapital,
        regimeBullish: true,
        exposure: 1,
        events: [],
    };
}

class TradingEngine {
    constructor({ config, broker, state, log = () => {} }) {
        this.config = config;
        this.broker = broker;
        this.state = state || initialState(config);
        this.log = log;
    }

    tradingEquity() {
        let equity = this.state.cash;
        for (const [symbol, pos] of Object.entries(this.state.positions)) {
            equity += pos.qty * (this.state.lastPrices[symbol] ?? pos.entry);
        }
        return equity;
    }

    totalEquity() {
        return this.tradingEquity() + (this.state.reserve || 0);
    }

    openRisk() {
        let total = 0;
        for (const pos of Object.values(this.state.positions)) total += Math.max(0, pos.entry - pos.stop) * pos.qty;
        return total;
    }

    event(type, time, data) {
        const entry = { type, time, ...data };
        this.state.events.push(entry);
        if (this.state.events.length > 200) this.state.events.shift();
        this.log(entry);
    }

    // Bot 1 output: 1 = full risk, 0.5 = half, 0 = no new longs.
    setExposure(exposure, time, info = {}) {
        const previous = Number.isFinite(this.state.exposure) ? this.state.exposure : 1;
        this.state.exposure = exposure;
        if (exposure !== previous) this.event("exposure", time, { exposure, previous, ...info });
    }

    updateRegime(candles) {
        this.state.regimeBullish = isBullishRegime(candles, this.config.strategy);
    }

    // bar: { open, high, low, close } — a live tick passes the same price in every field.
    async onPrice(symbol, bar, time) {
        this.state.lastPrices[symbol] = bar.close;
        const pos = this.state.positions[symbol];

        if (pos && this.broker.checkProtectiveFill) {
            const fill = await this.broker.checkProtectiveFill(symbol, pos);
            if (fill) {
                this.settleExit(symbol, pos, fill, "stop en exchange", time);
                return this.refreshRisk(time);
            }
        }

        if (pos) {
            if (bar.low <= pos.stop) {
                const price = bar.open <= pos.stop ? bar.open : pos.stop;
                await this.exit(symbol, pos.qty, price, pos.stop >= pos.entry ? "trailing stop" : "stop loss", time);
            } else if (!pos.partialTaken && this.config.strategy.partialFraction > 0 && bar.high >= pos.target) {
                const qty = this.broker.normalizeQty(symbol, pos.qty * this.config.strategy.partialFraction, pos.target);
                if (qty > 0 && qty < pos.qty) {
                    await this.exit(symbol, qty, pos.target, "toma parcial", time);
                }
                pos.partialTaken = true;
                if (this.state.positions[symbol]) await this.moveStop(symbol, Math.max(pos.stop, pos.entry));
            }
        }
        return this.refreshRisk(time);
    }

    async onBarClose(symbol, candles, time) {
        const last = candles.at(-1);
        this.state.lastPrices[symbol] = last.close;
        const pos = this.state.positions[symbol];

        if (pos) {
            pos.highest = Math.max(pos.highest, last.high);
            const newStop = trailingStop(candles, pos, this.config.strategy);
            if (newStop > pos.stop) await this.moveStop(symbol, newStop);
        } else {
            await this.tryEntry(symbol, candles, time);
        }

        const locked = risk.applyProfitLock(this.state, this.tradingEquity(), this.config.risk);
        if (locked > 0) this.event("profit_lock", time, { amount: locked, reserve: this.state.reserve });
        return this.refreshRisk(time);
    }

    async tryEntry(symbol, candles, time) {
        const signal = evaluateEntry(candles, this.config.strategy);
        if (!signal.signal) return null;
        if (!this.state.regimeBullish) return null;
        if (this.state.exposure === 0) return null;

        const total = this.totalEquity();
        const tradingEquity = this.tradingEquity();
        const check = risk.canOpen(this.state, {
            totalEquity: total,
            tradingEquity,
            openPositions: Object.keys(this.state.positions).length,
            openRisk: this.openRisk(),
            time,
        }, this.config.risk);
        if (!check.ok) {
            this.event("entry_blocked", time, { symbol, reason: check.reason });
            return null;
        }

        const eff = risk.effectiveRisk(this.state, total, this.config.risk);
        const size = risk.sizePosition({
            tradingEquity,
            cash: this.state.cash,
            entry: signal.entry,
            stop: signal.stop,
            riskPct: eff.pct,
            openRisk: this.openRisk(),
            feeRate: this.config.feeRate,
        }, this.config.risk);

        const qty = this.broker.normalizeQty(symbol, size.qty, signal.entry);
        if (!(qty > 0) || qty * signal.entry < this.config.risk.minNotional) {
            this.event("entry_blocked", time, { symbol, reason: "tamaño por debajo del mínimo" });
            return null;
        }

        const fill = await this.broker.buy(symbol, qty, signal.entry);
        this.state.cash -= fill.qty * fill.price + fill.fee;
        // Keep the stop distance from the signal even if the fill slipped.
        const stop = fill.price - (signal.entry - signal.stop);
        const riskPerUnit = fill.price - stop;
        const pos = {
            symbol,
            qty: fill.qty,
            initialQty: fill.qty,
            entry: fill.price,
            totalCost: fill.qty * fill.price + fill.fee,
            stop,
            initialStop: stop,
            riskPerUnit,
            target: fill.price + this.config.strategy.partialTakeR * riskPerUnit,
            highest: fill.price,
            partialTaken: false,
            realizedPnl: 0,
            openedAt: time,
            riskPct: eff.pct,
            tier: eff.tier.name,
            protectiveOrderId: null,
        };
        this.state.positions[symbol] = pos;
        pos.protectiveOrderId = await this.broker.setProtectiveStop(symbol, pos.qty, stop);
        this.event("entry", time, {
            symbol, qty: pos.qty, price: pos.entry, stop, riskPct: eff.pct, tier: eff.tier.name, notes: eff.notes,
        });
        return pos;
    }

    async moveStop(symbol, newStop) {
        const pos = this.state.positions[symbol];
        if (!pos || newStop <= pos.stop) return;
        pos.stop = newStop;
        await this.broker.cancelProtectiveStop(symbol, pos);
        pos.protectiveOrderId = await this.broker.setProtectiveStop(symbol, pos.qty, newStop);
    }

    async exit(symbol, qty, refPrice, reason, time) {
        const pos = this.state.positions[symbol];
        if (!pos) return;
        await this.broker.cancelProtectiveStop(symbol, pos);
        pos.protectiveOrderId = null;
        const fill = await this.broker.sell(symbol, qty, refPrice);
        this.settleExit(symbol, pos, fill, reason, time);
        const remaining = this.state.positions[symbol];
        if (remaining) remaining.protectiveOrderId = await this.broker.setProtectiveStop(symbol, remaining.qty, remaining.stop);
    }

    settleExit(symbol, pos, fill, reason, time) {
        const legCost = pos.totalCost * (fill.qty / pos.initialQty);
        const legPnl = fill.qty * fill.price - fill.fee - legCost;
        this.state.cash += fill.qty * fill.price - fill.fee;
        pos.realizedPnl += legPnl;
        pos.qty -= fill.qty;

        // Leftover below ~1 USDT is exchange rounding dust, not a position.
        if (pos.qty * fill.price >= 1) {
            this.event("partial_exit", time, { symbol, qty: fill.qty, price: fill.price, pnl: legPnl, reason });
            return;
        }

        delete this.state.positions[symbol];
        const initialRisk = pos.riskPerUnit * pos.initialQty;
        const trade = {
            symbol,
            entry: pos.entry,
            exit: fill.price,
            qty: pos.initialQty,
            pnl: pos.realizedPnl,
            r: initialRisk > 0 ? pos.realizedPnl / initialRisk : 0,
            openedAt: pos.openedAt,
            closedAt: time,
            reason,
            tier: pos.tier,
        };
        risk.recordTradeClosed(this.state, trade, this.config.risk);
        this.event("exit", time, { symbol, price: fill.price, pnl: trade.pnl, r: trade.r, reason });
    }

    async refreshRisk(time) {
        const result = risk.updateEquity(this.state, this.totalEquity(), time, this.config.risk);
        if (result.newlyHalted) {
            this.event("halt", time, { reason: result.reason });
            await this.flattenAll("kill switch", time);
        }
        return result;
    }

    async flattenAll(reason, time) {
        for (const [symbol, pos] of Object.entries(this.state.positions)) {
            await this.exit(symbol, pos.qty, this.state.lastPrices[symbol] ?? pos.entry, reason, time);
        }
    }
}

module.exports = { TradingEngine, initialState };
