/*
  Service Worker: macht die App offline startfähig.
  - Beim Installieren werden alle App-Dateien (APP_FILES) in einen Cache gelegt,
    dessen Name die Versionsnummer enthält (z. B. "buecher-tracker-app-v1").
  - Die App wird danach immer aus diesem Cache geladen, auch ohne Internet.
  - Schriften von Google Fonts werden beim ersten Laden mitgespeichert (eigener Cache).
  - Abfragen an die Buchquellen (DNB, Open Library, Google Books) gehen am Cache vorbei.

  Update ausrollen: Dateien ändern, VERSION um eins erhöhen, hochladen.
  Der Browser erkennt den geänderten sw.js, lädt alle Dateien neu in den Cache der neuen
  Version und die App zeigt "Neue Version verfügbar". Nach "Neu laden" läuft die neue
  Version, und die Caches älterer Versionen werden gelöscht.
  Neue Dateien in js/ oder icons/ müssen in APP_FILES eingetragen werden (ein Test prüft das).

  Alle Cache-Namen beginnen mit "buecher-tracker-", weil sich alle GitHub-Pages-Seiten
  eines Kontos (NAME.github.io) denselben Speicher teilen. Aufgeräumt werden nur eigene Caches.
*/
const VERSION = 4;
const PREFIX = 'buecher-tracker-';
const APP_CACHE = `${PREFIX}app-v${VERSION}`;
const FONT_CACHE = `${PREFIX}fonts`;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Pfade relativ zum Ordner von sw.js, damit es auch unter /REPONAME/ funktioniert
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'js/theme.js',
  'js/isbn.js',
  'js/model.js',
  'js/list.js',
  'js/score.js',
  'js/progress.js',
  'js/sources.js',
  'js/enrich.js',
  'js/covers.js',
  'js/transfer.js',
  'js/app.js',
  'js/mobile.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
];

/** Gehört der Cache-Name zur App, ist aber nicht mehr aktuell? */
function isStaleCache(name) {
  return name.startsWith(PREFIX) && name !== APP_CACHE && name !== FONT_CACHE;
}

if (typeof module === 'object' && module.exports) {
  // Für die Tests (Node): nur die Angaben, keine Ereignisse
  module.exports = { VERSION, PREFIX, APP_CACHE, FONT_CACHE, APP_FILES, isStaleCache };
} else {
  self.addEventListener('install', (event) => {
    // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neuen Dateien geladen werden
    event.waitUntil(caches.open(APP_CACHE).then((cache) =>
      cache.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' })))));
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
      .then((names) => Promise.all(names.filter(isStaleCache).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()));
  });

  self.addEventListener('message', (event) => {
    const data = event.data || {};
    // Die App bittet nach Klick auf "Neu laden" darum, die neue Version sofort zu aktivieren
    if (data.type === 'SKIP_WAITING') self.skipWaiting();
    if (data.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (FONT_HOSTS.includes(url.hostname)) {
      // Schriften: aus dem Cache, sonst laden und merken
      event.respondWith(caches.open(FONT_CACHE).then((cache) => cache.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
          return res;
        }))));
      return;
    }

    // Nur eigene Dateien innerhalb des App-Ordners; alles andere (Buchquellen, Cover) normal laden
    if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

    const appPage = url.pathname === new URL(self.registration.scope).pathname ||
      url.pathname.endsWith('/index.html');
    if (req.mode === 'navigate' && appPage) {
      // Aufruf der App (auch mit ?… oder #…): immer die gespeicherte index.html
      event.respondWith(caches.open(APP_CACHE)
        .then((cache) => cache.match('index.html'))
        .then((hit) => hit || fetch(req)));
      return;
    }

    event.respondWith(caches.open(APP_CACHE)
      .then((cache) => cache.match(req, { ignoreSearch: true }))
      .then((hit) => hit || fetch(req)));
  });
}
