# 04 · Método analítico

## Hipótesis registradas

Se registran **con fecha, antes de recolectar**, para que después no se pueda
ajustar la hipótesis a lo que salga. Esa es toda la gracia.

### H-01 — Patrón semanal (observación del operador, 2026-09-07)

> "De lunes a jueves el precio sube hasta su tope; al final de la semana baja, y
> vuelve a subir el domingo por la noche."

- **Base actual:** dos semanas de observación informal, sin registro.
- **Estado:** *no confirmada*. Con dos ciclos no se puede distinguir de la
  casualidad — son literalmente dos observaciones del fenómeno.
- **Forma falsable:** el retorno medio **sin deriva** de lunes a jueves es
  positivo y el de viernes a domingo negativo, con significación estadística tras
  corregir por comparaciones múltiples.

### H-02 — Patrón intradiario

> Hay horas del día con precios sistemáticamente mejores para comprar o vender
> (apertura bancaria, horario laboral, madrugada).

Se registra aparte porque **se puede validar mucho antes que H-01**: cada día
aporta una observación de cada hora, mientras que cada semana aporta solo una
observación de cada día de la semana.

### H-03 — Diferencial cosechable

> El diferencial entre el lado de compra y el de venta, filtrado por el libro
> operable, supera de forma consistente el margen objetivo más las comisiones.

Es la hipótesis **más importante y la menos glamorosa**: si es cierta, el negocio
funciona haciendo mercado, sin predecir nada. H-01 y H-02 solo aportarían un sesgo
sobre esa base — cuánto inventario cargar antes de una subida esperada.

**Orden de prioridad: H-03 primero.** Da resultados operativos en días, mientras
H-01 acumula evidencia durante meses.

---

## La trampa que hay que evitar: la deriva

El USDT/VES sube de forma estructural por devaluación. Con esa deriva presente,
**cualquier** análisis ingenuo dirá que casi todos los días son "alcistas", y si un
día de la semana tiene menos datos o cae más cerca de un salto, aparecerá un
"patrón" que no existe.

Procedimiento obligatorio antes de cualquier conclusión:

1. Trabajar con **retornos logarítmicos**: `r_t = ln(P_t / P_{t-1})`, no con
   precios.
2. **Remover la deriva**: restar la media móvil centrada (ventana de 7 días) o,
   equivalentemente, estimar el modelo
   `r_t = μ + Σ_d β_d · D_d + ε_t`
   donde `D_d` son variables indicadoras de día de la semana, y contrastar
   `H0: β_d = 0`. El término `μ` absorbe la deriva; los `β_d` son el patrón real.
3. **Errores estándar robustos** (Newey-West / HAC) o *bootstrap* por bloques: los
   retornos financieros no son homocedásticos ni independientes, y usar el error
   estándar clásico infla la significación.
4. **Corregir por comparaciones múltiples** (Bonferroni o Benjamini-Hochberg):
   probar 7 días son 7 pruebas. Sin corregir, la probabilidad de encontrar al
   menos un "día significativo" por puro azar es cercana al 30%.

## Cuántos datos hacen falta

Para detectar un efecto de tamaño `δ` en el retorno medio de un día, con desviación
diaria `σ`, potencia 80% y α = 5%:

```
n ≈ (1.96 + 0.84)² · σ² / δ²  = 7.84 · σ² / δ²   observaciones de ese día
```

Con una volatilidad diaria del orden de σ = 0.6%:

| Efecto real a detectar (δ) | Semanas necesarias | Corrigiendo por 7 pruebas |
|---|---|---|
| 1.0 % / día | ~3 | ~5 |
| 0.5 % / día | ~11 | ~18 |
| 0.3 % / día | ~31 | ~48 |

Lectura honesta: **si el patrón semanal es fuerte, se verá en unas semanas; si es
sutil, hará falta medio año o más.** Por eso `O4` exige 24 semanas antes de
concluir, y por eso empezar a recolectar hoy vale más que cualquier otra tarea del
proyecto: cada día sin recolectar es un dato que no se recupera.

σ se estimará con datos reales; el cuadro se recalcula cuando existan 4 semanas.

## Reglas anti-autoengaño

1. **Pre-registro.** Hipótesis y regla de decisión escritas antes de mirar los
   datos. Una hipótesis nueva nacida de mirar el histórico es legítima, pero se
   registra como nueva y se valida con datos que aún no existen.
2. **Separación de muestra.** El último 30% del histórico se reserva y no se toca
   hasta validar. Se valida **una vez**.
3. **Presupuesto de pruebas.** Se declara cuántas variantes se van a probar. Probar
   50 reglas y quedarse con la mejor no descubre un patrón: descubre ruido.
4. **Validación hacia adelante** (*walk-forward*): ajustar en una ventana, evaluar
   en la siguiente, avanzar. Nunca ajustar y evaluar en el mismo tramo.
5. **Sin ejecución supuesta.** Publicar un anuncio a un precio no garantiza que
   alguien lo tome. Toda simulación aplica el modelo de llenado (`SPEC-009`); sin
   él, los resultados son ficción.
6. **Los huecos importan.** Un tramo con cobertura baja se excluye del análisis y se
   dice cuánto se excluyó (`RF-02`).
7. **Cambios de régimen.** Una medida cambiaria o un cambio en Binance parte la
   serie en dos. Un patrón estimado a través de un cambio de régimen no es
   confiable; hay que detectarlos y fecharlos.

## Métricas del negocio (no solo del modelo)

Un patrón estadísticamente significativo puede ser económicamente inútil. Se
reporta siempre en conjunto:

- Margen neto por ciclo (mediana, no solo media: las medias mienten con colas).
- Rotación: horas entre compra y venta.
- **Ganancia por hora de capital comprometido** — la métrica que realmente decide
  entre dos estrategias.
- Tasa de llenado observada por posición en el libro.
- Peor racha (caída máxima del capital en USDT).
- Fracción del tiempo con capital ocioso.
