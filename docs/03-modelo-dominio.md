# 03 · Modelo de dominio

## Principio: eventos primero

La verdad del sistema son dos flujos inmutables y solo-añadir:

- **Muestras del libro** — lo que el mercado ofrecía en cada instante.
- **Eventos de operación** — lo que nosotros hicimos.

Todo lo demás (inventario, `WAC`, P&L, métricas, patrones) es **derivado** y
recalculable desde cero. Ningún total se guarda como verdad primaria; si se guarda,
es como caché con su origen identificado.

Esto no es purismo: es lo que permite corregir un error de comisión de hace tres
meses y que todas las métricas se recompongan solas, en vez de arrastrar el error
para siempre.

## Entidades

### `Snapshot` (muestra del libro)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | string | Determinista: `USDT-VES-<epochMinuto>`. Da idempotencia (`RF-01`). |
| `capturedAt` | UTC ISO-8601 | Instante de captura. |
| `pair` | `{asset, fiat}` | `USDT` / `VES`. |
| `ask[]`, `bid[]` | `AdSnapshot[]` | Profundidad configurable, por defecto 20 por lado. |
| `status` | `ok` \| `partial` \| `failed` | Un fallo se **registra**, no se omite. |
| `error` | string? | Motivo cuando no es `ok`. |
| `latencyMs` | int | Salud de la fuente. |
| `sourceVersion` | string | Versión del adaptador que la produjo (`RNF-07`). |

### `AdSnapshot` (anuncio dentro de una muestra)

`advNo`, `price`, `availableQty`, `minAmount`, `maxAmount`, `payTypes[]`,
`merchantType`, `completedOrders`, `completionRate`, `avgReleaseMinutes`, `rank`.

`rank` (posición en el libro) es lo que después permite estimar la probabilidad de
llenado (`SPEC-009`). Sin él, no se puede.

> **Brecha actual:** `functions/binanceP2PProxy.js` solo conserva precio, montos,
> nombre y métodos de pago, de un solo lado, y no persiste nada. `SPEC-001` lo
> corrige.

### `TradeEvent` (operación)

| Campo | Nota |
|---|---|
| `id` | Identificador de la orden en Binance cuando exista; si no, UUID. |
| `occurredAt` | UTC. **Ordena la contabilidad**, no la fecha de inserción. |
| `side` | `COMPRA` \| `VENTA` (nunca `BUY`/`SELL`, ver glosario). |
| `qtyUsdt`, `price`, `amountVes` | Se guardan los tres y se valida la coherencia. |
| `feeUsdt`, `feeVes` | Comisión de Binance y costo bancario. **No se asumen cero.** |
| `payType`, `counterparty` | Para análisis por método y por contraparte. |
| `note`, `source` | `manual` \| `import`. |
| `correctionOf` | Si es un asiento de corrección, el `id` corregido (`RF-04`). |

### `Position` (derivada)

`usdt`, `ves`, `wac`, `breakeven`, `unrealizedPnl`, `asOf`. Función pura del flujo
de `TradeEvent` hasta un instante dado.

### `Recommendation` (derivada, efímera)

`side`, `quotePrice`, `minAmount`, `maxAmount`, `expectedMarginPct`,
`expectedFillMinutes`, `rationale[]`, `basedOnSnapshotId`.

`rationale` es obligatorio: una recomendación de precio sin explicación no se puede
auditar cuando sale mal, y saldrá mal alguna vez.

## Invariantes

- **INV-1** El inventario de USDT nunca es negativo sin un evento de confirmación
  explícita que lo autorice.
- **INV-2** Toda venta se realiza contra el `WAC` vigente en `occurredAt`, no
  contra el actual.
- **INV-3** `amountVes` y `qtyUsdt · price` no difieren más allá del redondeo
  declarado; si difieren, la operación se marca para revisión en vez de guardarse
  como buena.
- **INV-4** Un `Snapshot` nunca se modifica. Un error se corrige con una muestra
  nueva, nunca sobrescribiendo.
- **INV-5** Ninguna recomendación se emite desde una muestra con `status != ok` o
  más antigua que el límite de frescura configurado.
- **INV-6** `breakeven = WAC + comisiones aplicables`. Ninguna recomendación de
  venta puede quedar por debajo salvo marcada explícitamente como liquidación.

## Contabilidad: la decisión que más importa

Hay dos maneras de emparejar compras con ventas y **dan números distintos**:

- **FIFO** — cada venta se empareja con las compras más antiguas. Da ciclos
  identificables y permite medir rotación real, pero requiere llevar lotes.
- **Costo promedio ponderado (WAC)** — una sola cifra de costo, recalculada en cada
  compra. Mucho más simple y refleja mejor cómo se opera realmente un inventario
  fungible.

Propuesta: **WAC como método principal** (`ADR-0003`), guardando además los lotes
para poder calcular rotación FIFO como métrica secundaria. Se decide una vez y se
respeta; mezclarlos a mitad de camino produce cifras irreconciliables.

## Contabilidad en dos monedas

Una operación de compra convierte VES en USDT; una venta hace lo contrario.
Reportar "gané X bolívares" es insuficiente cuando el bolívar se devalúa: se puede
cerrar un mes con más VES y menos poder adquisitivo.

Regla: **la moneda base de medición del desempeño es el USDT.** El VES se reporta
siempre, pero `O6` se juzga en USDT. Esto se confirma en `D-01`.
