/**
 * brokers.js
 *
 * SimulatedBroker: fills at the reference price plus slippage and fees.
 * Used by backtest and paper trading.
 *
 * LiveBroker: real Binance Spot orders. Entries are MARKET buys and each
 * position keeps a STOP_LOSS_LIMIT order resting on the exchange, so the
 * position stays protected even if the bot crashes or loses connection.
 */

const { parseFilters, floorToStep, roundToStep } = require("./binance");

class SimulatedBroker {
    constructor({ feeRate = 0.001, slippage = 0.0005 } = {}) {
        this.feeRate = feeRate;
        this.slippage = slippage;
    }

    normalizeQty(symbol, qty) {
        return Math.floor(qty * 1e8) / 1e8;
    }

    async buy(symbol, qty, refPrice) {
        const price = refPrice * (1 + this.slippage);
        return { qty, price, fee: qty * price * this.feeRate };
    }

    async sell(symbol, qty, refPrice) {
        const price = refPrice * (1 - this.slippage);
        return { qty, price, fee: qty * price * this.feeRate };
    }

    async setProtectiveStop() {
        return null;
    }

    async cancelProtectiveStop() {}
}

// Average fill price and fee in quote asset from a Binance order response.
function summarizeFills(order, baseAsset, quoteAsset, feeRate) {
    const executedQty = Number(order.executedQty);
    const quoteQty = Number(order.cummulativeQuoteQty);
    const price = executedQty > 0 ? quoteQty / executedQty : 0;
    let fee = 0;
    let baseFee = 0;
    for (const f of order.fills || []) {
        const commission = Number(f.commission);
        if (f.commissionAsset === quoteAsset) fee += commission;
        else if (f.commissionAsset === baseAsset) {
            baseFee += commission;
            fee += commission * Number(f.price);
        } else {
            // Paid in BNB or another asset: account for it at the nominal rate.
            fee += Number(f.qty) * Number(f.price) * feeRate;
        }
    }
    return { executedQty, netQty: executedQty - baseFee, price, fee };
}

class LiveBroker {
    constructor({ client, quoteAsset = "USDT", feeRate = 0.001, stopLimitOffset = 0.005, log = () => {} }) {
        this.client = client;
        this.quoteAsset = quoteAsset;
        this.feeRate = feeRate;
        this.stopLimitOffset = stopLimitOffset;
        this.log = log;
        this.filters = {};
    }

    async loadFilters(symbols) {
        const info = await this.client.exchangeInfo(symbols);
        for (const s of info.symbols) this.filters[s.symbol] = parseFilters(s);
    }

    filtersFor(symbol) {
        const f = this.filters[symbol];
        if (!f) throw new Error(`Filtros no cargados para ${symbol}`);
        return f;
    }

    normalizeQty(symbol, qty, price) {
        const f = this.filtersFor(symbol);
        const rounded = floorToStep(qty, f.stepSize);
        if (rounded < f.minQty || rounded * price < f.minNotional) return 0;
        return rounded;
    }

    async buy(symbol, qty, refPrice) {
        const f = this.filtersFor(symbol);
        const account = await this.client.account();
        const free = Number(account.balances.find((b) => b.asset === this.quoteAsset)?.free || 0);
        const needed = qty * refPrice * (1 + 2 * this.feeRate);
        if (free < needed) throw new Error(`Saldo ${this.quoteAsset} insuficiente: ${free} < ${needed.toFixed(2)}`);

        const order = await this.client.newOrder({
            symbol, side: "BUY", type: "MARKET", quantity: floorToStep(qty, f.stepSize), newOrderRespType: "FULL",
        });
        const s = summarizeFills(order, f.baseAsset, this.quoteAsset, this.feeRate);
        return { qty: floorToStep(s.netQty, f.stepSize), price: s.price, fee: s.fee };
    }

    async sell(symbol, qty, refPrice) {
        const f = this.filtersFor(symbol);
        const account = await this.client.account();
        const free = Number(account.balances.find((b) => b.asset === f.baseAsset)?.free || 0);
        const quantity = floorToStep(Math.min(qty, free), f.stepSize);
        if (!(quantity > 0)) throw new Error(`Nada que vender en ${symbol} (libre: ${free})`);

        const order = await this.client.newOrder({
            symbol, side: "SELL", type: "MARKET", quantity, newOrderRespType: "FULL",
        });
        const s = summarizeFills(order, f.baseAsset, this.quoteAsset, this.feeRate);
        // A shortfall under one lot step is rounding dust: close the full ledger qty and leave it in the wallet.
        const closedQty = qty - s.executedQty < f.stepSize ? qty : s.executedQty;
        return { qty: closedQty, price: s.price || refPrice, fee: s.fee };
    }

    async setProtectiveStop(symbol, qty, stopPrice) {
        const f = this.filtersFor(symbol);
        const quantity = floorToStep(qty, f.stepSize);
        const stop = roundToStep(stopPrice, f.tickSize);
        const limit = roundToStep(stopPrice * (1 - this.stopLimitOffset), f.tickSize);
        if (quantity < f.minQty || quantity * limit < f.minNotional) return null;
        try {
            const order = await this.client.newOrder({
                symbol, side: "SELL", type: "STOP_LOSS_LIMIT", timeInForce: "GTC",
                quantity, stopPrice: stop, price: limit,
            });
            return order.orderId;
        } catch (err) {
            // Stop already above market: the engine's own price check will exit on the next tick.
            this.log({ type: "protective_stop_error", symbol, error: err.message });
            return null;
        }
    }

    async cancelProtectiveStop(symbol, pos) {
        if (!pos.protectiveOrderId) return;
        try {
            await this.client.cancelOrder(symbol, pos.protectiveOrderId);
        } catch (err) {
            this.log({ type: "cancel_error", symbol, error: err.message });
        }
    }

    // Detects a protective stop that filled on the exchange between ticks.
    async checkProtectiveFill(symbol, pos) {
        if (!pos.protectiveOrderId) return null;
        const order = await this.client.getOrder(symbol, pos.protectiveOrderId);
        if (order.status !== "FILLED") return null;
        const executedQty = Number(order.executedQty);
        const price = executedQty > 0 ? Number(order.cummulativeQuoteQty) / executedQty : pos.stop;
        pos.protectiveOrderId = null;
        return { qty: Math.min(pos.qty, executedQty), price, fee: executedQty * price * this.feeRate };
    }
}

module.exports = { SimulatedBroker, LiveBroker, summarizeFills };
