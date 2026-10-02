/*
  Filtern (und später Sortieren) der Leseliste.
  Arbeitet auf "Buch-Ansichten": { entry, work, editions, … }, siehe bookView() in app.js.
  Reine Logik ohne DOM (Browser: window.List, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.List = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Ansichten: welche Status jeweils gezeigt werden
  const VIEWS = {
    open: { label: 'Leseliste', statuses: ['reading', 'next', 'backlog'] },
    archive: { label: 'Archiv', statuses: ['read', 'dropped'] },
    all: { label: 'Alle', statuses: ['reading', 'next', 'backlog', 'read', 'dropped'] },
  };

  // Formatfilter: welche Besitzformate passen
  const FORMAT_FILTERS = {
    all: { label: 'Alle Formate', match: () => true },
    ebook: { label: 'E-Book', match: (o) => o === 'ebook' || o === 'both' },
    print: { label: 'Print', match: (o) => o === 'print' || o === 'both' },
    none: { label: 'Nicht im Besitz', match: (o) => o === 'none' },
  };

  /** Text für Vergleiche vereinfachen: Kleinbuchstaben, Akzente entfernen. */
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, ''); // "é" -> "e", "ü" -> "u"
  }

  /** Durchsuchbarer Text eines Buchs: Titel, Untertitel, Autor:innen, Reihe, ISBNs. */
  function searchText(book) {
    const w = book.work;
    return normalize([
      w.title, w.subtitle, w.originalTitle, w.series, (w.authors || []).join(' '),
      ...book.editions.flatMap((e) => [e.isbn10, e.isbn13, e.publisher]),
    ].join(' '));
  }

  /** Alle Genres und Tags eines Buchs (für den Genre-Filter). */
  function genresOf(book) {
    return [...(book.work.genres || []), ...(book.entry.tags || [])];
  }

  /**
   * Filtert Bücher. Alle Kriterien sind kombinierbar:
   *   view     – 'open' | 'archive' | 'all'
   *   status   – 'all' oder ein Status-Schlüssel
   *   format   – Schlüssel aus FORMAT_FILTERS
   *   genre    – '' oder ein Genre/Tag (ohne Groß-/Kleinschreibung)
   *   minScore – null oder Mindestscore (Bücher ohne Score fallen dann heraus)
   *   search   – Suchtext
   *   scoreOf  – Funktion book -> Score|null (nur nötig, wenn minScore gesetzt ist)
   */
  function filterBooks(books, opts = {}) {
    const view = VIEWS[opts.view] || VIEWS.open;
    const format = FORMAT_FILTERS[opts.format] || FORMAT_FILTERS.all;
    const term = normalize((opts.search || '').trim());
    const genre = normalize(opts.genre || '');
    return books.filter((b) => {
      const status = b.entry.status;
      if (!view.statuses.includes(status)) return false;
      if (opts.status && opts.status !== 'all' && status !== opts.status) return false;
      if (!format.match(b.entry.ownership)) return false;
      if (genre && !genresOf(b).some((g) => normalize(g) === genre)) return false;
      if (opts.minScore != null && opts.scoreOf) {
        const score = opts.scoreOf(b);
        if (score == null || score < opts.minScore) return false;
      }
      if (term && !searchText(b).includes(term)) return false;
      return true;
    });
  }

  return { VIEWS, FORMAT_FILTERS, normalize, filterBooks, genresOf };
});
