# Trader — bot de trading con riesgo por fases de capital

Bot para Binance Spot pensado para arrancar con **500 USDT** en modo agresivo
pero controlado, y volverse más conservador a medida que el capital crece.
Sin dependencias (Node 22+). Mismo motor para backtest, paper y dinero real.

> **Lee esto primero.** Ningún sistema garantiza ganancias. La estrategia
> incluida es un punto de partida razonable (seguimiento de tendencia con
> rupturas), **no** está validada aquí con datos reales. El orden correcto es:
> backtest con datos reales → Monte Carlo → paper trading 4–8 semanas →
> testnet → real con el capital que aceptes perder.

## La lógica: "guerrilla informada"

1. **Riesgo por fases.** Con poco capital, perder 500 USDT es recuperable y el
   crecimiento importa más: se arriesga más por trade. A medida que el capital
   crece, protegerlo importa más que multiplicarlo.

   | Fase          | Capital total | Riesgo por trade | Posiciones máx. |
   |---------------|---------------|------------------|-----------------|
   | Guerrilla     | < 1.000       | 3,0 %            | 2               |
   | Expansión     | 1.000–2.500   | 2,5 %            | 3               |
   | Consolidación | 2.500–5.000   | 2,0 %            | 3               |
   | Preservación  | ≥ 5.000       | 1,0 %            | 4               |

   "Riesgo" = lo que se pierde si salta el stop, no el tamaño de la posición.
   Con 500 USDT y 3 %, cada trade perdedor cuesta ~15 USDT.

2. **Frenos automáticos (lo que evita que "agresivo" se vuelva "apuesta").**
   - Drawdown ≥ 10 % desde el pico → riesgo a la mitad; ≥ 20 % → a un cuarto.
   - Drawdown ≥ 30 % → **kill switch**: cierra todo y se detiene hasta que tú
     ejecutes `reset-halt` después de revisar qué pasó.
   - Pérdida diaria ≥ 6 % → no abre más ese día.
   - 4 pérdidas seguidas → 24 h de pausa.
   - Riesgo abierto total ≤ 8 %; ninguna posición > 60 % del capital operable.

3. **El sistema aprende de sus propios resultados (Kelly fraccional).** Con
   ≥ 30 trades cerrados calcula su ventaja real. Si es pequeña, baja el riesgo
   a ½ Kelly; si no hay ventaja, baja a 0,5 % y lo avisa. Así no sigue
   apostando fuerte con una estrategia que dejó de funcionar.

4. **Asegurar ganancias.** Cada vez que el capital operable sube +50 %, el
   30 % de esa ganancia pasa a una **reserva que el bot nunca opera** (en real
   sigue en tu wallet; puedes moverla a Earn o retirarla).

5. **Estrategia** (velas de 4h, solo largos, sin apalancamiento):
   - Entra si el precio está sobre la EMA200, EMA50 > EMA200, rompe el máximo
     de las últimas 20 velas, la volatilidad (ATR) es razonable y BTC está
     sobre su EMA200 (no se compran altcoins en mercado bajista).
   - Stop inicial a 2 ATR. En +2R vende la mitad y sube el stop a la entrada
     (el resto es un trade "gratis"). Trailing stop a 3 ATR del máximo.
   - Gana pocas veces pero grande; pierde seguido pero pequeño. Espera
     rachas de 5–8 pérdidas: es normal en seguimiento de tendencia.

## Uso

```bash
cd trader
npm test                                   # 42 tests
node cli.js plan                           # ver reglas de riesgo activas

# 1) Backtest con datos reales (descarga velas públicas de Binance y las cachea en data/)
node cli.js backtest --from 2021-01-01 --to 2025-01-01
node cli.js backtest --from 2021-01-01 --save-equity equity.csv

# 2) Monte Carlo sobre los trades del backtest: rango de resultados posibles
node cli.js montecarlo --trades-file backtest-trades.json --trades 200
#    ...o con supuestos propios
node cli.js montecarlo --winrate 0.38 --avgwin 2.8 --avgloss 1

# 3) Paper trading: precios reales, órdenes simuladas (déjalo corriendo semanas)
node cli.js paper
node cli.js status

# 4) Testnet de Binance (claves de https://testnet.binance.vision)
BINANCE_API_KEY=... BINANCE_API_SECRET=... node cli.js live --testnet --confirm-live

# 5) Real
BINANCE_API_KEY=... BINANCE_API_SECRET=... node cli.js live --confirm-live
node cli.js status --mode live
node cli.js reset-halt --mode live         # solo tras revisar por qué saltó
```

`node cli.js backtest --synthetic` corre sobre datos inventados: sirve para
probar que todo funciona sin red, **no** dice nada de la estrategia.

### Qué mirar en el backtest antes de arriesgar dinero

- **Expectativa > 0,15R por trade** y **profit factor > 1,3** en varios
  periodos (incluye 2022, año bajista), no solo en el mejor.
- **Drawdown máximo < 30 %**. Si supera eso, el kill switch habría saltado.
- En Monte Carlo: prob. de kill switch < 10 % y p5 del capital final
  aceptable para ti.
- Si cambias parámetros hasta que el backtest "se ve bien", estás
  sobreajustando. Valida en un periodo que no usaste para ajustar.

## Seguridad de la cuenta

- Crea una API key **solo con permiso de Spot Trading**. **Nunca** actives
  retiros. Restringe la key a la IP del servidor donde corre el bot.
- Usa una subcuenta de Binance con solo el capital del bot, o al menos no
  tengas otras posiciones en los mismos pares: el bot lleva su propia
  contabilidad y no toca más USDT que `initialCapital` + sus ganancias.
- Cada posición tiene un **stop real en el exchange** (STOP_LOSS_LIMIT), así
  que sigue protegida aunque el bot o tu conexión se caigan.
- El estado se guarda en `state/` tras cada ciclo; reiniciar el bot es seguro.

## Configuración

Copia `config.example.json` a `config.json` y cambia lo que quieras (se
fusiona con los valores por defecto). Ejemplos: más pares en `symbols`,
`initialCapital`, tramos de `risk.tiers`, `risk.haltDrawdown`.

Alertas al teléfono por Telegram (opcional): define `TELEGRAM_BOT_TOKEN` y
`TELEGRAM_CHAT_ID` y recibirás entradas, salidas, reservas y kill switch.

Para dejarlo corriendo 24/7 usa un VPS pequeño con `pm2` o `systemd`
(`node cli.js paper` / `live`). El bot revisa precios cada 60 s.

## Estructura

- `src/risk.js` — fases, frenos, Kelly, tamaño de posición, reserva.
- `src/strategy.js` — señales de entrada y trailing stop.
- `src/engine.js` — motor común (contabilidad, entradas, salidas).
- `src/brokers.js` — broker simulado y broker real de Binance.
- `src/binance.js` — cliente REST firmado de Binance Spot.
- `src/backtest.js`, `src/montecarlo.js` — validación.
- `src/runner.js` — bucle de paper/live con estado persistente.
