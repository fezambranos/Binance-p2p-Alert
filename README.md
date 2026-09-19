# Alerta P2P Binance

App independiente (nada que ver con el CRM) que alerta con sonido, banner visual y
vibración cuando el precio P2P de Binance (por defecto USDT/VES) cruza el nivel
que definas. Diseñada para dejarla abierta en el navegador del teléfono.

## Diseño del sistema

El proyecto está evolucionando hacia un sistema de monitoreo, recomendación y
contabilidad para operar USDT/VES en el P2P de Binance. El diseño se lleva con
desarrollo dirigido por especificación: **[`docs/`](docs/) es la fuente de verdad**
(visión, glosario, requisitos, modelo de dominio, método analítico, riesgos,
fases y decisiones abiertas). Empieza por [`docs/README.md`](docs/README.md).

## Estructura

- `docs/` — marco SDD: especificaciones, ADR y método analítico.
- `web/` — página estática (HTML/CSS/JS sin dependencias, PWA instalable).
- `functions/` — Cloud Function que hace de proxy hacia la API de Binance P2P,
  porque Binance no permite llamarla directo desde el navegador (CORS).

## Desplegar

Requiere una cuenta de Firebase. **Ojo:** el plan gratuito Spark no permite
salida de red hacia servicios externos desde Cloud Functions, así que el proxy
necesita plan Blaze. Dónde alojar el recolector continuo sigue abierto: ver `D-03`
en [`docs/07-decisiones-abiertas.md`](docs/07-decisiones-abiertas.md).

```bash
npm install -g firebase-tools   # si no lo tienes
firebase login
firebase projects:create tu-proyecto-p2p-alert   # o usa uno existente
firebase use tu-proyecto-p2p-alert

cd functions && npm install && cd ..
firebase deploy --only functions,hosting
```

Al terminar, Firebase imprime dos URLs:

- Hosting: `https://tu-proyecto-p2p-alert.web.app` → esa es la app.
- La Function queda en `https://us-central1-tu-proyecto-p2p-alert.cloudfunctions.net/binanceP2PProxy`.

Abre la URL de Hosting en tu teléfono, entra a **Opciones avanzadas** y pega ahí
la URL de la Function como "Endpoint del proxy" (queda guardada en el teléfono,
solo se hace una vez). Luego fija tu nivel de precio y pulsa **Iniciar monitoreo**.

## Desarrollo local

```bash
cd functions
npm install
npm test              # tests unitarios del proxy
```

Para probar `web/index.html` en local, ábrelo directo en el navegador y en
"Opciones avanzadas" apunta el endpoint a `firebase emulators:start --only functions`
(usa la URL que imprime el emulador).

## Notas

- La app funciona mientras la pestaña siga abierta y la pantalla encendida.
  Los navegadores móviles pausan JS en segundo plano, así que no hay garantía
  de alerta si bloqueas el teléfono o cambias de app por mucho tiempo.
- Se puede "agregar a inicio" desde el navegador para que se comporte como
  una app instalada (PWA).
