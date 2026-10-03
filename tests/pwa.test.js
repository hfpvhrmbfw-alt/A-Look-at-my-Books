// Prüft, dass Service Worker, Manifest und index.html zusammenpassen (Offline-Start, relative Pfade).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sw = require('../sw.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

/** Lokale Pfade aus src="…" und href="…" (ohne http, data: und #). */
function localRefs(text) {
  return [...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((p) => !/^(https?:|data:|#|mailto:)/.test(p));
}

test('alle App-Dateien gibt es wirklich', () => {
  for (const f of Sw.APP_FILES.filter((f) => f !== './')) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} fehlt`);
  }
});

test('alles, was index.html und das Manifest laden, liegt im Offline-Cache', () => {
  const needed = [...localRefs(html), ...manifest.icons.map((i) => i.src)];
  for (const f of needed) assert.ok(Sw.APP_FILES.includes(f), `${f} fehlt in APP_FILES (sw.js)`);
  for (const f of fs.readdirSync(path.join(root, 'js'))) {
    assert.ok(Sw.APP_FILES.includes(`js/${f}`), `js/${f} fehlt in APP_FILES (sw.js)`);
  }
});

test('alle Pfade sind relativ (laufen unter /REPONAME/)', () => {
  for (const p of [...localRefs(html), ...Sw.APP_FILES, manifest.start_url, manifest.scope, manifest.id,
    ...manifest.icons.map((i) => i.src)]) {
    assert.ok(!p.startsWith('/'), `${p} ist absolut`);
  }
  assert.match(read('js/app.js'), /serviceWorker\.register\('sw\.js'\)/);
});

test('Manifest ist installierbar', () => {
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  const sizes = manifest.icons.map((i) => `${i.sizes}/${i.purpose}`);
  assert.ok(sizes.includes('192x192/any'));
  assert.ok(sizes.includes('512x512/any'));
  assert.ok(sizes.includes('512x512/maskable'));
});

test('Cache-Name trägt Version und Präfix; aufgeräumt werden nur eigene alte Caches', () => {
  assert.equal(Sw.APP_CACHE, `buecher-tracker-app-v${Sw.VERSION}`);
  assert.equal(Sw.isStaleCache('buecher-tracker-app-v0'), true);
  assert.equal(Sw.isStaleCache(Sw.APP_CACHE), false);
  assert.equal(Sw.isStaleCache(Sw.FONT_CACHE), false);
  assert.equal(Sw.isStaleCache('andere-app-v1'), false);
});
