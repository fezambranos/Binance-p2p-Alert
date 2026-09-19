# 06 · Fases

Cada fase tiene un **criterio de salida** verificable. No se avanza sin cumplirlo.

## Regla que ordena todo el plan

El activo más valioso del proyecto es el **histórico**, y es el único que **no se
puede recuperar después**. Un día sin recolectar es un día perdido para siempre.
Por eso la ingesta va primero, incluso antes de que exista analítica que la use, e
incluso antes de terminar de decidir el resto.

---

## Fase 0 — Base existente (hecha, con deuda)

Ya en el repositorio: proxy a Binance (`functions/`) y PWA de alerta por umbral
(`web/`).

Deuda conocida que las fases siguientes deben resolver:
- El proxy consulta **un solo lado** del libro y descarta la mayoría de los campos.
- No persiste nada: cada lectura se pierde.
- La alerta depende de una pestaña abierta con la pantalla encendida (`R-09`).
- El README afirma que el plan gratuito de Firebase alcanza; para el recolector
  **no alcanza** (`RNF-01`).

## Fase 1 — Ingesta e histórico · **P0, primero**

`RF-01`, `RF-02`, `RNF-02`, `RNF-03`, `RNF-07`, `RNF-08`
Specs: `SPEC-001` (adaptador y captura), `SPEC-002` (almacenamiento y consulta).

- Adaptador con ambos lados del libro, profundidad 20, todos los campos de `RF-01`.
- Recolector programado, idempotente, con reintento y registro de fallos.
- Almacenamiento tras interfaz de repositorio + consulta por rango con cobertura.
- Panel mínimo de salud de ingesta.

**Criterio de salida:** 7 días consecutivos con cobertura ≥ 98% y exportación del
histórico verificada.

## Fase 2 — Operaciones y rentabilidad · P0

`RF-04`, `RF-05`, `RF-06`, `RNF-04`, `RNF-06`
Specs: `SPEC-004` (libro de operaciones), `SPEC-005` (inventario y WAC),
`SPEC-006` (reportes por periodo).

- Registro manual rápido (pocos segundos por operación, desde el teléfono).
- Inventario, `WAC` y `breakeven` derivados de eventos.
- P&L diario/semanal/mensual/histórico, en VES y USDT.

**Criterio de salida:** un mes de operaciones reales cargado y cuadrado contra los
saldos de Binance con diferencia cero.

## Fase 3 — Precio de referencia y calificación · P0

`RF-03`, `RF-07`
Specs: `SPEC-003` (precio de referencia y libro operable),
`SPEC-007` (margen objetivo y calificación).

**Criterio de salida:** durante 2 semanas, la calificación del sistema coincide con
el juicio del operador en ≥ 90% de los casos; los desacuerdos quedan documentados y
alguno cambia una regla.

## Fase 4 — Recomendación y alertas · P0/P1

`RF-08`, `RF-09`, `RF-12`
Specs: `SPEC-008` (recomendación de precio y montos), `SPEC-010` (alertas y
antirruido), `SPEC-011` (panel).

**Criterio de salida:** ≥ 80% de las publicaciones se hacen con el precio
recomendado (`O3`) y ninguna alerta falsa repetida en una semana.

## Fase 5 — Analítica de patrones · P1

`RF-10`
Spec: `SPEC-012` (estacionalidad por día y hora).

Arranca cuando haya ≥ 8 semanas de datos limpios. Con menos, el resultado no es
informativo y publicarlo solo genera confianza injustificada.

**Criterio de salida:** informe de H-01 y H-02 con tamaño de muestra, intervalos de
confianza y una conclusión explícita, incluida la conclusión "aún no alcanza".

## Fase 6 — Llenado y simulación · P2

`RF-11`
Specs: `SPEC-009` (modelo de probabilidad de llenado), `SPEC-013` (simulación).

**Criterio de salida:** el margen simulado fuera de muestra no se aleja más de un
umbral acordado del margen realmente obtenido en el periodo equivalente.

---

## Lo que se puede empezar hoy sin decidir nada más

1. Fijar `SPEC-001` y `SPEC-002` y poner el recolector a correr.
2. Empezar a registrar operaciones **aunque sea en una hoja de cálculo** con el
   esquema de `TradeEvent` — así la Fase 2 importa historia real en vez de nacer
   vacía.
