const { binanceP2PProxy } = require('./binanceP2PProxy');

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        set(key, value) { this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
    };
}

describe('binanceP2PProxy', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('returns the best (lowest) SELL price for USDT/VES', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { adv: { price: '245.50', minSingleTransAmount: '500', dynamicMaxSingleTransAmount: '10000', tradeMethods: [{ identifier: 'PagoMovil' }] }, advertiser: { nickName: 'trader1' } },
                    { adv: { price: '246.10', minSingleTransAmount: '100', dynamicMaxSingleTransAmount: '5000', tradeMethods: [] }, advertiser: { nickName: 'trader2' } },
                ],
            }),
        });

        const req = { method: 'GET', query: { asset: 'USDT', fiat: 'VES', tradeType: 'SELL', rows: '5' } };
        const res = mockRes();

        await binanceP2PProxy(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
        expect(res.body.bestPrice).toBe(245.5);
        expect(res.body.ads).toHaveLength(2);
        expect(res.body.ads[0].payTypes).toEqual(['PagoMovil']);
    });

    it('rejects unsupported fiat currencies', async () => {
        const req = { method: 'GET', query: { asset: 'USDT', fiat: 'XXX', tradeType: 'SELL' } };
        const res = mockRes();

        await binanceP2PProxy(req, res);

        expect(res.statusCode).toBe(400);
    });

    it('answers CORS preflight without hitting Binance', async () => {
        global.fetch = jest.fn();
        const req = { method: 'OPTIONS', query: {} };
        const res = mockRes();

        await binanceP2PProxy(req, res);

        expect(res.statusCode).toBe(204);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 502 when Binance is unreachable', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
        const req = { method: 'GET', query: { asset: 'USDT', fiat: 'VES', tradeType: 'SELL' } };
        const res = mockRes();

        await binanceP2PProxy(req, res);

        expect(res.statusCode).toBe(502);
    });
});
