# 02 · Requisitos

Formato de aceptación: Dado / Cuando / Entonces. Un requisito sin criterio
verificable no es un requisito, es un deseo.

Prioridad: **P0** imprescindible · **P1** importante · **P2** deseable.

---

## Funcionales

### RF-01 · Ingesta continua del libro (P0)

El sistema captura periódicamente ambos lados del libro USDT/VES con profundidad
suficiente para reconstruir el estado del mercado.

- Dado que el recolector está activo, cuando transcurre el intervalo configurado,
  entonces se persiste una muestra con los N primeros anuncios de ASK y de BID.
- Dado que Binance responde con error o *timeout*, cuando falla la captura,
  entonces se registra una muestra marcada como fallida con el motivo, y **no** se
  omite silenciosamente el intervalo.
- Dado un reintento exitoso dentro del mismo intervalo, cuando ya existe una
  muestra para ese instante, entonces no se duplica (clave de idempotencia).

Campos mínimos por anuncio, además del precio: `advNo`, cantidad disponible, monto
mínimo, monto máximo, métodos de pago, tipo de anunciante, órdenes completadas y
tasa de completación. *(El proxy actual descarta casi todos: ver `SPEC-001`.)*

### RF-02 · Histórico consultable (P0)

- Dado un rango de fechas y una granularidad, cuando se consulta el histórico,
  entonces se devuelve la serie con los huecos **marcados explícitamente**, sin
  interpolar ni rellenar en silencio.
- Dado un hueco de ingesta, cuando se agrega por hora o por día, entonces la
  agregación reporta la cobertura real (% de muestras presentes) junto al valor.

### RF-03 · Precio de referencia robusto (P0)

- Dado un libro crudo y los filtros del operador, cuando se calcula el precio de
  referencia, entonces se descartan los anuncios fuera del rango de montos
  operables, sin los métodos de pago aceptados, o de comerciantes bajo el umbral
  de calidad.
- Dado que tras filtrar quedan menos anuncios que el mínimo configurado, cuando se
  intenta calcular la referencia, entonces se devuelve *sin dato* con el motivo, y
  no un número engañoso.
- Dado un anuncio con precio a más de X desviaciones de la mediana filtrada,
  cuando se calcula la referencia, entonces se excluye y se registra como atípico.

### RF-04 · Registro de operaciones (P0)

- Dado que se completó una operación, cuando se registra, entonces quedan: fecha y
  hora, tipo (COMPRA/VENTA), cantidad en USDT, precio, monto en VES, comisiones,
  método de pago, contraparte y referencia de la orden.
- Dado un registro ya guardado, cuando se necesita corregirlo, entonces se crea un
  **asiento de corrección**; el registro original nunca se modifica ni se borra.
- Dado un identificador de orden ya registrado, cuando se intenta registrar de
  nuevo, entonces se rechaza como duplicado.

### RF-05 · Inventario y costo promedio (P0)

- Dada una compra, cuando se aplica al inventario, entonces el USDT aumenta y el
  `WAC` se recalcula ponderando por cantidad, incluyendo comisiones.
- Dada una venta, cuando se aplica, entonces el USDT disminuye, el `WAC` **no
  cambia**, y se realiza la ganancia contra el `WAC` vigente.
- Dado un intento de venta mayor al inventario, cuando se registra, entonces se
  advierte de inventario negativo y se exige confirmación explícita.
- Dado el mismo conjunto de operaciones en cualquier orden de carga, cuando se
  recalcula, entonces el resultado es idéntico (el orden lo fija la marca de
  tiempo, no la inserción).

### RF-06 · Rentabilidad por periodo (P0)

- Dado un periodo (día, semana, mes, histórico), cuando se solicita el reporte,
  entonces se obtiene: P&L realizado, P&L no realizado, número de operaciones,
  volumen, margen medio y mediano, rotación media, y ROI sobre capital empleado.
- Dado cualquier periodo, cuando se presenta el resultado, entonces se muestra en
  **VES y en USDT equivalente**, porque una ganancia en VES puede ser una pérdida
  en poder adquisitivo.
- Dado el primer día de la semana o del mes, cuando se agrupan periodos, entonces
  se usa la zona `America/Caracas`, con semana de lunes a domingo.

### RF-07 · Margen objetivo y calificación (P0)

- Dado un precio de mercado, el `WAC` y las comisiones, cuando se evalúa una
  posible operación, entonces se califica como **interesante** solo si el margen
  neto proyectado alcanza el margen objetivo vigente.
- Dado un precio por debajo del `breakeven`, cuando se evalúa, entonces se marca
  como **pérdida** de forma inequívoca, sin importar cuán alto parezca.

### RF-08 · Recomendación de precio y montos (P0)

- Dado el libro operable, el inventario y el margen objetivo, cuando se solicita
  una recomendación de publicación, entonces se devuelve el precio sugerido y los
  montos mínimo y máximo del anuncio, con la **justificación** de cada uno.
- Dado que el precio competitivo quedaría por debajo del `breakeven` más el margen
  objetivo, cuando se genera la recomendación, entonces se recomienda **no
  publicar** en vez de sugerir una operación perdedora.
- Dado el inventario disponible y la política de fraccionamiento, cuando se
  calculan los montos, entonces el máximo nunca compromete más del porcentaje
  configurado del inventario en una sola orden.

### RF-09 · Alertas (P1)

- Dado que aparece una oportunidad que califica, cuando se cumple la condición,
  entonces se emite una alerta con precio, margen esperado y montos sugeridos.
- Dado que ya se alertó por la misma condición, cuando se repite dentro del
  periodo de enfriamiento, entonces no se vuelve a alertar.
- Dado un precio oscilando alrededor del umbral, cuando cruza y vuelve a cruzar,
  entonces la histéresis impide una ráfaga de alertas.
- Dado que nuestro anuncio fue desplazado del rango competitivo, cuando se detecta,
  entonces se alerta para reajustar precio.
- Dado un diferencial negativo o un salto de precio superior al límite razonable,
  cuando se detecta, entonces se emite alerta de **datos sospechosos** y se
  suspenden las recomendaciones hasta que se normalice.

### RF-10 · Analítica de patrones temporales (P1)

- Dado el histórico con al menos el mínimo de semanas exigido, cuando se solicita
  el análisis, entonces se obtiene el retorno medio por día de la semana y por
  hora, **sobre retornos sin deriva**, con intervalo de confianza y tamaño de
  muestra.
- Dado un resultado, cuando se presenta, entonces se indica explícitamente si el
  tamaño de muestra alcanza para concluir. Ver `04-metodo-analitico.md`.

### RF-11 · Validación de hipótesis y simulación (P2)

- Dada una regla operativa y un rango histórico, cuando se simula, entonces se
  reporta el resultado **con el modelo de llenado aplicado**, nunca asumiendo que
  todo anuncio se ejecuta.
- Dada una simulación, cuando se reporta, entonces se separan los tramos usados
  para ajustar y los reservados para validar (fuera de muestra).

### RF-12 · Panel de operación (P1)

Vista única con: precio de referencia de ambos lados, diferencial, inventario y
`WAC`, `breakeven`, recomendación vigente, P&L del día y estado de la ingesta.

### RF-13 · Exportación (P2)

- Dado cualquier conjunto de datos, cuando se exporta, entonces se obtiene CSV o
  JSON legible sin el sistema. No debe existir dato que solo viva dentro de la app.

---

## No funcionales

### RNF-01 · Costo
Operación mensual objetivo cercana a cero. **Restricción conocida:** el plan Spark
de Firebase no permite salida de red a servicios externos desde Cloud Functions ni
usar Cloud Scheduler; el hosting del recolector es una decisión abierta (`D-03`).

### RNF-02 · Fiabilidad de ingesta
Cobertura ≥ 98% mensual. Se mide y se muestra; una caída de cobertura invalida el
análisis del periodo afectado y debe ser visible.

### RNF-03 · Tiempo
Persistencia en UTC ISO-8601 con precisión de segundo. Presentación y agregación en
`America/Caracas` (UTC−4 fijo). Ninguna lógica de negocio usa la zona del
dispositivo.

### RNF-04 · Auditabilidad
Las operaciones y las muestras son *append-only*. Toda métrica es derivable de los
eventos crudos. Ningún total se almacena como verdad primaria.

### RNF-05 · Seguridad
Sin claves de Binance mientras no sea necesario; si se añaden, solo lectura, en
gestor de secretos, nunca en el repositorio ni en el cliente. El endpoint público
del proxy debe tener límite de tasa y lista blanca de parámetros.

### RNF-06 · Exactitud numérica
Prohibido acumular dinero en coma flotante. Redondeo definido por moneda y
documentado. Un módulo único para toda la aritmética monetaria.

### RNF-07 · Resiliencia ante la fuente
Toda dependencia del formato de Binance vive en un adaptador aislado, con pruebas
de contrato sobre *fixtures* reales grabados. Un cambio de formato debe romper una
prueba, no producir datos silenciosamente erróneos.

### RNF-08 · Observabilidad
Estado de ingesta, última muestra válida, tasa de error y latencia visibles sin
leer registros del servidor.

### RNF-09 · Reproducibilidad
Todo cálculo analítico es determinista: mismas entradas, misma salida. Sin
dependencia del reloj ni de aleatoriedad no sembrada.

### RNF-10 · Portabilidad
El almacenamiento se aísla tras una interfaz de repositorio, para poder migrar de
proveedor sin reescribir la lógica. Ver `ADR-0002`.
