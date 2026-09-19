# ADR-0001 · Adoptar desarrollo dirigido por especificación (SDD)

- **Estado:** Aceptado
- **Fecha:** 2026-09-07

## Contexto

El sistema toma decisiones sobre dinero real y va a "descubrir patrones" en datos
de mercado. Dos riesgos concretos:

1. Una regla de cálculo equivocada no se manifiesta como un error visible, sino
   como una cifra plausible pero falsa. Se puede operar meses con pérdidas creyendo
   que se gana (`R-02`).
2. Sin una hipótesis escrita **antes** de mirar los datos, es imposible distinguir
   un patrón real de uno construido a posteriori sobre el ruido (`R-03`).

Escribir el código primero y documentar después no protege contra ninguno de los
dos: la regla queda enterrada en la implementación y la hipótesis se moldea al
resultado.

## Decisión

Ninguna capacidad se implementa sin una especificación aprobada previamente, con
criterios de aceptación verificables. Las hipótesis de mercado se registran con
fecha antes de recolectar los datos que las pondrán a prueba.

La trazabilidad es obligatoria: requisito → spec → prueba automatizada que nombra
su identificador. Un requisito sin prueba que lo nombre se considera no
implementado aunque exista el código.

## Consecuencias

**A favor**
- La regla de negocio queda escrita en un lugar legible y discutible antes de
  esconderse en el código.
- Las hipótesis pre-registradas hacen posible una conclusión honesta.
- Las pruebas nombradas por identificador dan cobertura verificable de un vistazo.

**En contra**
- Cada capacidad cuesta un paso previo. En un proyecto de un solo desarrollador
  puede sentirse lento al principio.
- Las specs se desactualizan si no se mantienen en el mismo PR que el código; por
  eso está en la *Definition of Done*.

## Alternativas descartadas

- **Código primero, documentar después.** Descartada: es exactamente lo que
  produce reglas de cálculo no auditables y patrones ajustados a posteriori.
- **Solo pruebas (TDD sin spec).** Las pruebas fijan el comportamiento pero no el
  *porqué*, y no sirven como registro previo de una hipótesis de mercado.
