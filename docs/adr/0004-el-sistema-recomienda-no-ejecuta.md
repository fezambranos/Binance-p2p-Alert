# ADR-0004 · El sistema recomienda, no ejecuta

- **Estado:** Aceptado
- **Fecha:** 2026-09-07
- **Relacionado:** `R-01`, `RNF-05`, `D-09`, no-objetivos en `00-vision.md`

## Contexto

Es técnicamente posible automatizar la publicación de anuncios y la aceptación de
órdenes en el P2P de Binance. La tentación es evidente: el sistema ya va a calcular
el precio y los montos óptimos, publicarlos solo parece un paso más.

Binance trata la automatización del P2P como motivo de bloqueo de cuenta. El
beneficio marginal —ahorrar unos segundos por publicación— es pequeño; el costo de
perder la cuenta es la operación entera.

## Decisión

El sistema **observa, mide, recomienda y contabiliza**. La persona ejecuta.

En concreto:

- No publica, edita ni cancela anuncios.
- No acepta ni crea órdenes.
- No usa claves de API con permisos de operación. Si algún día lee la API C2C para
  conciliar operaciones (`D-09`), será con clave de **solo lectura**, guardada en un
  gestor de secretos y nunca en el repositorio ni en el cliente (`RNF-05`).

Ninguna especificación puede introducir ejecución automática sin un ADR nuevo que
evalúe explícitamente este riesgo y sustituya a este.

## Consecuencias

**A favor**
- El riesgo de bloqueo de cuenta por automatización queda eliminado, no mitigado.
- El diseño se simplifica: sin credenciales de operación, sin máquina de estados de
  órdenes, sin reintentos sobre acciones con efecto de dinero.
- La persona mantiene el juicio sobre la contraparte, que es donde vive el riesgo
  de estafa (`R-07`) y donde el software no aporta.

**En contra**
- Hay latencia humana entre la señal y la acción: algunas oportunidades se pierden.
  Es el costo aceptado.
- El registro de operaciones empieza siendo manual (`D-09`), con el riesgo de
  omisiones que eso conlleva; se compensa con conciliación periódica contra los
  saldos de Binance (`O2`).

## Alternativas descartadas

- **Ejecución automática completa.** Riesgo de cuenta inaceptable frente a un
  beneficio marginal.
- **Semi-automático (el sistema prepara, un clic publica).** Sigue requiriendo
  credenciales de operación y automatiza la parte que Binance vigila. Si alguna vez
  se reconsidera, será con un ADR que lo evalúe de frente.
