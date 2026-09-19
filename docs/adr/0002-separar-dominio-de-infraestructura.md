# ADR-0002 · Separar dominio de infraestructura tras interfaces de repositorio

- **Estado:** Propuesto
- **Fecha:** 2026-09-07
- **Relacionado:** `RNF-10`, `RNF-07`, `D-03`

## Contexto

Dónde corre el recolector y dónde se guardan los datos está sin decidir (`D-03`),
y la decisión es urgente porque bloquea la Fase 1 entera. Al mismo tiempo, la
fuente de datos es un endpoint no documentado de Binance que puede cambiar sin
aviso (`R-06`).

Si la lógica de negocio se escribe contra el SDK de un proveedor concreto y contra
la forma exacta del JSON de Binance, ambas decisiones quedan soldadas al código y
cambiar cualquiera de las dos obliga a reescribir el sistema.

## Decisión

Tres capas, con las dependencias apuntando siempre hacia adentro:

- **Dominio** — cálculo puro: precio de referencia, inventario, `WAC`, `breakeven`,
  margen, recomendación. Sin entrada/salida, sin reloj, sin red. Determinista y
  comprobable sin infraestructura (`RNF-09`).
- **Puertos** — interfaces que el dominio necesita: `SnapshotRepository`,
  `TradeRepository`, `MarketDataSource`, `Clock`, `Notifier`.
- **Adaptadores** — las implementaciones concretas: el cliente de Binance, el
  almacenamiento del proveedor que se elija, el canal de alertas, el reloj real.

El adaptador de Binance es el **único** lugar donde se traduce `BUY`/`SELL` al
vocabulario `ASK`/`BID` del proyecto (ver glosario) y el único que conoce la forma
del JSON externo.

## Consecuencias

**A favor**
- `D-03` deja de bloquear: se puede empezar a escribir dominio y pruebas hoy con un
  repositorio en memoria o en archivos, y enchufar el proveedor real después.
- Un cambio de formato en Binance rompe una prueba de contrato del adaptador, no
  produce cifras silenciosamente erróneas.
- El dominio se prueba sin red ni base de datos, lo que hace las pruebas rápidas y
  deterministas.

**En contra**
- Una capa de indirección más para un proyecto de una sola persona.
- Hay que mantener dobles de prueba de los puertos.

## Alternativas descartadas

- **Escribir directo contra el SDK del proveedor.** Descartada: ata la decisión más
  cara del proyecto (`D-03`) antes de haberla tomado.
- **Esperar a decidir `D-03` para empezar.** Descartada: el histórico no se puede
  recuperar hacia atrás; cada día de espera es un dato perdido para siempre.
