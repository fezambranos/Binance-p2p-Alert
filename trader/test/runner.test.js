const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runLoop, statePath } = require("../src/runner");
const { SimulatedBroker } = require("../src/brokers");
const { makeConfig, breakoutSeries } = require("./helpers");

test("loop applies Bot 1 exposure and Bot 2 universe, and keeps state per variant", async () => {
    const config = { ...makeConfig({ mode: "paper", pollSeconds: 0.02, symbols: ["BTCUSDT"] }), variantName: "testloop" };
    const file = statePath(config);
    assert.match(file, /paper-testloop\.json$/);
    fs.rmSync(file, { force: true });

    const candles = breakoutSeries();
    const client = { tickerPrice: async () => candles.at(-1).close, klines: async () => candles };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const events = [];
    await runLoop({
        config,
        client,
        broker: new SimulatedBroker(),
        log: (e) => events.push(e),
        notify: () => {},
        signal: controller.signal,
        refreshDirection: async () => ({ exposure: 0, probability: 0.3, validated: true }),
        refreshUniverse: async () => ["BTCUSDT", "ETHUSDT"],
    });

    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.rmSync(file, { force: true });
    assert.deepEqual(state.universe, ["BTCUSDT", "ETHUSDT"]);
    assert.equal(state.exposure, 0);
    assert.equal(Object.keys(state.positions).length, 0, "bearish Bot 1 blocks new longs");
    assert.ok(events.some((e) => e.type === "exposure"));
});
