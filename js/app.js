/* ====================================================================
   3. LOGIK (Oberfläche)
   Reine Logik ohne DOM liegt in eigenen Dateien und ist getestet:
     js/isbn.js  – ISBN prüfen und umrechnen
     js/model.js – Datenmodell (Werk, Ausgabe, Eintrag), Migration, Laden
     js/list.js  – Filtern, Sortieren, Warteschlange "Als Nächstes"
     js/score.js – Score aus Priorität und Teilkriterien
   ==================================================================== */
'use strict';

const STORAGE_KEY = Model.KEYS.v2;
const STATUSES = Model.STATUSES;

/* ---------- Zustand der App ---------- */
let loadFailed = false;      // true, wenn gespeicherte Daten unlesbar waren
let state = loadState();     // { works, editions, entries, settings }, siehe model.js
let activeView = 'open';     // 'open' (Leseliste), 'archive' oder 'all', siehe List.VIEWS
let activeFilter = 'all';    // 'all' oder ein Status-Schlüssel
let activeFormat = 'all';    // Schlüssel aus List.FORMAT_FILTERS
let searchTerm = '';
let activeGenre = '';        // '' oder ein Genre/Tag
let minScore = null;         // null oder Mindestscore
let editingId = null;        // ID des Eintrags im Bearbeiten-Dialog (null = neues Buch)
let formRating = 0;          // Sterne im Formular (0 = keine): Priorität bzw. Bewertung nach dem Lesen
let lastDeleted = null;      // für "Rückgängig" nach dem Löschen
let toastTimer = null;

/* ---------- Elemente aus dem HTML ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  list: $('bookList'),
  empty: $('emptyState'),
  search: $('search'),
  views: $('views'),
  filters: $('filters'),
  formatFilters: $('formatFilters'),
  sort: $('sortSelect'),
  genre: $('genreSelect'),
  minScore: $('minScoreSelect'),
  criteria: $('criteriaFields'),
  scorePreview: $('scorePreview'),
  settingsDialog: $('settingsDialog'),
  settingsForm: $('settingsForm'),
  weightFields: $('weightFields'),
  total: $('totalCount'),
  dialog: $('bookDialog'),
  form: $('bookForm'),
  dialogTitle: $('dialogTitle'),
  isbn: $('fIsbn'),
  isbnHint: $('fIsbnHint'),
  title: $('fTitle'),
  author: $('fAuthor'),
  status: $('fStatus'),
  ownership: $('fOwnership'),
  currentFormatField: $('currentFormatField'),
  currentFormat: $('fCurrentFormat'),
  notes: $('fNotes'),
  tags: $('fTags'),
  stars: $('starInput'),
  ratingLabel: $('ratingLabel'),
  secPrint: $('secPrint'),
  secPrintTitle: $('secPrintTitle'),
  secEbook: $('secEbook'),
  secSpecial: $('secSpecial'),
  error: $('formError'),
  toast: $('toast'),
  toastText: $('toastText'),
  toastUndo: $('toastUndo'),
};

/* ====================================================================
   Speichern & Laden (localStorage)
   ==================================================================== */

/**
 * Liest den Zustand aus dem localStorage. Gibt es nur Daten der alten Version (v1),
 * werden sie einmalig umgewandelt; die alten Daten bleiben als Sicherung liegen.
 * Bei Fehlern: leerer Zustand (die gespeicherten Daten werden dabei nicht überschrieben).
 */
function loadState() {
  try {
    return Model.loadFromStorage(localStorage, Isbn.parse).state;
  } catch (err) {
    console.error('Konnte Bücher nicht laden:', err);
    loadFailed = true;
    return Model.emptyState();
  }
}

/** Schreibt den Zustand in den localStorage. */
function saveState() {
  if (loadFailed) {
    // Nicht über unlesbare, aber evtl. rettbare Daten schreiben
    alert('Die gespeicherten Daten konnten nicht gelesen werden. ' +
          'Änderungen werden deshalb nicht gespeichert, um nichts zu überschreiben.');
    return;
  }
  List.normalizeQueue(state.entries); // Warteschlange "Als Nächstes" lückenlos halten
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // z. B. privater Modus in manchen Browsern oder Speicher voll
    console.error('Konnte Bücher nicht speichern:', err);
    alert('Achtung: Die Daten konnten nicht gespeichert werden. ' +
          'Ist der Browser im privaten Modus?');
  }
}

/* ====================================================================
   Formularfelder für Werk, Ausgaben und Besonderheiten
   Jede Zeile: [Feldname, Beschriftung, Typ, Zusatz]. Typen:
     text, number, textarea, date, list (Liste mit Trennzeichen), suggest (Text mit Vorschlägen)
   ==================================================================== */

const WORK_FIELDS = [
  ['subtitle', 'Untertitel', 'text'],
  ['originalTitle', 'Originaltitel', 'text'],
  ['originalLanguage', 'Originalsprache', 'text'],
  ['year', 'Erscheinungsjahr des Werks', 'number'],
  ['series', 'Reihe', 'text'],
  ['seriesNumber', 'Band', 'text'],
  ['genres', 'Genres/Themen (mit Komma trennen)', 'list', ','],
  ['description', 'Beschreibung/Klappentext', 'textarea'],
];

const EDITION_COMMON = [
  ['publisher', 'Verlag', 'text'],
  ['year', 'Erscheinungsjahr der Ausgabe', 'number'],
  ['printing', 'Auflage', 'text'],
  ['pages', 'Seitenzahl', 'number'],
  ['language', 'Sprache der Ausgabe', 'text'],
  ['translators', 'Übersetzer:in (mehrere mit ; trennen)', 'list', ';'],
  ['editors', 'Herausgeber:in', 'list', ';'],
  ['illustrators', 'Illustrator:in', 'list', ';'],
  ['forewordBy', 'Vor-/Nachwort von', 'text'],
];

const PRINT_FIELDS = [
  ['binding', 'Einband', 'suggest', ['Hardcover', 'Taschenbuch', 'Klappenbroschur', 'Paperback', 'Leinen', 'Broschur']],
  ...EDITION_COMMON,
];

const EBOOK_FIELDS = [
  ['isbn', 'ISBN des E-Books', 'isbn'],
  ['ebookFormat', 'Dateiformat', 'suggest', ['EPUB', 'PDF', 'Kindle (AZW/KFX)', 'MOBI']],
  ['ebookPlatform', 'Speicherort/Plattform', 'suggest', ['Kindle', 'Tolino', 'Kobo', 'Apple Books', 'Google Play Books', 'Onleihe', 'Calibre']],
  ...EDITION_COMMON,
];

const SPECIAL_KINDS = {
  erstausgabe: 'Erstausgabe',
  sonderausgabe: 'Sonderausgabe',
  limitiert: 'limitiert',
  nummeriert: 'nummeriert',
  signiert: 'signiert',
  reprint: 'Reprint',
  antiquariat: 'Antiquariat',
};

const SPECIAL_FIELDS = [
  ['kinds', 'Art der Besonderheit', 'checks', SPECIAL_KINDS],
  ['number', 'Auflagen-/Exemplarnummer', 'text'],
  ['publisherSeries', 'Edition/Reihe des Verlags (z. B. Schmuckausgabe)', 'text'],
  ['condition', 'Zustand', 'suggest', ['wie neu', 'sehr gut', 'gut', 'mit Gebrauchsspuren', 'beschädigt']],
  ['acquiredFrom', 'Erworben bei', 'text'],
  ['acquiredAt', 'Erworben am', 'date'],
  ['notes', 'Besonderheiten (Widmung, Lesebändchen, Schuber, Farbschnitt …)', 'textarea'],
];

/** Erzeugt die Eingabefelder eines Abschnitts. IDs: `${prefix}-${feld}`. */
function buildFields(container, prefix, specs) {
  for (const [key, label, type, extra] of specs) {
    const id = `${prefix}-${key}`;
    const wrap = document.createElement('div');
    wrap.className = 'field';
    if (type === 'checks') {
      const legend = el('span', 'checks-label', label);
      const box = document.createElement('div');
      box.className = 'checks';
      box.id = id;
      for (const [value, text] of Object.entries(extra)) {
        const l = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = value;
        l.append(cb, text);
        box.appendChild(l);
      }
      wrap.append(legend, box);
      container.appendChild(wrap);
      continue;
    }
    const lab = document.createElement('label');
    lab.htmlFor = id;
    lab.textContent = label;
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
      if (type === 'number') input.inputMode = 'numeric';
      if (type === 'isbn') input.inputMode = 'numeric';
      input.autocomplete = 'off';
      if (type === 'suggest') {
        const dl = document.createElement('datalist');
        dl.id = `${id}-list`;
        for (const v of extra) {
          const o = document.createElement('option');
          o.value = v;
          dl.appendChild(o);
        }
        input.setAttribute('list', dl.id);
        wrap.appendChild(dl);
      }
    }
    input.id = id;
    wrap.prepend(lab);
    wrap.appendChild(input);
    if (type === 'isbn') {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.id = `${id}-hint`;
      wrap.appendChild(hint);
      input.addEventListener('blur', () => showIsbnHint(input, hint));
    }
    container.appendChild(wrap);
  }
}

/** Wert eines Datenfelds ins Formular schreiben. */
function fillFields(prefix, specs, obj) {
  for (const [key, , type, extra] of specs) {
    const el = $(`${prefix}-${key}`);
    if (type === 'checks') {
      const values = (obj && obj[key]) || [];
      el.querySelectorAll('input').forEach((cb) => { cb.checked = values.includes(cb.value); });
    } else if (type === 'isbn') {
      el.value = obj ? (obj.isbn13 || obj.isbn10 || '') : '';
      showIsbnHint(el, $(`${el.id}-hint`));
    } else if (type === 'list') {
      el.value = obj && obj[key] ? obj[key].join(extra === ';' ? '; ' : ', ') : '';
    } else {
      const v = obj ? obj[key] : null;
      el.value = v == null ? '' : v;
    }
  }
}

/** Werte eines Abschnitts aus dem Formular lesen (ISBN getrennt, siehe readIsbn). */
function readFields(prefix, specs) {
  const out = {};
  for (const [key, , type, extra] of specs) {
    const el = $(`${prefix}-${key}`);
    if (type === 'checks') {
      out[key] = [...el.querySelectorAll('input:checked')].map((cb) => cb.value);
    } else if (type === 'isbn') {
      continue;
    } else if (type === 'list') {
      out[key] = el.value.split(extra).map((s) => s.trim()).filter(Boolean);
    } else if (type === 'number') {
      const n = parseInt(el.value, 10);
      out[key] = Number.isFinite(n) && n > 0 ? n : null;
    } else if (type === 'date') {
      out[key] = el.value || null;
    } else {
      out[key] = el.value.trim();
    }
  }
  return out;
}

/** Hat ein gelesener Abschnitt überhaupt Inhalt? */
function hasContent(values) {
  return Object.values(values).some((v) => (Array.isArray(v) ? v.length : v != null && v !== ''));
}

/**
 * Übernimmt Werte in eine Entität. Nur tatsächlich geänderte Felder werden gesetzt
 * und als manuelle Angabe (mit Datum) vermerkt – das ist die Herkunft pro Feld.
 */
function assignManual(entity, values, at) {
  for (const [key, value] of Object.entries(values)) {
    if (JSON.stringify(entity[key]) === JSON.stringify(value)) continue;
    entity[key] = value;
    Model.setSource(entity, key, 'manual', at);
  }
}

/** Zeigt unter einem ISBN-Feld die erkannte ISBN-10/-13 oder einen Fehler. */
function showIsbnHint(input, hint) {
  const parsed = Isbn.parse(input.value);
  hint.classList.toggle('bad', !parsed.valid);
  if (!parsed.valid) hint.textContent = parsed.error;
  else if (parsed.isbn13) {
    hint.textContent = 'ISBN-13: ' + parsed.isbn13 + (parsed.isbn10 ? ' · ISBN-10: ' + parsed.isbn10 : '');
  } else hint.textContent = '';
  return parsed;
}

buildFields($('workFields'), 'w', WORK_FIELDS);
buildFields($('printFields'), 'p', PRINT_FIELDS);
buildFields($('ebookFields'), 'e', EBOOK_FIELDS);
buildFields($('specialFields'), 's', SPECIAL_FIELDS);

/* ====================================================================
   Daten ändern: hinzufügen, bearbeiten, löschen
   Ein "Buch" in der Liste ist ein Eintrag (entry) mit seinem Werk (work)
   und seinen Ausgaben (editions) – siehe js/model.js.
   ==================================================================== */

/** Eintrag mit Werk und Ausgaben als Objekt für Anzeige, Filter und Suche. */
function bookView(entry) {
  const { work, editions } = Model.resolve(state, entry);
  return {
    id: entry.id,
    entry,
    work,
    editions,
    title: work.title,
    author: work.authors.join(', '),
    status: entry.status,
    // Sterne: bei Gelesen/Abgebrochen die Bewertung nach dem Lesen, sonst die Priorität
    rating: (isRatingAfterReading(entry.status) ? entry.finalRating : entry.priority) || 0,
  };
}

function allBooks() {
  return state.entries.map(bookView);
}

/** Sind die Sterne für diesen Status eine Bewertung nach dem Lesen (statt Priorität)? */
function isRatingAfterReading(status) {
  return status === 'read' || status === 'dropped';
}

/** Score eines Buchs mit den eingestellten Gewichten (null ohne Angaben). */
function scoreOf(book) {
  return Score.compute(book.entry, state.settings.weights);
}

/** Score als deutscher Text, z. B. "3,8". */
function formatScore(score) {
  return score == null ? '' : score.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Die Ausgabe eines bestimmten Formats zu einem Eintrag (zuerst die eigenen, dann die des Werks). */
function editionFor(entry, format) {
  const own = entry.editionIds
    .map((id) => state.editions.find((e) => e.id === id))
    .find((e) => e && e.format === format);
  return own || state.editions.find((e) => e.workId === entry.workId && e.format === format) || null;
}

/** Welche Ausgabe-Formate zeigt das Formular bei diesem Besitzformat? */
function formatsFor(ownership) {
  if (ownership === 'ebook') return ['ebook'];
  if (ownership === 'both') return ['print', 'ebook'];
  return ['print']; // Print, noch nicht besessen oder unbekannt: eine (gewünschte) Ausgabe
}

/** Hauptausgabe: an ihr hängen die ISBN oben im Formular und die Besonderheiten. */
function primaryFormat(ownership) {
  return ownership === 'ebook' ? 'ebook' : 'print';
}

/** Liest das ganze Formular in ein Datenobjekt. */
function readForm() {
  const ownership = els.ownership.value || null;
  return {
    isbn: Isbn.parse(els.isbn.value),
    ebookIsbn: Isbn.parse($('e-isbn').value),
    title: els.title.value.trim(),
    authors: els.author.value.split(';').map((a) => a.trim()).filter(Boolean),
    status: els.status.value,
    ownership,
    currentFormat: ownership === 'both' ? (els.currentFormat.value || null) : null,
    rating: formRating || null,
    criteria: readCriteria(),
    notes: els.notes.value.trim(),
    tags: Model.splitList(els.tags.value),
    work: readFields('w', WORK_FIELDS),
    print: readFields('p', PRINT_FIELDS),
    ebook: readFields('e', EBOOK_FIELDS),
    special: readFields('s', SPECIAL_FIELDS),
  };
}

/** Schreibt die Formularwerte in Werk, Ausgaben und Eintrag. */
function applyForm(entry, data) {
  const at = new Date().toISOString();
  const work = Model.resolve(state, entry).work;

  assignManual(work, Object.assign({ title: data.title, authors: data.authors }, data.work), at);
  assignManual(entry, {
    status: data.status,
    ownership: data.ownership,
    currentFormat: data.currentFormat,
    notes: data.notes,
    tags: data.tags,
  }, at);
  if (isRatingAfterReading(data.status)) entry.finalRating = data.rating;
  else entry.priority = data.rating;
  entry.criteria = Object.assign({}, entry.criteria, data.criteria);

  // Ausgaben: je gezeigtem Format anlegen/aktualisieren, sobald etwas eingetragen ist
  const primary = primaryFormat(data.ownership);
  const editionIds = [];
  for (const format of formatsFor(data.ownership)) {
    const parsed = format === primary ? data.isbn : data.ebookIsbn;
    const values = Object.assign({}, data[format], { isbn10: parsed.isbn10, isbn13: parsed.isbn13 });
    const hasSpecial = format === primary && hasContent(data.special);
    let edition = editionFor(entry, format);
    if (!edition && !hasContent(values) && !hasSpecial) continue;
    if (format === primary) values.special = data.special;
    if (!edition) {
      edition = Model.createEdition({ workId: work.id, format });
      state.editions.push(edition);
    }
    if (values.special) values.special = Object.assign({}, edition.special, values.special);
    assignManual(edition, values, at);
    editionIds.push(edition.id);
  }
  // Ausgaben eines nicht mehr gewählten Formats bleiben beim Werk gespeichert,
  // gehören aber nicht mehr zu "meinen" Ausgaben.
  entry.editionIds = editionIds;
}

/** Legt ein neues Buch (Werk + Eintrag) an. */
function addBook(data) {
  const work = Model.createWork();
  const entry = Model.createEntry({ workId: work.id });
  state.works.push(work);
  state.entries.unshift(entry);
  applyForm(entry, data);
  saveState();
}

/** Übernimmt geänderte Formularwerte in ein bestehendes Buch. */
function updateBook(id, data) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  applyForm(entry, data);
  saveState();
}

/** Löscht ein Buch (Eintrag, Werk, Ausgaben) und merkt es sich kurz für "Rückgängig". */
function deleteBook(id) {
  const index = state.entries.findIndex((e) => e.id === id);
  if (index === -1) return;
  const entry = state.entries[index];
  const work = Model.resolve(state, entry).work;
  const editions = state.editions.filter((ed) => ed.workId === work.id);
  lastDeleted = { entry, index, work, editions };
  state.entries.splice(index, 1);
  // Werk und Ausgaben nur entfernen, wenn kein anderer Eintrag sie nutzt
  if (!state.entries.some((e) => e.workId === work.id)) {
    state.works = state.works.filter((w) => w.id !== work.id);
    state.editions = state.editions.filter((ed) => ed.workId !== work.id);
  }
  saveState();
  render();
  showToast(`„${work.title}" gelöscht`);
}

/** Stellt das zuletzt gelöschte Buch an seiner alten Position wieder her. */
function undoDelete() {
  if (!lastDeleted) return;
  const { entry, index, work, editions } = lastDeleted;
  if (!state.works.some((w) => w.id === work.id)) state.works.push(work);
  for (const ed of editions) {
    if (!state.editions.some((x) => x.id === ed.id)) state.editions.push(ed);
  }
  state.entries.splice(index, 0, entry);
  lastDeleted = null;
  saveState();
  hideToast();
  render();
}

/* ====================================================================
   Anzeige (Rendering)
   ==================================================================== */

/** Liefert die Bücher, die zu Ansicht, Filtern und Suche passen, sortiert. */
function visibleBooks() {
  const list = List.filterBooks(allBooks(), {
    view: activeView,
    status: activeFilter,
    format: activeFormat,
    genre: activeGenre,
    minScore,
    scoreOf,
    search: searchTerm,
  });
  return List.sortBooks(list, state.settings.sort, { scoreOf });
}

/** Bücher der Warteschlange "Als Nächstes" in ihrer manuellen Reihenfolge. */
function inQueueOrder(books) {
  return books.slice().sort((a, b) => (a.entry.queuePos || 0) - (b.entry.queuePos || 0));
}

/**
 * Teilt die Liste in Gruppen. In der Leseliste ohne Statusfilter:
 * "Lese gerade" oben, dann die Warteschlange, dann der Backlog.
 */
function groupedBooks(list) {
  if (activeFilter === 'next') return [{ title: null, books: inQueueOrder(list), queue: true }];
  if (activeView !== 'open' || activeFilter !== 'all') return [{ title: null, books: list }];
  return [
    { title: STATUSES.reading, books: list.filter((b) => b.status === 'reading') },
    { title: STATUSES.next, books: inQueueOrder(list.filter((b) => b.status === 'next')), queue: true },
    { title: STATUSES.backlog, books: list.filter((b) => b.status === 'backlog') },
  ].filter((g) => g.books.length);
}

/** Erzeugt einen Filter-Chip mit Anzahl. */
function chip(className, dataKey, key, label, count, pressed) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset[dataKey] = key;
  btn.setAttribute('aria-pressed', String(pressed));
  btn.textContent = label;
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = count;
  btn.appendChild(n);
  return btn;
}

/** Baut Ansicht-Tabs, Status- und Format-Chips inkl. Anzahl. */
function renderFilters() {
  const books = allBooks();

  els.views.innerHTML = '';
  for (const [key, view] of Object.entries(List.VIEWS)) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.view = key;
    tab.setAttribute('aria-selected', String(key === activeView));
    const count = books.filter((b) => view.statuses.includes(b.status)).length;
    tab.textContent = `${view.label} (${count})`;
    els.views.appendChild(tab);
  }

  // Status-Chips: nur die Status der aktuellen Ansicht; Zählung berücksichtigt das Format
  const statuses = List.VIEWS[activeView].statuses;
  const inFormat = List.filterBooks(books, { view: activeView, format: activeFormat });
  els.filters.innerHTML = '';
  els.filters.appendChild(chip('chip', 'filter', 'all', 'Alle', inFormat.length, activeFilter === 'all'));
  for (const key of statuses) {
    const count = inFormat.filter((b) => b.status === key).length;
    els.filters.appendChild(chip('chip', 'filter', key, STATUSES[key], count, activeFilter === key));
  }

  // Genre-Auswahl: alle vorkommenden Genres und Tags
  const genres = [...new Map(books.flatMap(List.genresOf).map((g) => [List.normalize(g), g])).values()]
    .sort((a, b) => a.localeCompare(b, 'de'));
  els.genre.innerHTML = '';
  fillSelect(els.genre, [['', 'alle'], ...genres.map((g) => [g, g])]);
  if (activeGenre && !genres.some((g) => List.normalize(g) === List.normalize(activeGenre))) activeGenre = '';
  els.genre.value = genres.find((g) => List.normalize(g) === List.normalize(activeGenre)) || '';
  els.sort.value = state.settings.sort;

  // Format-Chips: Zählung berücksichtigt Ansicht und Status
  els.formatFilters.innerHTML = '';
  for (const [key, f] of Object.entries(List.FORMAT_FILTERS)) {
    const count = List.filterBooks(books, { view: activeView, status: activeFilter, format: key }).length;
    els.formatFilters.appendChild(chip('chip chip-format', 'format', key, f.label, count, activeFormat === key));
  }
}

/** Sterne als Text, z. B. ★★★☆☆ (leere Sterne heller). */
function starsElement(rating, label) {
  const span = document.createElement('span');
  span.className = 'stars-display';
  span.setAttribute('aria-label', `${label}: ${rating} von 5`);
  span.title = label;
  span.textContent = '★'.repeat(rating);
  const off = document.createElement('span');
  off.className = 'off';
  off.textContent = '★'.repeat(5 - rating);
  span.appendChild(off);
  return span;
}

/** Kurzer Text zum Besitzformat, z. B. "Print + E-Book · liest als E-Book". */
function formatLabel(entry) {
  const o = entry.ownership;
  if (o === 'both') {
    const cur = entry.currentFormat ? ` · liest als ${entry.currentFormat === 'ebook' ? 'E-Book' : 'Print'}` : '';
    return 'Print + E-Book' + cur;
  }
  if (o === 'ebook') return 'E-Book';
  if (o === 'print') return 'Print';
  if (o === 'none') return 'nicht im Besitz';
  return 'Format offen';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Erzeugt die Karte für ein einzelnes Buch. */
function bookCard(book, inQueue = false) {
  // Hinweis: Alle Texte werden per textContent gesetzt, nie per innerHTML.
  // So kann ein Titel wie "<b>" die Seite nicht durcheinanderbringen.
  const { entry, work } = book;
  const li = el('li', 'book');
  li.dataset.status = book.status;
  li.dataset.id = book.id;

  li.appendChild(el('h3', 'book-title', work.title));
  if (work.subtitle) li.appendChild(el('p', 'book-sub', work.subtitle));
  if (book.author) li.appendChild(el('p', 'book-author', book.author));
  if (work.series) {
    li.appendChild(el('p', 'book-sub', work.series + (work.seriesNumber ? `, Band ${work.seriesNumber}` : '')));
  }

  const meta = el('div', 'book-meta');
  meta.appendChild(el('span', 'badge', STATUSES[book.status] || book.status));
  meta.appendChild(el('span', 'badge badge-format', formatLabel(entry)));
  const score = isRatingAfterReading(book.status) ? null : scoreOf(book);
  if (score != null) {
    const b = el('span', 'badge badge-score', 'Score ' + formatScore(score));
    b.title = 'Score aus Priorität und Teilkriterien (1–5)';
    meta.appendChild(b);
  }
  if (book.rating > 0) {
    meta.appendChild(starsElement(book.rating, isRatingAfterReading(book.status) ? 'Bewertung' : 'Priorität'));
  }
  li.appendChild(meta);

  const tags = List.genresOf(book);
  if (tags.length) {
    const box = el('div', 'tags');
    for (const t of tags) box.appendChild(el('span', 'tag', t));
    li.appendChild(box);
  }

  if (entry.notes) li.appendChild(el('p', 'book-notes', entry.notes));

  const actions = el('div', 'book-actions');
  const added = el('span', 'added', 'Hinzugefügt am ' + new Date(entry.addedAt).toLocaleDateString('de-DE'));
  const editBtn = el('button', 'btn', 'Bearbeiten');
  editBtn.type = 'button';
  editBtn.dataset.action = 'edit';
  const delBtn = el('button', 'btn btn-danger', 'Löschen');
  delBtn.type = 'button';
  delBtn.dataset.action = 'delete';
  if (inQueue) {
    // Manuelle Reihenfolge der Warteschlange: Platz + Hoch/Runter statt Datum
    const q = el('div', 'queue-btns');
    q.appendChild(el('span', 'queue-pos', `${entry.queuePos}.`));
    for (const [delta, label, text] of [[-1, 'Nach oben', '↑'], [1, 'Nach unten', '↓']]) {
      const b = el('button', 'btn', text);
      b.type = 'button';
      b.dataset.action = 'move';
      b.dataset.delta = delta;
      b.setAttribute('aria-label', label);
      q.appendChild(b);
    }
    actions.append(q, editBtn, delBtn);
  } else {
    actions.append(added, editBtn, delBtn);
  }
  li.appendChild(actions);

  return li;
}

/** Zeichnet Filter, Liste und Zähler neu. Wird nach jeder Änderung aufgerufen. */
function render() {
  renderFilters();
  const count = state.entries.length;
  els.total.textContent = count === 1 ? '1 Buch' : `${count} Bücher`;

  const list = visibleBooks();
  els.list.innerHTML = '';
  for (const group of groupedBooks(list)) {
    if (group.title) {
      const head = el('li', 'group-head');
      head.appendChild(el('h2', null, `${group.title} (${group.books.length})`));
      els.list.appendChild(head);
    }
    for (const book of group.books) els.list.appendChild(bookCard(book, Boolean(group.queue)));
  }

  // Hinweis anzeigen, wenn nichts zu sehen ist
  if (list.length === 0) {
    els.empty.hidden = false;
    if (count === 0) {
      els.empty.innerHTML =
        '<h2>Dein Regal ist noch leer</h2>' +
        '<p>Tippe auf <strong>+</strong>, um dein erstes Buch hinzuzufügen.</p>';
    } else if (activeView === 'open' && activeFilter === 'all' && activeFormat === 'all' &&
               !searchTerm && !activeGenre && minScore == null) {
      els.empty.innerHTML = '<p>Keine offenen Bücher. Gelesene findest du im <strong>Archiv</strong>.</p>';
    } else {
      els.empty.innerHTML = '<p>Keine Bücher gefunden.</p>';
    }
  } else {
    els.empty.hidden = true;
  }
}

/* ====================================================================
   Formular-Dialog (Hinzufügen / Bearbeiten)
   ==================================================================== */

// Status- und Besitzformat-Auswahl im Formular einmalig befüllen
function fillSelect(select, options) {
  for (const [key, label] of options) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    select.appendChild(opt);
  }
}
fillSelect(els.status, Object.entries(STATUSES));
fillSelect(els.ownership, [...Object.entries(Model.OWNERSHIP), ['', 'nicht angegeben']]);
fillSelect(els.sort, Object.entries(List.SORTS).map(([key, s]) => [key, s.label]));

/* ---------- Teilkriterien (je 1–5) im Formular ---------- */

const CRITERIA_FIELDS = [
  ['anticipation', 'Vorfreude'],
  ['urgency', 'Aktualität/Zeitdruck'],
  ['effort', 'Umfang/Aufwand (1 = leicht, 5 = aufwendig)'],
  ['mood', 'Passt zur Stimmung'],
];
for (const [key, label] of CRITERIA_FIELDS) {
  const wrap = el('div', 'field');
  const lab = el('label', null, label);
  lab.htmlFor = `c-${key}`;
  const select = document.createElement('select');
  select.id = `c-${key}`;
  fillSelect(select, [['', '–'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']]);
  select.addEventListener('change', paintScorePreview);
  wrap.append(lab, select);
  els.criteria.appendChild(wrap);
}

function readCriteria() {
  const out = {};
  for (const [key] of CRITERIA_FIELDS) {
    const v = $(`c-${key}`).value;
    out[key] = v ? Number(v) : null;
  }
  return out;
}

/** Zeigt im Formular den Score, der sich aus den aktuellen Angaben ergibt. */
function paintScorePreview() {
  if (isRatingAfterReading(els.status.value)) {
    els.scorePreview.textContent = '';
    return;
  }
  const score = Score.compute({ priority: formRating || null, criteria: readCriteria() }, state.settings.weights);
  els.scorePreview.textContent = score == null ? 'noch kein Score' : `Score ${formatScore(score)}`;
}

// Fünf Stern-Knöpfe für die Bewertung anlegen
for (let i = 1; i <= 5; i++) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.value = i;
  btn.textContent = '★';
  btn.setAttribute('aria-label', `${i} ${i === 1 ? 'Stern' : 'Sterne'}`);
  els.stars.appendChild(btn);
}
const starHint = document.createElement('span');
starHint.className = 'hint';
els.stars.appendChild(starHint);

/** Hebt die Sterne im Formular passend zur aktuellen Bewertung hervor. */
function paintStars() {
  els.stars.querySelectorAll('button').forEach((btn) => {
    const on = Number(btn.dataset.value) <= formRating;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === formRating));
  });
  starHint.textContent = formRating ? '' : 'keine';
}

/** Beschriftung der Sterne: Priorität bei offenen, Bewertung bei gelesenen Büchern. */
function paintRatingLabel() {
  els.ratingLabel.textContent = isRatingAfterReading(els.status.value)
    ? 'Bewertung nach dem Lesen' : 'Priorität';
}

/** Zeigt je nach Besitzformat die passenden Ausgabe-Abschnitte. */
function paintOwnership() {
  const ownership = els.ownership.value;
  const formats = formatsFor(ownership);
  els.secPrint.hidden = !formats.includes('print');
  els.secEbook.hidden = !formats.includes('ebook');
  els.secPrintTitle.textContent = ownership === 'print' || ownership === 'both'
    ? 'Meine Ausgabe (Print)' : 'Ausgabe (falls bekannt)';
  // Die ISBN oben gehört zur Hauptausgabe; das E-Book hat nur bei "beides" ein eigenes Feld
  $('e-isbn').closest('.field').hidden = ownership !== 'both';
  els.currentFormatField.hidden = ownership !== 'both';
}

/** Öffnet den Dialog – leer für ein neues Buch oder befüllt zum Bearbeiten. */
function openDialog(book = null) {
  editingId = book ? book.id : null;
  const entry = book ? book.entry : null;
  const work = book ? book.work : null;
  const ownership = entry ? (entry.ownership || '') : 'none';
  const print = entry ? editionFor(entry, 'print') : null;
  const ebook = entry ? editionFor(entry, 'ebook') : null;
  const primary = primaryFormat(ownership) === 'ebook' ? ebook : print;

  els.dialogTitle.textContent = book ? 'Buch bearbeiten' : 'Buch hinzufügen';
  els.isbn.value = primary ? (primary.isbn13 || primary.isbn10) : '';
  showIsbnHint(els.isbn, els.isbnHint);
  els.title.value = work ? work.title : '';
  els.author.value = work ? work.authors.join('; ') : '';
  // Neues Buch: Status vom aktiven Filter übernehmen, sonst "Wunschliste/Backlog"
  els.status.value = book ? book.status
    : (activeFilter !== 'all' ? activeFilter : (activeView === 'archive' ? 'read' : 'backlog'));
  els.ownership.value = ownership;
  els.currentFormat.value = entry && entry.currentFormat ? entry.currentFormat : '';
  els.notes.value = entry ? entry.notes : '';
  els.tags.value = entry ? entry.tags.join(', ') : '';
  fillFields('w', WORK_FIELDS, work);
  fillFields('p', PRINT_FIELDS, print);
  fillFields('e', EBOOK_FIELDS, ebook);
  fillFields('s', SPECIAL_FIELDS, primary ? primary.special : null);
  // Abschnitte mit Inhalt beim Bearbeiten aufgeklappt zeigen
  for (const [id, values] of [
    ['secWork', work && readFields('w', WORK_FIELDS)],
    ['secPrint', print && readFields('p', PRINT_FIELDS)],
    ['secEbook', ebook && readFields('e', EBOOK_FIELDS)],
    ['secSpecial', primary && readFields('s', SPECIAL_FIELDS)],
  ]) $(id).open = Boolean(values && hasContent(values));

  for (const [key] of CRITERIA_FIELDS) {
    const v = entry && entry.criteria ? entry.criteria[key] : null;
    $(`c-${key}`).value = v ? String(v) : '';
  }
  $('secCriteria').open = Boolean(entry && Object.values(readCriteria()).some((v) => v != null));

  formRating = book ? book.rating : 0;
  els.error.textContent = '';
  paintStars();
  paintRatingLabel();
  paintScorePreview();
  paintOwnership();
  els.dialog.showModal();
  els.dialog.scrollTop = 0;
  // Auf dem Handy nur bei neuen Büchern direkt die Tastatur öffnen
  if (!book) els.isbn.focus();
}

function closeDialog() {
  els.dialog.close();
  editingId = null;
}

/** Prüft das Formular und speichert das Buch. */
function submitForm(event) {
  event.preventDefault();
  const data = readForm();

  if (!data.isbn.valid) {
    els.error.textContent = data.isbn.error;
    els.isbn.focus();
    return;
  }
  if (data.ownership === 'both' && !data.ebookIsbn.valid) {
    els.error.textContent = 'E-Book: ' + data.ebookIsbn.error;
    $('secEbook').open = true;
    $('e-isbn').focus();
    return;
  }
  if (!data.title) {
    els.error.textContent = 'Bitte einen Titel eintragen.';
    els.title.focus();
    return;
  }

  if (editingId) updateBook(editingId, data);
  else addBook(data);

  closeDialog();
  render();
}

/* ====================================================================
   Kurze Meldung (Toast)
   ==================================================================== */

function showToast(text) {
  els.toastText.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  els.toast.hidden = true;
  lastDeleted = null;
}

/* ====================================================================
   Ereignisse (Klicks, Eingaben)
   ==================================================================== */

$('addBtn').addEventListener('click', () => openDialog());
$('cancelBtn').addEventListener('click', closeDialog);
els.form.addEventListener('submit', submitForm);
els.status.addEventListener('change', () => { paintRatingLabel(); paintScorePreview(); });
els.ownership.addEventListener('change', paintOwnership);
els.isbn.addEventListener('blur', () => showIsbnHint(els.isbn, els.isbnHint));
els.toastUndo.addEventListener('click', undoDelete);

// Klick auf den abgedunkelten Hintergrund schließt den Dialog
els.dialog.addEventListener('click', (e) => {
  if (e.target === els.dialog) closeDialog();
});

// Sterne: Klick setzt die Bewertung, erneuter Klick auf denselben Stern entfernt sie
els.stars.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const value = Number(btn.dataset.value);
  formRating = formRating === value ? 0 : value;
  paintStars();
  paintScorePreview();
});

// Suche: Liste bei jeder Eingabe aktualisieren
els.search.addEventListener('input', () => {
  searchTerm = els.search.value;
  render();
});

// Ansicht wechseln (Leseliste / Archiv / Alle); der Statusfilter beginnt dann wieder bei "Alle"
els.views.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  activeView = tab.dataset.view;
  activeFilter = 'all';
  render();
});

// Status-Chips (ein Listener für alle Chips)
els.filters.addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  activeFilter = c.dataset.filter;
  render();
});

// Format-Chips
els.formatFilters.addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  activeFormat = c.dataset.format;
  render();
});

// Sortierung (wird gespeichert), Genre und Mindestscore
els.sort.addEventListener('change', () => {
  state.settings.sort = els.sort.value;
  saveState();
  render();
});
els.genre.addEventListener('change', () => {
  activeGenre = els.genre.value;
  render();
});
els.minScore.addEventListener('change', () => {
  minScore = els.minScore.value ? Number(els.minScore.value) : null;
  render();
});

// Bearbeiten/Löschen-Knöpfe in den Karten (ein Listener für die ganze Liste)
els.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.book').dataset.id;
  const book = allBooks().find((b) => b.id === id);
  if (!book) return;
  if (btn.dataset.action === 'edit') openDialog(book);
  if (btn.dataset.action === 'move') {
    if (List.moveInQueue(state.entries, id, Number(btn.dataset.delta))) {
      saveState();
      render();
      // Fokus auf dem Knopf am neuen Platz halten (bequem für mehrfaches Verschieben)
      const card = els.list.querySelector(`.book[data-id="${id}"] [data-delta="${btn.dataset.delta}"]`);
      if (card) card.focus();
    }
  }
  if (btn.dataset.action === 'delete') {
    if (confirm(`„${book.title}" wirklich löschen?`)) deleteBook(id);
  }
});

// Änderungen aus einem anderen Tab übernehmen (gleicher Browser)
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    state = loadState();
    render();
  }
});

/* ====================================================================
   Einstellungen: Score-Gewichte
   ==================================================================== */

for (const [key, label] of Object.entries(Score.CRITERIA)) {
  const wrap = el('div', 'field');
  const lab = el('label', null, label);
  lab.htmlFor = `wt-${key}`;
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.max = '100';
  input.id = `wt-${key}`;
  wrap.append(lab, input);
  els.weightFields.appendChild(wrap);
}

function fillWeights(weights) {
  for (const key of Object.keys(Score.CRITERIA)) $(`wt-${key}`).value = weights[key] ?? 0;
}

$('settingsBtn').addEventListener('click', () => {
  fillWeights(state.settings.weights);
  els.settingsDialog.showModal();
});
$('settingsCancelBtn').addEventListener('click', () => els.settingsDialog.close());
$('resetWeightsBtn').addEventListener('click', () => fillWeights(Score.DEFAULT_WEIGHTS));
els.settingsDialog.addEventListener('click', (e) => {
  if (e.target === els.settingsDialog) els.settingsDialog.close();
});
els.settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const weights = {};
  for (const key of Object.keys(Score.CRITERIA)) {
    const n = Number($(`wt-${key}`).value);
    weights[key] = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 0;
  }
  state.settings.weights = weights;
  saveState();
  els.settingsDialog.close();
  render();
});

// Los geht's
render();
