/*
  Filtern, Sortieren und die manuelle "Als Nächstes"-Warteschlange der Leseliste.
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

  /* ---------- Sortieren ---------- */

  /** Seitenzahl eines Buchs: aus der ersten Ausgabe mit Seitenangabe. */
  function pagesOf(book) {
    const ed = book.editions.find((e) => e.pages > 0);
    return ed ? ed.pages : null;
  }

  const FORMAT_ORDER = { print: 0, both: 1, ebook: 2, none: 3 };
  const collator = typeof Intl !== 'undefined' ? new Intl.Collator('de', { sensitivity: 'base', numeric: true }) : null;
  const compareText = (a, b) => (collator ? collator.compare(a || '', b || '') : String(a || '').localeCompare(String(b || '')));

  // Sortierungen: Wert je Buch + Standardrichtung (1 = aufsteigend, -1 = absteigend)
  const SORTS = {
    score: { label: 'Score', value: (b, ctx) => ctx.scoreOf(b), dir: -1, numeric: true },
    title: { label: 'Titel', value: (b) => b.work.title, dir: 1 },
    author: { label: 'Autor:in', value: (b) => lastNameKey((b.work.authors || [])[0]), dir: 1 },
    pages: { label: 'Seitenzahl', value: pagesOf, dir: 1, numeric: true },
    added: { label: 'Hinzugefügt', value: (b) => b.entry.addedAt, dir: -1 },
    format: { label: 'Format', value: (b) => FORMAT_ORDER[b.entry.ownership] ?? 4, dir: 1, numeric: true },
  };

  /** "Thomas Mann" -> "Mann Thomas"; "Mann, Thomas" bleibt. */
  function lastNameKey(name) {
    const n = String(name || '').trim();
    if (!n || n.includes(',')) return n;
    const parts = n.split(/\s+/);
    return parts.length > 1 ? `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}` : n;
  }

  /**
   * Sortiert eine Kopie der Liste. Leere Werte (z. B. kein Score) stehen immer am Ende.
   * Bei Gleichstand entscheidet der Titel.
   */
  function sortBooks(books, key, opts = {}) {
    const sort = SORTS[key] || SORTS.score;
    const dir = opts.reverse ? -sort.dir : sort.dir;
    const ctx = { scoreOf: opts.scoreOf || (() => null) };
    const withValues = books.map((b) => ({ b, v: sort.value(b, ctx) }));
    withValues.sort((x, y) => {
      const xe = x.v == null || x.v === '';
      const ye = y.v == null || y.v === '';
      if (xe !== ye) return xe ? 1 : -1;
      let c = 0;
      if (!xe) c = sort.numeric ? (x.v - y.v) * dir : compareText(x.v, y.v) * dir;
      return c || compareText(x.b.work.title, y.b.work.title);
    });
    return withValues.map((x) => x.b);
  }

  /* ---------- Manuelle Reihenfolge "Als Nächstes" ---------- */

  /**
   * Nummeriert die Warteschlange (alle Einträge mit Status "next") lückenlos durch.
   * Einträge ohne Position kommen ans Ende (älteste zuerst). Andere Status verlieren
   * ihre Position. Ändert die Einträge direkt.
   */
  function normalizeQueue(entries) {
    const queue = entries
      .filter((e) => e.status === 'next')
      .sort((a, b) => {
        const pa = a.queuePos == null ? Infinity : a.queuePos;
        const pb = b.queuePos == null ? Infinity : b.queuePos;
        return pa - pb || String(a.addedAt).localeCompare(String(b.addedAt));
      });
    queue.forEach((e, i) => { e.queuePos = i + 1; });
    for (const e of entries) if (e.status !== 'next') e.queuePos = null;
    return queue;
  }

  /** Verschiebt einen Eintrag in der Warteschlange um `delta` Plätze (-1 = hoch, +1 = runter). */
  function moveInQueue(entries, id, delta) {
    const queue = normalizeQueue(entries);
    const i = queue.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= queue.length) return false;
    [queue[i].queuePos, queue[j].queuePos] = [queue[j].queuePos, queue[i].queuePos];
    return true;
  }

  return {
    VIEWS, FORMAT_FILTERS, SORTS, normalize, filterBooks, genresOf, pagesOf,
    sortBooks, normalizeQueue, moveInQueue,
  };
});
