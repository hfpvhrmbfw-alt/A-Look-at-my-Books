/*
  Datenmodell der Leseliste (Version 2) und Migration aus Version 1.

  Aufbau des gespeicherten Zustands:
    works[]    – das Werk (Titel, Autor:innen, Originalsprache, Werkjahr, Beschreibung …)
    editions[] – konkrete Ausgaben eines Werks (ISBN, Verlag, Seiten, Einband …), Werk 1:n Ausgabe
    entries[]  – meine Leseliste: ein Eintrag je Werk mit Status, Besitzformat, Bewertung,
                 Fortschritt, Notizen; verweist auf das Werk und die Ausgaben, die ich besitze
    settings   – Score-Gewichte, Quellen, optionaler API-Key (nur lokal im Browser)

  Jede Entität hat ein Objekt `sources`, das pro Feld die Herkunft festhält:
    { title: { source: 'manual', at: '2026-10-02T…' }, pages: { source: 'openlibrary', at: … } }

  Reine Logik ohne DOM (Browser: window.Model, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 2;

  // Status: interner Schlüssel -> angezeigter Text (Reihenfolge = Reihenfolge der Filter)
  const STATUSES = {
    reading: 'Lese gerade',
    next: 'Als Nächstes',
    backlog: 'Wunschliste/Backlog',
    read: 'Gelesen',
    dropped: 'Abgebrochen',
  };
  // Diese Status gelten als "offen" und erscheinen standardmäßig in der Leseliste
  const OPEN_STATUSES = ['reading', 'next', 'backlog'];

  // Besitzformat; null = noch nicht angegeben (z. B. aus Version 1 übernommen)
  const OWNERSHIP = {
    ebook: 'E-Book',
    print: 'Print',
    both: 'beides',
    none: 'noch nicht',
  };

  const DEFAULT_SETTINGS = {
    // Gewichte für den Score (siehe score.js); Summe muss nicht 1 sein
    weights: { priority: 50, anticipation: 20, urgency: 15, mood: 10, effort: 5 },
    sources: { openlibrary: true, googlebooks: true, dnb: true },
    googleApiKey: '',
    autoEnrichOnIsbn: false,
  };

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function emptyState() {
    return { version: VERSION, works: [], editions: [], entries: [], settings: clone(DEFAULT_SETTINGS) };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ---------- Fabriken mit allen Feldern und Standardwerten ---------- */

  function createWork(fields = {}) {
    return Object.assign({
      id: newId(),
      title: '',
      subtitle: '',
      authors: [],
      originalTitle: '',
      originalLanguage: '',
      year: null,              // Erscheinungsjahr des Werks
      description: '',
      genres: [],
      series: '',
      seriesNumber: '',
      coverId: null,           // Verweis auf ein Cover in IndexedDB
      sources: {},
    }, fields);
  }

  function createEdition(fields = {}) {
    return Object.assign({
      id: newId(),
      workId: null,
      format: 'print',         // 'print' oder 'ebook'
      isbn10: '',
      isbn13: '',
      publisher: '',
      year: null,              // Erscheinungsjahr der Ausgabe
      printing: '',            // Auflage
      binding: '',             // Hardcover, Taschenbuch, Klappenbroschur …
      ebookFormat: '',         // EPUB, PDF, Kindle …
      ebookPlatform: '',       // Speicherort/Plattform
      pages: null,
      language: '',
      translators: [],
      editors: [],
      illustrators: [],
      forewordBy: '',
      coverId: null,
      special: {
        kinds: [],             // erstausgabe, sonderausgabe, limitiert, nummeriert, signiert, reprint, antiquariat
        number: '',            // Auflagen-/Exemplarnummer
        publisherSeries: '',   // Edition/Reihe des Verlags
        condition: '',
        acquiredFrom: '',
        acquiredAt: null,
        notes: '',
      },
      sources: {},
    }, fields);
  }

  function createEntry(fields = {}) {
    return Object.assign({
      id: newId(),
      workId: null,
      editionIds: [],          // Ausgaben, die ich besitze (bei "beides" typischerweise zwei)
      ownership: 'none',
      currentFormat: null,     // bei "beides": in welchem Format ich gerade lese
      status: 'backlog',
      priority: null,          // 1–5, Gesamtpriorität
      criteria: { anticipation: null, urgency: null, effort: null, mood: null },
      queuePos: null,          // Position in der "Als Nächstes"-Warteschlange
      progress: {
        unit: 'page',          // führende Eingabeart: 'page', 'percent' oder 'chapter'
        page: null,
        percent: null,
        chapter: null,
        chapterCount: null,
        startDate: null,
        endDate: null,
        log: [],               // [{ date, page, percent, chapter }]
      },
      notes: '',
      tags: [],
      addedAt: new Date().toISOString(),
      finalRating: null,       // Bewertung nach dem Lesen (1–5), fließt nicht in den Score ein
      sources: {},
    }, fields);
  }

  /* ---------- Migration Version 1 -> Version 2 ---------- */

  const V1_STATUS = { want: 'backlog', reading: 'reading', read: 'read', dropped: 'dropped' };

  function splitList(text) {
    return String(text || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  }

  /**
   * Wandelt das Array aus Version 1 (buecher-tracker.v1) in den Zustand von Version 2 um.
   * Es geht nichts verloren: Felder ohne Platz im neuen Modell landen in den Notizen.
   * `isbnParse` ist optional (Isbn.parse), damit eine vorhandene ISBN gleich geprüft wird.
   */
  function migrateV1(books, isbnParse) {
    const state = emptyState();
    if (!Array.isArray(books)) return state;

    for (const b of books) {
      if (!b || typeof b !== 'object') continue;
      const at = b.addedAt || new Date().toISOString();
      const manual = (fields) => Object.fromEntries(fields.map((f) => [f, { source: 'manual', at }]));

      const work = createWork({
        title: String(b.title || '').trim() || 'Ohne Titel',
        authors: b.author ? [String(b.author).trim()] : [],
        genres: splitList(b.genre),
      });
      work.sources = manual(['title', 'authors'].concat(work.genres.length ? ['genres'] : []));
      state.works.push(work);

      const status = V1_STATUS[b.status] || 'backlog';
      const rating = Number(b.rating) >= 1 && Number(b.rating) <= 5 ? Number(b.rating) : null;
      const isClosed = status === 'read' || status === 'dropped';
      const entry = createEntry({
        id: b.id || newId(),
        workId: work.id,
        ownership: null,       // in Version 1 nicht erfasst
        status,
        // Bisherige Sterne: bei Gelesen/Abgebrochen Bewertung, bei offenen Büchern Priorität
        priority: isClosed ? null : rating,
        finalRating: isClosed ? rating : null,
        notes: String(b.notes || ''),
        addedAt: at,
      });
      entry.progress.startDate = b.startDate || null;
      entry.progress.endDate = b.endDate || null;
      if (status === 'read') entry.progress.percent = 100;

      // ISBN oder Seitenzahl gehören zur Ausgabe
      const hasIsbn = b.isbn && String(b.isbn).trim();
      const pages = Number(b.pages) > 0 ? Math.round(Number(b.pages)) : null;
      if (hasIsbn || pages) {
        const edition = createEdition({ workId: work.id, pages });
        const editionSources = pages ? ['pages'] : [];
        if (hasIsbn) {
          const parsed = isbnParse ? isbnParse(b.isbn) : null;
          if (parsed && parsed.valid) {
            edition.isbn10 = parsed.isbn10;
            edition.isbn13 = parsed.isbn13;
            editionSources.push('isbn10', 'isbn13');
          } else {
            // Ungültige ISBN nicht wegwerfen, sondern sichtbar in den Notizen aufheben
            entry.notes = appendNote(entry.notes, `ISBN (aus alter Version, ungültig): ${b.isbn}`);
          }
        }
        edition.sources = manual(editionSources);
        state.editions.push(edition);
        entry.editionIds.push(edition.id);
      }
      if (b.coverUrl) entry.notes = appendNote(entry.notes, `Cover-Link (aus alter Version): ${b.coverUrl}`);

      entry.sources = manual(['status', 'notes']);
      state.entries.push(entry);
    }
    return state;
  }

  function appendNote(notes, line) {
    return notes ? `${notes}\n${line}` : line;
  }

  /**
   * Ergänzt fehlende Felder eines geladenen Zustands (z. B. nach einem Update mit neuen
   * Feldern) und verwirft kaputte Einträge, ohne gültige Daten zu verändern.
   */
  function normalizeState(raw) {
    const state = emptyState();
    if (!raw || typeof raw !== 'object') return state;
    const list = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object' && i.id) : []);

    state.works = list(raw.works).map((w) => mergeDefaults(createWork({ id: w.id }), w));
    const workIds = new Set(state.works.map((w) => w.id));
    state.editions = list(raw.editions).map((e) => mergeDefaults(createEdition({ id: e.id }), e));
    const editionIds = new Set(state.editions.map((e) => e.id));
    state.entries = list(raw.entries)
      .filter((e) => workIds.has(e.workId))
      .map((e) => {
        const entry = mergeDefaults(createEntry({ id: e.id, addedAt: e.addedAt }), e);
        if (!STATUSES[entry.status]) entry.status = 'backlog';
        entry.editionIds = entry.editionIds.filter((id) => editionIds.has(id));
        return entry;
      });
    state.settings = mergeDefaults(clone(DEFAULT_SETTINGS), raw.settings || {});
    return state;
  }

  /** Füllt in `value` fehlende Schlüssel aus `defaults` auf (rekursiv für einfache Objekte). */
  function mergeDefaults(defaults, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const out = Object.assign({}, defaults);
    for (const [key, v] of Object.entries(value)) {
      const d = defaults[key];
      if (d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)) {
        out[key] = mergeDefaults(d, v);
      } else if (v !== undefined) {
        out[key] = v;
      }
    }
    return out;
  }

  /**
   * Lädt den Zustand aus einem Speicher mit getItem/setItem (localStorage oder Test-Attrappe).
   * Gibt es nur Daten aus Version 1, werden sie migriert und als Version 2 gespeichert;
   * die Daten von Version 1 bleiben unverändert als Sicherung liegen.
   */
  function loadFromStorage(storage, isbnParse) {
    const rawV2 = storage.getItem(KEYS.v2);
    if (rawV2) return { state: normalizeState(JSON.parse(rawV2)), migrated: false };
    const rawV1 = storage.getItem(KEYS.v1);
    if (rawV1) {
      const state = migrateV1(JSON.parse(rawV1), isbnParse);
      storage.setItem(KEYS.v2, JSON.stringify(state));
      return { state, migrated: true };
    }
    return { state: emptyState(), migrated: false };
  }

  const KEYS = { v1: 'buecher-tracker.v1', v2: 'buecher-tracker.v2' };

  /* ---------- Hilfen für die Anzeige ---------- */

  /** Werk und Ausgaben zu einem Eintrag nachschlagen. */
  function resolve(state, entry) {
    const work = state.works.find((w) => w.id === entry.workId) || createWork();
    const editions = entry.editionIds
      .map((id) => state.editions.find((e) => e.id === id))
      .filter(Boolean);
    return { entry, work, editions };
  }

  /** Herkunft eines Feldes setzen (z. B. nach manueller Eingabe). */
  function setSource(entity, field, source, at = new Date().toISOString()) {
    entity.sources = entity.sources || {};
    entity.sources[field] = { source, at };
  }

  return {
    VERSION, KEYS, STATUSES, OPEN_STATUSES, OWNERSHIP, DEFAULT_SETTINGS,
    newId, emptyState, createWork, createEdition, createEntry,
    migrateV1, normalizeState, loadFromStorage, resolve, setSource, splitList,
  };
});
