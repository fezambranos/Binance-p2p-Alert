# 07 · Decisiones abiertas

Ninguna spec puede aprobarse mientras dependa de una decisión abierta. Cada
decisión resuelta se cierra con un ADR.

| ID | Decisión | Bloquea | Recomendación |
|---|---|---|---|
| D-01 | **Moneda base de medición.** ¿El desempeño se juzga en USDT o en VES? | `RF-06`, Fase 2 | **USDT.** El VES pierde valor de forma estructural; medir en VES puede mostrar un mes ganador que en realidad destruyó poder adquisitivo. El VES se reporta siempre, pero la métrica de éxito es el crecimiento del capital en USDT. |
| D-02 | **Método contable.** ¿WAC o FIFO? | `RF-05`, Fase 2 | **WAC** como principal (inventario fungible, mucho más simple), guardando lotes para poder derivar rotación FIFO como métrica secundaria. |
| D-03 | **Dónde corre el recolector 24/7.** Firebase Blaze, Cloudflare Workers + D1, un VPS pequeño, o GitHub Actions. | **Fase 1 entera** | Es la decisión más urgente. Firebase Spark **no sirve** (sin salida de red externa ni Cloud Scheduler). Blaze mantiene el stack actual y cuesta centavos, pero exige tarjeta y tiene riesgo de factura. Cloudflare Workers + D1 tiene *cron* y base de datos SQL en plan gratuito, encaja muy bien con series temporales y no requiere tarjeta. GitHub Actions es gratis pero con *cron* poco puntual y omisiones frecuentes: inaceptable para `RNF-02`. |
| D-04 | **Canal de alertas.** ¿Pestaña abierta (actual), notificaciones push, o Telegram? | `RF-09`, Fase 4 | **Telegram.** Llega con el teléfono bloqueado, no depende del navegador, es gratis y se implementa en una tarde. El navegador queda como complemento, no como mecanismo principal (`R-09`). |
| D-05 | **Frecuencia de muestreo.** ¿1, 2 o 5 minutos? | `RF-01` | **2 minutos** para empezar: ~720 muestras/día, resolución de sobra para patrones intradiarios y lejos de un uso agresivo del endpoint (`R-05`). Se puede densificar después; no se puede densificar hacia atrás. |
| D-06 | **Filtros del libro operable.** Rango de montos, métodos de pago aceptados, mínimo de órdenes y tasa de completación del comerciante. | `RF-03`, Fase 3 | Requiere la operativa real: **necesito tus valores.** Es el parámetro que más cambia el precio de referencia. |
| D-07 | **Comisiones y costos reales.** Comisión de maker en tu cuenta, costos bancarios por transferencia y por pago móvil. | `RF-07`, `breakeven` | **Nunca asumir cero.** Sin estos números el `breakeven` es ficción y toda calificación de "operación interesante" está mal. |
| D-08 | **Capital operativo y política de fraccionamiento.** Capital total y exposición máxima por orden. | `RF-08` | Necesito el capital y qué fracción aceptas comprometer en una sola orden (un valor típico es 20–30%, para poder reponer sin quedar bloqueado). |
| D-09 | **Importación desde Binance.** ¿Registrar operaciones a mano siempre, o intentar la API C2C con clave de solo lectura? | Fase 2 | Empezar **manual** con el esquema listo para importar. Evaluar la API cuando el registro manual ya funcione; una clave de solo lectura es aceptable, una con permisos de operación no (`R-01`, `RNF-05`). |
| D-10 | **Lenguaje y stack de la analítica.** JavaScript (continuidad con el repo) o Python (mejor instrumental estadístico). | Fase 5 | Ingesta y app en **JS**; analítica en **Python** sobre los datos exportados. Separarlos es sano: el análisis no debe estar acoplado a la app. |

## Pendientes de datos del operador

Para cerrar `D-06`, `D-07` y `D-08` hacen falta estos números concretos:

- Rango de montos en VES con el que operas normalmente (mínimo y máximo por orden).
- Métodos de pago que aceptas y cuáles rechazas.
- Comisión que te cobra Binance al publicar, y costo bancario por transferencia.
- Capital operativo total y exposición máxima que aceptas por orden.
- Margen objetivo con el que consideras que una operación vale la pena.
