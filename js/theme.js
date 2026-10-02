/*
  Design-Wahl: System, Hell oder Dunkel.

  Die Wahl liegt im localStorage unter "buecher-tracker.theme" (getrennt von den Buchdaten,
  wird also nicht exportiert). "system" folgt der Einstellung des Geräts; "light"/"dark"
  setzen data-theme auf <html>, das CSS in index.html erzwingt dann den Modus.
  Die Datei wird im <head> geladen und sofort angewendet, damit beim Laden nichts aufblitzt.

  Reine Logik plus apply() für den Browser (Browser: window.Theme, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Theme = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'buecher-tracker.theme';
  const MODES = ['system', 'light', 'dark'];
  const LABELS = { system: 'System', light: 'Hell', dark: 'Dunkel' };
  /* Farbe der Browserleiste (theme-color), passend zu --bg */
  const BAR_COLORS = { light: '#E3DAD3', dark: '#1D1916' };

  /** Unbekannte oder fehlende Werte gelten als "system". */
  function normalize(mode) {
    return MODES.includes(mode) ? mode : 'system';
  }

  /** Nächster Zustand beim Tippen auf den Schalter: System → Hell → Dunkel → System. */
  function next(mode) {
    return MODES[(MODES.indexOf(normalize(mode)) + 1) % MODES.length];
  }

  /** Tatsächlich sichtbarer Modus ('light' | 'dark'). */
  function resolve(mode, systemDark) {
    const m = normalize(mode);
    if (m === 'system') return systemDark ? 'dark' : 'light';
    return m;
  }

  function load(storage) {
    try { return normalize(storage && storage.getItem(STORAGE_KEY)); } catch (err) { return 'system'; }
  }

  function save(storage, mode) {
    const m = normalize(mode);
    try {
      if (m === 'system') storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, m);
    } catch (err) { /* privates Fenster o. Ä.: gilt dann nur bis zum Neuladen */ }
    return m;
  }

  /** Setzt data-theme auf <html> und passt die Farbe der Browserleiste an. */
  function apply(doc, mode) {
    const m = normalize(mode);
    const html = doc.documentElement;
    if (m === 'system') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', m);
    doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const own = /dark/.test(meta.getAttribute('media') || '') ? 'dark' : 'light';
      meta.setAttribute('content', BAR_COLORS[m === 'system' ? own : m]);
    });
    return m;
  }

  return { STORAGE_KEY, MODES, LABELS, normalize, next, resolve, load, save, apply };
});
