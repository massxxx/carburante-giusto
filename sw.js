// Carburante Giusto: l'app si apre anche senza rete (con gli ultimi prezzi scaricati).
const VERSIONE = "cg-2";
const GUSCIO = ["./", "index.html", "leaflet.js", "manifest.webmanifest", "base/comuni.json", "dati/indice.json", "dati/storico.json",
  "icone/icona-192.png", "icone/icona-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(GUSCIO)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // mappa OSM e font: direttamente dalla rete
  // prima la rete (prezzi freschi), poi la copia salvata
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VERSIONE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});
