/**
 * notifier.js
 *
 * Optional Telegram alerts (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) for the
 * events worth a phone buzz: entries, exits, profit locks and halts.
 */

const NOTIFY_TYPES = new Set(["entry", "exit", "partial_exit", "profit_lock", "halt", "error"]);

function formatEvent(e) {
    const n = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
    switch (e.type) {
        case "entry":
            return `🟢 ENTRADA ${e.symbol} @ ${n(e.price, 4)} · stop ${n(e.stop, 4)} · riesgo ${n(e.riskPct * 100)}% (${e.tier})`;
        case "exit":
            return `${e.pnl >= 0 ? "✅" : "🔻"} SALIDA ${e.symbol} @ ${n(e.price, 4)} · PnL ${n(e.pnl)} USDT (${n(e.r)}R) · ${e.reason}`;
        case "partial_exit":
            return `💰 PARCIAL ${e.symbol} @ ${n(e.price, 4)} · PnL ${n(e.pnl)} USDT`;
        case "profit_lock":
            return `🔒 Ganancia asegurada: ${n(e.amount)} USDT → reserva ${n(e.reserve)} USDT`;
        case "halt":
            return `⛔ KILL SWITCH: ${e.reason}. Todo cerrado. Revisa y ejecuta reset-halt.`;
        case "error":
            return `⚠️ Error: ${e.message}`;
        default:
            return `${e.type}: ${JSON.stringify(e)}`;
    }
}

function createNotifier({ token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID, fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    return async function notify(event) {
        if (!token || !chatId || !NOTIFY_TYPES.has(event.type)) return;
        try {
            await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: formatEvent(event) }),
            });
        } catch {
            // Alerts are best-effort; never let them stop trading.
        }
    };
}

module.exports = { createNotifier, formatEvent };
