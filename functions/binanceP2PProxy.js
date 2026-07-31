/**
 * binanceP2PProxy.js
 *
 * Standalone public HTTP endpoint that proxies Binance P2P ad search
 * requests. This is a personal-utility endpoint for the price-alert page
 * at /binance-alert/ — it is NOT part of the multi-tenant CRM data model
 * (no shopId, no Firestore reads/writes), so the usual tenant rules don't
 * apply here.
 *
 * Binance's P2P search API does not send permissive CORS headers, so the
 * browser page can't call it directly — this function fetches it
 * server-side and re-serves the result with Access-Control-Allow-Origin: *.
 */

const BINANCE_P2P_SEARCH_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

const ALLOWED_ASSETS = new Set(["USDT", "USDC", "BUSD", "BTC", "ETH", "BNB"]);
const ALLOWED_FIATS = new Set(["VES", "COP", "ARS", "PEN", "CLP", "MXN", "BRL", "USD", "EUR"]);
const ALLOWED_TRADE_TYPES = new Set(["BUY", "SELL"]);

async function fetchTopAds({ asset, fiat, tradeType, rows }) {
    const response = await fetch(BINANCE_P2P_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            asset,
            fiat,
            tradeType,
            page: 1,
            rows,
            payTypes: [],
            publisherType: null,
        }),
    });

    if (!response.ok) {
        throw new Error(`Binance P2P responded with ${response.status}`);
    }

    const data = await response.json();
    const ads = Array.isArray(data.data) ? data.data : [];

    return ads.map((entry) => ({
        price: Number(entry.adv?.price),
        minSingleTransAmount: Number(entry.adv?.minSingleTransAmount),
        maxSingleTransAmount: Number(entry.adv?.dynamicMaxSingleTransAmount ?? entry.adv?.maxSingleTransAmount),
        advertiser: entry.advertiser?.nickName || null,
        payTypes: (entry.adv?.tradeMethods || []).map((m) => m.identifier).filter(Boolean),
    }));
}

exports.binanceP2PProxy = async function binanceP2PProxy(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);

    const asset = String(req.query.asset || "USDT").toUpperCase();
    const fiat = String(req.query.fiat || "VES").toUpperCase();
    const tradeType = String(req.query.tradeType || "SELL").toUpperCase();
    const rows = Math.min(Math.max(parseInt(req.query.rows, 10) || 5, 1), 20);

    if (!ALLOWED_ASSETS.has(asset)) return res.status(400).json({ error: `Unsupported asset: ${asset}` });
    if (!ALLOWED_FIATS.has(fiat)) return res.status(400).json({ error: `Unsupported fiat: ${fiat}` });
    if (!ALLOWED_TRADE_TYPES.has(tradeType)) return res.status(400).json({ error: `Unsupported tradeType: ${tradeType}` });

    try {
        const ads = await fetchTopAds({ asset, fiat, tradeType, rows });
        const bestPrice = ads.length > 0 ? ads[0].price : null;
        return res.status(200).json({
            asset,
            fiat,
            tradeType,
            bestPrice,
            ads,
            fetchedAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error("binanceP2PProxy error:", err.message);
        return res.status(502).json({ error: "Failed to fetch Binance P2P prices", detail: err.message });
    }
};

exports.fetchTopAds = fetchTopAds;
