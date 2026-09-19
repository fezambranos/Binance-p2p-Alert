# 01 · Glosario (lenguaje ubicuo)

Un término, un significado, en documentos, código, base de datos e interfaz. Si un
concepto necesita dos nombres, es que son dos conceptos.

## La ambigüedad más peligrosa: BUY / SELL

En la API de Binance, `tradeType` es **la acción del taker**, no la del anunciante.
`tradeType=BUY` devuelve anuncios de gente que **vende** USDT (los que tú tomarías
para comprar). Confundir esto invierte todo el sistema: comprarías caro y venderías
barato con una lógica que "parece" correcta.

**Regla del proyecto:** en nuestro código y datos **no se usa `BUY`/`SELL` a secas.**
Se usan estos términos, siempre desde la perspectiva del operador:

| Término | Significado | `tradeType` de la API |
|---|---|---|
| `ASK` / lado de oferta | Anuncios donde alguien vende USDT. Es **donde compramos**. | `BUY` |
| `BID` / lado de demanda | Anuncios donde alguien compra USDT. Es **donde vendemos**. | `SELL` |
| `COMPRA` | Operación nuestra: entregamos VES, recibimos USDT. | — |
| `VENTA` | Operación nuestra: entregamos USDT, recibimos VES. | — |

La traducción entre nuestro vocabulario y el de Binance ocurre en **un solo módulo
adaptador** y en ningún otro lugar. Ver `RNF-07`.

## Términos

**Anuncio (`Ad`)** — Oferta publicada por un comerciante: precio, cantidad
disponible, monto mínimo y máximo por orden, métodos de pago, y estadísticas del
anunciante. Identificado por `advNo`.

**Libro (`OrderBook`)** — Conjunto de anuncios vigentes de un lado del mercado en
un instante. Nuestro *snapshot* guarda profundidad, no solo el mejor precio.

**Muestra (`Snapshot`)** — Captura fechada de ambos lados del libro. Es el registro
atómico del histórico. Inmutable.

**Mejor precio (`top`)** — El precio del primer anuncio del libro. **No es el
precio de mercado**: puede ser un anuncio de 5 USDT con límites absurdos, o una
carnada. Se guarda pero casi nunca se usa para decidir.

**Precio de referencia (`refPrice`)** — Precio robusto calculado a partir del libro
**filtrado** por los criterios operativos reales (monto, método de pago, calidad
del comerciante) y ponderado por profundidad. Es el precio que el sistema usa para
decidir. Su definición exacta vive en `SPEC-003`.

**Libro operable (`tradableBook`)** — Subconjunto del libro tras aplicar los
filtros del operador. Todo cálculo de referencia y de recomendación parte de aquí,
nunca del libro crudo.

**Diferencial (`spread`)** — `refPrice(BID) − refPrice(ASK)`. Es el margen bruto
por vuelta completa disponible en el mercado en ese momento, antes de comisiones.
Puede ser negativo (mercado cruzado o datos malos): eso es una señal de alerta, no
un dato para usar.

**Inventario (`Inventory`)** — Posición simultánea en dos monedas: `USDT` y `VES`.
El sistema siempre las reporta juntas; hablar de "el saldo" sin decir en cuál
moneda es un error de diseño.

**Costo promedio ponderado (`WAC`)** — Costo unitario del USDT en inventario,
recalculado en cada compra. Es la base contra la que se mide si una venta gana o
pierde. Método contable elegido en `ADR-0003`.

**Precio de equilibrio (`breakeven`)** — Precio de venta al que la operación no
gana ni pierde: `WAC` más todas las comisiones y costos aplicables. **Vender por
debajo del breakeven es pérdida, aunque el precio parezca alto.**

**Margen objetivo (`targetMargin`)** — Porcentaje mínimo sobre el `breakeven` que
hace que una operación sea "interesante". Es configurable y puede depender del
contexto (hora, día, tamaño). Es el corazón del sistema de calificación.

**Precio de publicación (`quotePrice`)** — Precio recomendado para nuestro anuncio.
Resulta de tres restricciones simultáneas: (a) ser competitivo frente al libro
operable, (b) no violar el `breakeven` más el `targetMargin`, (c) respetar el
paso de precio del mercado.

**Ciclo (`RoundTrip`)** — Emparejamiento contable de compras y ventas que produce
una ganancia realizada. No es una operación: es la consecuencia de dos o más.

**P&L realizado** — Ganancia de USDT que ya salió del inventario contra su `WAC`.

**P&L no realizado** — Diferencia entre el `refPrice` actual y el `WAC` del
inventario que aún tenemos. Sube y baja sin que operemos.

**Rotación** — Tiempo entre que se compra un USDT y se vende. Un margen del 1% con
rotación de 3 horas vale mucho más que un 3% con rotación de una semana; el sistema
debe reportar margen **y** rotación, nunca margen solo.

**Probabilidad de llenado (`fillRate`)** — Probabilidad estimada de que un anuncio
publicado a cierto precio sea tomado dentro de una ventana de tiempo. Es lo que
convierte un precio "bonito" en un precio "ejecutable". Se estima con el histórico
del libro, no se asume. Ver `SPEC-009`.

**Deriva estructural (`drift`)** — Tendencia alcista de fondo del USDT/VES por
devaluación e inflación. **No es ganancia y no es un patrón operable**: hay que
removerla de los datos antes de buscar patrones semanales, o la confundiremos con
uno. Ver `04-metodo-analitico.md`.
