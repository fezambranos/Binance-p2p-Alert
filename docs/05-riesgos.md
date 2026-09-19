# 05 · Riesgos

| ID | Riesgo | Impacto | Prob. | Mitigación |
|---|---|---|---|---|
| R-01 | Automatizar la publicación o aceptación de órdenes viola los términos de Binance y bloquea la cuenta | Crítico | Media si se automatiza | **No-objetivo explícito** (`00-vision.md`). El sistema recomienda, la persona ejecuta. Ninguna spec puede introducir ejecución automática sin un ADR que lo evalúe. |
| R-02 | Cálculo de rentabilidad erróneo → se opera con pérdida creyendo que se gana | Crítico | Media | Pruebas de *golden file* sobre casos revisados a mano; doble contabilidad VES/USDT; asientos de corrección en vez de ediciones. |
| R-03 | Sobreajuste: "descubrir" un patrón que es ruido | Alto | **Alta** | Pre-registro de hipótesis, muestra reservada, corrección por comparaciones múltiples, validación hacia adelante (`04-metodo-analitico.md`). |
| R-04 | Confundir la devaluación del VES con ganancia | Alto | Alta | Métrica principal en USDT (`O6`, `D-01`); todo reporte en dos monedas. |
| R-05 | Límite de tasa o bloqueo de IP por consultar Binance con demasiada frecuencia | Alto | Media | Intervalo conservador, *backoff* exponencial, un solo recolector, cabeceras realistas, alerta ante 429/403. |
| R-06 | El endpoint no documentado cambia de formato o desaparece | Alto | Media | Adaptador aislado + pruebas de contrato sobre *fixtures* reales; fallo ruidoso, nunca silencioso (`RNF-07`). |
| R-07 | Estafa o reverso de pago de la contraparte | Crítico | Media | Fuera del alcance del software, pero el registro guarda contraparte y método para detectar patrones; filtros de calidad del comerciante en el libro operable. |
| R-08 | El proxy es un endpoint público sin autenticación: abuso o costo | Medio | Media | Límite de tasa, lista blanca de parámetros (ya existe), restricción de origen, alerta por volumen anómalo. |
| R-09 | Alertas basadas en la pestaña abierta del navegador: no llegan | Medio | **Alta** | Es la limitación real de la app actual (el propio README la admite). Mover las alertas a un canal servidor→dispositivo (`D-04`). |
| R-10 | Ganancias inmovilizadas: márgenes buenos pero rotación pésima | Medio | Media | Métrica de ganancia por hora de capital comprometido; límite de exposición por orden. |
| R-11 | Costos ocultos (comisión de maker, costos bancarios, redondeos) comen el margen | Medio | Alta | Comisiones **parametrizadas y nunca asumidas cero**; el `breakeven` las incluye por definición. |
| R-12 | Huecos de ingesta que invalidan un análisis sin que nos demos cuenta | Medio | Media | Cobertura medida y mostrada junto a cada agregado; exclusión automática de tramos con baja cobertura. |
| R-13 | Concentración: el análisis solo mira el mejor precio, que suele ser una carnada | Medio | Alta | El libro operable y el precio de referencia filtrado sustituyen al "top" en toda decisión (`RF-03`). |
| R-14 | Pérdida de datos por caducidad del plan gratuito o del proveedor | Alto | Baja | Exportación periódica (`RF-13`) y respaldo fuera del proveedor; repositorio de almacenamiento aislado (`RNF-10`). |

## Riesgos que aceptamos conscientemente

- El sistema **no predice el precio** y puede recomendar esperar mientras el
  mercado se mueve. Se acepta: preferimos no operar a operar con pérdida.
- El histórico refleja **anuncios, no operaciones ejecutadas**. Es la única fuente
  disponible públicamente; el modelo de llenado existe precisamente para corregir
  esa distancia, y aun así es una estimación.
