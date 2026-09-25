const test = require("node:test");
const assert = require("node:assert/strict");
const { BinanceClient, floorToStep, roundToStep, parseFilters, fetchHistory } = require("../src/binance");
const { summarizeFills } = require("../src/brokers");

test("HMAC signature matches the Binance API docs example", () => {
    const client = new BinanceClient({ apiKey: "k", apiSecret: "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j" });
    const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    assert.equal(client.sign(query), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
});

test("signed requests send the API key header and a signature", async () => {
    let captured;
    const client = new BinanceClient({
        apiKey: "key",
        apiSecret: "secret",
        fetchImpl: async (url, opts) => {
            captured = { url, opts };
            return { ok: true, json: async () => ({ balances: [] }) };
        },
    });
    await client.account();
    assert.equal(captured.opts.headers["X-MBX-APIKEY"], "key");
    assert.match(captured.url, /timestamp=\d+&signature=[0-9a-f]{64}$/);
});

test("API errors surface Binance's code and message", async () => {
    const client = new BinanceClient({
        fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: -1013, msg: "Filter failure: LOT_SIZE" }) }),
    });
    await assert.rejects(client.tickerPrice("BTCUSDT"), /LOT_SIZE.*-1013/);
});

test("step rounding respects exchange precision", () => {
    assert.equal(floorToStep(0.123456789, "0.00100000"), 0.123);
    assert.equal(floorToStep(0.3, "0.1"), 0.3);
    assert.equal(roundToStep(123.456, "0.01"), 123.46);
    assert.equal(floorToStep(15, "1.00000000"), 15);
});

test("parses LOT_SIZE, PRICE_FILTER and NOTIONAL filters", () => {
    const f = parseFilters({
        baseAsset: "BTC",
        quoteAsset: "USDT",
        filters: [
            { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
            { filterType: "LOT_SIZE", stepSize: "0.00001000", minQty: "0.00001000" },
            { filterType: "NOTIONAL", minNotional: "5.00000000" },
        ],
    });
    assert.deepEqual(f, { baseAsset: "BTC", quoteAsset: "USDT", stepSize: "0.00001000", minQty: 0.00001, tickSize: "0.01000000", minNotional: 5 });
});

test("summarizes fills with commission in base asset", () => {
    const s = summarizeFills({
        executedQty: "1.0",
        cummulativeQuoteQty: "100",
        fills: [{ price: "100", qty: "1.0", commission: "0.001", commissionAsset: "SOL" }],
    }, "SOL", "USDT", 0.001);
    assert.equal(s.price, 100);
    assert.equal(s.netQty, 0.999);
    assert.ok(Math.abs(s.fee - 0.1) < 1e-9);
});

test("fetchHistory paginates until the end time", async () => {
    const step = 4 * 3600 * 1000;
    const calls = [];
    const client = {
        klines: async (symbol, interval, { startTime, limit }) => {
            calls.push(startTime);
            const n = calls.length === 1 ? limit : 5;
            return Array.from({ length: n }, (_, i) => ({ openTime: startTime + i * step }));
        },
    };
    const out = await fetchHistory(client, "BTCUSDT", "4h", 0, 2000 * step);
    assert.equal(out.length, 1005);
    assert.equal(calls[1], 1000 * step);
});
