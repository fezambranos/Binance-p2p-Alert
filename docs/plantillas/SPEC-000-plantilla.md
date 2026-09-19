# SPEC-nnn · <Nombre de la capacidad>

- **Estado:** Borrador | En revisión | Aprobada | Implementada | Obsoleta
- **Requisitos que cubre:** RF-xx, RNF-xx
- **Depende de:** SPEC-xxx, ADR-xxxx
- **Fase:** n

## 1. Problema

Qué no se puede hacer hoy y por qué importa. Sin solución todavía.

## 2. Alcance

**Hace:** …

**No hace:** … *(obligatorio: lo que no se declara fuera, alguien lo implementa)*

## 3. Contrato

Entradas, salidas, tipos, unidades, precisión y redondeo.

```
// firmas o esquema
```

## 4. Reglas y casos límite

Qué ocurre ante: dato faltante, dato atípico, fuente caída, valor cero, valor
negativo, empate, colisión de identificador, dato más viejo que el límite de
frescura.

## 5. Criterios de aceptación

Cada uno debe tener una prueba automatizada que lo nombre.

- **CA-1** — Dado … cuando … entonces …
- **CA-2** — Dado … cuando … entonces …

## 6. Plan de pruebas

- Unitarias: …
- De contrato (fixtures reales grabados): …
- Golden file (si hay dinero de por medio): …

## 7. Telemetría

Qué se registra para saber después si esto funcionó en producción.

## 8. Riesgos

Referencias a `05-riesgos.md` y mitigaciones específicas de esta capacidad.

## 9. Preguntas abiertas

Si alguna bloquea la implementación, la spec **no** puede pasar a Aprobada.
