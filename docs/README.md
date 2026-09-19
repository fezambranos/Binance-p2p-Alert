# Marco SDD — Sistema de monitoreo y operación USDT/VES (Binance P2P)

Este directorio es la **fuente de verdad del diseño**. La regla del proyecto es:
_no se escribe código de una capacidad hasta que exista su especificación aprobada_
(SDD, *Spec-Driven Development*).

## Por qué SDD en este proyecto

No es burocracia: es que aquí **el costo de un error no es un bug, es dinero real
y una cuenta de Binance**. Un cálculo de rentabilidad mal emparejado te hace creer
que ganas cuando pierdes; una alerta mal calibrada te hace vender por debajo del
costo. La especificación previa fuerza a decidir la regla *antes* de que el código
la esconda.

Además hay una razón estadística: este sistema va a "descubrir patrones". Sin una
hipótesis escrita y fechada **antes** de ver los datos, es imposible distinguir un
patrón real de uno que inventamos mirando el ruido. Las specs son el registro
pre-inscrito del experimento.

## Artefactos

| Archivo | Qué fija | Estado |
|---|---|---|
| [`00-vision.md`](00-vision.md) | Problema, objetivos medibles, no-objetivos | Borrador |
| [`01-glosario.md`](01-glosario.md) | Lenguaje ubicuo (un término = un significado) | Borrador |
| [`02-requisitos.md`](02-requisitos.md) | RF-xx / RNF-xx con criterios de aceptación | Borrador |
| [`03-modelo-dominio.md`](03-modelo-dominio.md) | Entidades, eventos, invariantes, esquema | Borrador |
| [`04-metodo-analitico.md`](04-metodo-analitico.md) | Hipótesis, diseño estadístico, anti-sobreajuste | Borrador |
| [`05-riesgos.md`](05-riesgos.md) | Riesgos operativos, de cuenta, de datos y su mitigación | Borrador |
| [`06-roadmap.md`](06-roadmap.md) | Fases, orden y criterio de salida de cada una | Borrador |
| [`07-decisiones-abiertas.md`](07-decisiones-abiertas.md) | Lo que falta decidir y quién decide | Abierto |
| [`adr/`](adr/) | Decisiones de arquitectura, una por archivo, inmutables | — |
| [`specs/`](specs/) | Una spec por capacidad, plantilla en `plantillas/` | — |

## Convenciones de identificadores

- `RF-nn` requisito funcional · `RNF-nn` requisito no funcional
- `H-nn` hipótesis de mercado (falsable, con fecha de registro)
- `ADR-nnnn` decisión de arquitectura
- `SPEC-nnn` especificación de capacidad
- `R-nn` riesgo

**Trazabilidad obligatoria:** todo requisito apunta a una spec, toda spec apunta a
sus pruebas, y el nombre de cada prueba automatizada contiene el ID que verifica
(`test('RF-05 ... ')`). Un requisito sin prueba que lo nombre se considera no
implementado, aunque el código exista.

## Flujo de trabajo

```
Idea → RF/RNF en 02-requisitos.md
     → SPEC-nnn (contrato + casos de aceptación)  ← se revisa aquí, no en el PR
     → ADR si cambia arquitectura
     → pruebas que fallan (nombradas con el ID)
     → implementación mínima hasta verde
     → refactor
     → PR que enlaza SPEC y requisitos
```

### Definition of Ready (una spec se puede implementar si...)

1. Tiene criterios de aceptación en formato Dado/Cuando/Entonces, verificables.
2. Declara sus entradas, salidas y **qué hace ante datos faltantes o corruptos**.
3. Declara qué se registra (telemetría) para saber después si funcionó.
4. Declara explícitamente lo que *no* hace.
5. No depende de una decisión abierta en `07-decisiones-abiertas.md`.

### Definition of Done (una capacidad está terminada si...)

1. Todos sus criterios de aceptación tienen prueba automatizada verde.
2. Los cálculos con dinero tienen pruebas de *golden file* (entrada fija → salida
   fija revisada a mano una vez).
3. La ingesta externa tiene pruebas de contrato contra *fixtures* grabados del
   payload real de Binance, no contra objetos inventados.
4. `npm test` y el linter pasan en CI.
5. La documentación afectada quedó actualizada en el mismo PR.

## Convenciones de código y commits

- Commits convencionales: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
  El cuerpo enlaza el ID: `Refs: RF-05, SPEC-004`.
- Dinero y precios: **nunca** `float` para acumular. Se guarda como entero en la
  unidad mínima o como string decimal; la aritmética pasa por un módulo único.
  Ver `RNF-06` e `INV-3` en el modelo de dominio.
- Todo instante se persiste en UTC ISO-8601. La zona `America/Caracas` (UTC-4, sin
  horario de verano) se aplica **solo** al agregar y presentar. Ver `RNF-03`.
