/*
  Cover-Bilder lokal speichern (IndexedDB), damit kein Bild von fremden Servern
  nachgeladen werden muss (kein Hotlinking) und localStorage nicht vollläuft.
  Bilder werden beim Speichern auf höchstens 400 px Breite verkleinert.
  Nur im Browser (window.Covers).
*/
(function (root) {
  'use strict';

  const DB_NAME = 'buecher-tracker';
  const STORE = 'covers';
  const MAX_WIDTH = 400;
  const urlCache = new Map(); // id -> Object-URL für die Anzeige

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error('IndexedDB nicht verfügbar'));
        const req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    }));
  }

  const put = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const all = () => db().then((d) => new Promise((resolve, reject) => {
    const out = {};
    const t = d.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { out[cur.key] = cur.value; cur.continue(); }
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  }));
  function remove(id) {
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    return tx('readwrite', (s) => s.delete(id));
  }

  /** Object-URL eines gespeicherten Covers (oder null). */
  async function url(id) {
    if (!id) return null;
    if (urlCache.has(id)) return urlCache.get(id);
    try {
      const blob = await get(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urlCache.set(id, u);
      return u;
    } catch (err) {
      console.error('Cover konnte nicht gelesen werden:', err);
      return null;
    }
  }

  /** Verkleinert ein Bild (Blob) auf MAX_WIDTH und gibt ein JPEG zurück. */
  async function shrink(blob) {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width < 20 || bitmap.height < 20) throw new Error('kein brauchbares Bild');
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))), 'image/jpeg', 0.85);
    });
  }

  /**
   * Lädt ein Cover einmalig von einer Quelle herunter und verkleinert es.
   * Die Quelle muss das Herunterladen erlauben (CORS); sonst Fehler mit verständlicher Meldung.
   */
  async function download(src, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(src, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type) || blob.size < 200) throw new Error('kein Cover vorhanden');
      return await shrink(blob);
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Zeitüberschreitung' :
        err.message === 'Failed to fetch' ? 'Quelle erlaubt kein Herunterladen' : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  root.Covers = { put, get, all, remove, url, shrink, download };
})(typeof self !== 'undefined' ? self : this);
