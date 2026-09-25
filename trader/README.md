# Trader — bot de trading con riesgo por fases de capital

Bot para Binance Spot pensado para arrancar con **500 USDT** en modo agresivo
pero controlado, y volverse más conservador a medida que el capital crece.
Sin dependencias (Node 22+). Mismo motor para backtest, paper y dinero real.

> **Lee esto primero.** Ningún sistema garantiza ganancias. La estrategia
> incluida es un punto de partida razonable (seguimiento de tendencia con
> rupturas), **no** está validada aquí con datos reales. El orden correcto es:
> backtest con datos reales → Monte Carlo → paper trading 4–8 semanas →
> testnet → real con el capital que aceptes perder.

## Arquitectura: 3 bots + validación continua

```
 Bot 1 · Dirección BTC ──► exposición x1 / x0,5 / x0 ─┐
 Bot 2 · Selección altcoins ──► universo a operar ────┼──► Bot 3 · Riesgo + ejecución (Binance Spot)
 Torneo de variantes · detector de pérdida de efectividad ┘
```

**Bot 1 — dirección de BTC** (`src/direction.js`, `node cli.js direction`).
Regresión logística sobre variables diarias: momentum a 7/30/90 días,
distancia a EMA50/EMA200, régimen de volatilidad, distancia al máximo anual,
RSI, *funding rate* de los perpetuos (posicionamiento apalancado) y el índice
Fear & Greed (sentimiento). Da P(BTC más alto en 7 días). **Solo puede tocar
el riesgo si supera la validación**:

- *Walk-forward*: cada predicción la hace un modelo entrenado solo con datos
  que ya existían en ese momento.
- Tiene que ganarle a "predecir siempre subida" por ≥ 2 puntos. BTC sube en
  más de la mitad de las semanas, así que "58 %" puede ser solo esa base.
- Significancia con miles de simulaciones Monte Carlo de predictores al azar
  (p < 0,05), sobre periodos que no se solapan.
- Estabilidad: la ventaja tiene que aparecer en las dos mitades del periodo.
  En los tests, series de puro ruido pasan esta validación ~2,5 % de las veces.

Si pasa: P ≥ 55 % → exposición completa; 45–55 % → mitad; < 45 % → no abre
largos nuevos. Si no pasa, no influye y manda el filtro de tendencia de BTC.

**Bot 2 — selección de altcoins** (`src/scanner.js`, `node cli.js scan`).
Solo datos crudos y auditables, sin noticias ni influencers:

| Componente | Dato | Fuente | Peso |
|---|---|---|---|
| Momentum | fuerza relativa vs BTC a 30 y 90 días | Binance | 35 % |
| Valoración | comisiones anualizadas / capitalización (tipo P/E) | DefiLlama | 25 % |
| Uso | variación del TVL a 30 días | DefiLlama | 15 % |
| Dilución | capitalización / FDV (supply por desbloquear) | CoinGecko | 15 % |
| Liquidez | volumen 24 h en Binance | Binance | 10 % |

Descarta antes: stablecoins, tokens envueltos o en *staking*, capitalización
< 300 M, volumen < 10 M, capitalización/FDV < 35 % y lo que no cotiza en
Binance. Sin fundamentales verificables → puntuación baja (no tener datos no
es una buena noticia). Universo = BTC + ETH + las 4 mejores, recalculado cada
semana.

**Bot 3 — riesgo y ejecución**: todo lo descrito abajo (fases, frenos, Kelly,
reserva), más la exposición de Bot 1 y el detector de **pérdida de
efectividad**: si los últimos 20 trades tienen expectativa negativa, el riesgo
baja a la mitad aunque el historial largo sea bueno.

**Torneo** (`node cli.js tournament`): prueba 5 variantes (`base`, `rapida`,
`lenta`, `sin_parcial`, `conservadora`, editables en `config.json`). La
ganadora se elige **solo** con el primer 70 % del historial y se juzga en el
30 % final que no vio. Si no se sostiene ahí, era suerte o sobreajuste.
Para correrlas en paralelo en paper: `node cli.js paper --variant rapida`
en otra terminal (cada variante tiene su propio estado y log).

### ¿Por qué Binance y no una L2 (Base, Robinhood Chain)?

La premisa es correcta frente a Ethereum mainnet, pero la comparación
relevante es con un exchange centralizado:

| | Binance Spot | DEX en Base |
|---|---|---|
| Comisión | 0,1 % (0,075 % con BNB) | 0,05–0,3 % del pool + gas (céntimos) + slippage |
| Stop loss en el exchange | Sí, queda protegido si el bot se cae | No existe nativo: depende de que el bot esté vivo |
| MEV / *sandwich* | No | Sí, en swaps sin protección |
| Riesgos extra | Custodia del exchange | Contratos, puentes, tokens *rug*, aprobaciones |
| Activos | Top ~400 con liquidez profunda | Muchos tokens solo on-chain, mayoría ilíquidos |

Con 400–500 USDT, Binance es igual o más barato y bastante más seguro para
BTC, ETH y altcoins grandes. Una L2 solo aporta si la ventaja está en tokens
que **no** cotizan en exchanges centralizados, que es el segmento de mayor
riesgo. El broker es intercambiable (`src/brokers.js`), así que se puede
añadir un adaptador para Base más adelante sin tocar el resto. Robinhood Chain
conviene verificar su estado actual antes de planear sobre ella. Tampoco hace
falta gastar 100 USDT en herramientas: todas las fuentes de datos de este
sistema son gratuitas.

### Límites que hay que conocer

- El backtest usa un universo fijo (`symbols`). No se puede backtestear Bot 2
  con honestidad sin datos fundamentales "tal como eran" en cada fecha
  (sesgo de supervivencia). Valídalo en paper.
- Probar muchas variantes y quedarse con la mejor siempre da un backtest
  bonito. Por eso existe el periodo reservado; respétalo.

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
npm test                                   # 62 tests
node cli.js plan                           # ver reglas de riesgo activas

# 1) Backtest con datos reales (descarga velas públicas de Binance y las cachea en data/)
node cli.js backtest --from 2021-01-01 --to 2025-01-01
node cli.js backtest --from 2021-01-01 --save-equity equity.csv

# 2) Monte Carlo sobre los trades del backtest: rango de resultados posibles
node cli.js montecarlo --trades-file backtest-trades.json --trades 200
#    ...o con supuestos propios
node cli.js montecarlo --winrate 0.38 --avgwin 2.8 --avgloss 1

# Bot 1: ¿el modelo de dirección tiene ventaja real? + pronóstico actual
node cli.js direction
node cli.js backtest --from 2021-01-01 --direction      # backtest con Bot 1 ajustando la exposición

# Bot 2: ranking de altcoins y universo resultante (se guarda en state/watchlist.json)
node cli.js scan

# Torneo de variantes con periodo reservado
node cli.js tournament --from 2020-01-01 [--direction]

# 3) Paper trading: precios reales, órdenes simuladas (déjalo corriendo semanas)
node cli.js paper                          # con Bot 1 y Bot 2 activos
node cli.js paper --variant lenta          # otra variante en paralelo, en otra terminal
node cli.js paper --no-scanner             # universo fijo de config.symbols
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
- `src/direction.js` — Bot 1: modelo de dirección y su validación.
- `src/scanner.js`, `src/datasources.js` — Bot 2: ranking de altcoins y fuentes públicas.
- `src/tournament.js` — comparación de variantes con periodo reservado.
- `src/backtest.js`, `src/montecarlo.js` — validación.
- `src/runner.js` — bucle de paper/live con estado persistente.
