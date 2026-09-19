# ADR-0003 · Costo promedio ponderado (WAC) como método contable

- **Estado:** Propuesto
- **Fecha:** 2026-09-07
- **Relacionado:** `RF-05`, `RF-06`, `D-01`, `D-02`, `INV-2`, `INV-6`

## Contexto

Para saber si una venta gana o pierde hace falta un costo contra el que medirla.
Hay dos formas de emparejar compras con ventas, y **dan números distintos sobre las
mismas operaciones**:

- **FIFO** — cada venta se empareja con las compras más antiguas. Produce ciclos
  identificables y permite medir rotación real, pero obliga a llevar lotes.
- **WAC** — un solo costo unitario, recalculado en cada compra. Mucho más simple.

Elegir tarde, o mezclar ambos, produce cifras irreconciliables y destruye la
comparabilidad entre periodos.

## Decisión

**WAC como método principal.** El USDT es fungible: en un inventario mezclado no
existe "el USDT que compré el martes", así que el costo promedio refleja mejor cómo
se opera realmente.

Complementos:

- Se **guardan además los lotes de compra**, para poder derivar rotación FIFO como
  métrica secundaria (`RF-06`) sin cambiar la contabilidad principal.
- El `breakeven` se define como `WAC` más todas las comisiones aplicables. Ninguna
  recomendación de venta puede quedar por debajo salvo marcada como liquidación
  (`INV-6`).
- La venta se realiza contra el `WAC` vigente en `occurredAt`, no contra el actual
  (`INV-2`): una operación cargada tarde no debe reescribir la ganancia de otra.
- La moneda base de medición del desempeño es el **USDT** (`D-01`): medir en VES
  puede mostrar un mes ganador que en realidad destruyó poder adquisitivo (`R-04`).

## Consecuencias

**A favor**
- Una sola cifra de costo, fácil de mostrar y de entender mientras se opera.
- El `breakeven` es inmediato, que es lo que hace falta al decidir un precio.
- Sin emparejamientos que mantener para el cálculo principal.

**En contra**
- No hay un "ciclo" contable natural: la rotación es una métrica derivada de los
  lotes, no una consecuencia del método.
- Si algún día hiciera falta contabilidad formal con criterio FIFO, habría que
  recalcular desde los eventos. Es posible —los eventos son la fuente de verdad
  (`RNF-04`)— pero es trabajo.

## Alternativas descartadas

- **FIFO como principal.** Más complejidad de lotes en el camino crítico, para un
  activo fungible donde el emparejamiento es una ficción contable.
- **Mezclar según convenga.** Descartada por definición: dos métodos conviviendo
  producen totales que no cuadran entre sí.
