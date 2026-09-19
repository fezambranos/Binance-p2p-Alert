# 00 · Visión y alcance

## Problema

Operar USDT/VES en el P2P de Binance como *maker* (publicando anuncios) es
rentable por diferencial, pero hoy se hace **a ojo**: no hay registro del precio
histórico, no hay forma de saber si un precio ofrecido es bueno o malo respecto a
la última hora, no hay medición real de rentabilidad, y las decisiones de a qué
precio publicar dependen de mirar la app y recordar.

Consecuencias concretas:

- Se publica a un precio que parece bueno pero está por debajo del costo promedio
  del inventario → pérdida disfrazada de venta.
- No se distingue una ganancia real de una devaluación del bolívar: acumular VES
  "ganando" mientras el USDT sube es perder poder adquisitivo.
- Las corazonadas sobre patrones semanales no se pueden confirmar ni refutar
  porque no existe el histórico para hacerlo.

## Usuario

Un único operador (persona física), operando con capital propio, desde teléfono y
computador, en horario de Venezuela.

## Propuesta

Un sistema que **observa, mide, recomienda y contabiliza** — pero **no ejecuta**.

1. **Observa**: captura el libro de anuncios P2P USDT/VES de forma continua y lo
   guarda con calidad suficiente para analizarlo después.
2. **Mide**: calcula un precio de referencia robusto, el diferencial disponible y
   la rentabilidad real de las operaciones cerradas.
3. **Recomienda**: dado el inventario, el costo promedio y el margen objetivo,
   dice a qué precio y con qué montos mínimo/máximo publicar el anuncio, y avisa
   cuando aparece una oportunidad que califica.
4. **Contabiliza**: lleva el libro de operaciones y la rentabilidad diaria,
   semanal, mensual y acumulada.

## Objetivos medibles (12 meses)

| # | Objetivo | Métrica | Meta |
|---|---|---|---|
| O1 | Tener histórico utilizable | Cobertura de muestras del libro | ≥ 98% de los intervalos esperados |
| O2 | Saber cuánto se gana de verdad | Operaciones conciliadas contra Binance | 100% del mes en curso |
| O3 | Decidir el precio con criterio | Publicaciones hechas con precio recomendado | ≥ 80% |
| O4 | Confirmar o descartar el patrón semanal | Semanas de datos limpios acumuladas | ≥ 24 antes de concluir |
| O5 | Margen neto por ciclo compra→venta | Mediana del margen neto | ≥ el margen objetivo configurado |
| O6 | No perder capital medido en USDT | Capital en USDT equivalente | Creciente mes a mes |

`O6` es el objetivo real. Los demás existen para soportarlo.

## No-objetivos (explícitos)

Se declaran para que nadie los implemente "de paso":

- **No publica, edita ni acepta órdenes automáticamente en Binance.** El sistema
  recomienda; la persona ejecuta. Automatizar la operación es lo que hace que
  Binance bloquee cuentas, y el beneficio marginal no compensa perder la cuenta.
  Ver `R-01`.
- **No es un bot de trading ni promete predecir el precio.** Detectar una
  regularidad estadística no es una garantía.
- **No es multiusuario, no es un producto, no tiene cuentas ni roles.** Un solo
  operador. Si algún día cambia, será un ADR nuevo, no una suposición de hoy.
- **No maneja otros pares al inicio.** El modelo se diseña genérico
  (activo/fiat), pero solo se valida con USDT/VES.
- **No custodia fondos ni toca claves privadas.** Si algún día lee la API de
  Binance, será con clave de **solo lectura**. Ver `RNF-05`.
- **No da asesoría financiera ni tributaria.** El registro sirve para operar, no
  sustituye contabilidad formal.

## Restricción de fondo

Los datos vienen de un endpoint **no documentado y no versionado** de Binance
(`/bapi/c2c/v2/friendly/c2c/adv/search`). Puede cambiar de forma o dejar de
responder sin aviso. Todo el sistema debe degradarse de forma visible —nunca
silenciosa— cuando eso pase. Ver `RNF-07` y `R-06`.
