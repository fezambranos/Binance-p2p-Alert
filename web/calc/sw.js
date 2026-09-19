/**
 * Service worker de la calculadora de arbitraje.
 *
 * Su alcance es /calc/ (vive en esa carpeta), así que no intercepta ni afecta
 * a la app de alertas que se sirve en la raíz del hosting.
 *
 * Estrategia: red primero, caché como respaldo. Estando en línea siempre se ve
 * la versión más reciente; sin conexión, la última que se haya cargado. Es una
 * calculadora sin datos remotos, así que una caché vieja nunca muestra cifras
 * equivocadas, solo una versión anterior de la interfaz.
 */

const CACHE = "arbitraje-usdt-v1";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo navegación y recursos propios; nada de POST ni de otros orígenes.
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Guardamos una copia solo si la respuesta sirve.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
