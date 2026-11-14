/* ====================================================================
   3. LOGIK (Oberfläche)
   Reine Logik ohne DOM liegt in eigenen Dateien und ist getestet:
     js/isbn.js  – ISBN prüfen und umrechnen
     js/model.js – Datenmodell (Werk, Ausgabe, Eintrag), Migration, Laden
     js/list.js  – Filtern, Sortieren, Warteschlange "Als Nächstes"
     js/score.js – Score aus Priorität und Teilkriterien
     js/progress.js – Lesefortschritt, Verlauf, Restdauer
     js/sources.js, js/enrich.js – Metadaten-Quellen, Zusammenführen, Vorschläge
     js/covers.js – Cover-Bilder lokal in IndexedDB (nur Browser)
     js/transfer.js – Import/Export (JSON, CSV)
   ==================================================================== */
'use strict';

const STORAGE_KEY = Model.KEYS.v2;
const LAST_EXPORT_KEY = 'buecher-tracker.lastExport';          // Datum des letzten JSON-Exports
const BEFORE_RESTORE_KEY = 'buecher-tracker.v2.vorWiederherstellung'; // Stand vor "Backup wiederherstellen"
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
let activeFolder = null;     // aus dem Album gewählte Mappe { key, title, ids } oder null
let statPeriod = 'month';    // Zeitraum der Statistik: 'week' | 'month' | 'year'
let editingId = null;        // ID des Eintrags im Bearbeiten-Dialog (null = neues Buch)
let formRating = 0;          // Sterne im Formular (0 = keine): Priorität bzw. Bewertung nach dem Lesen
let progressId = null;
let formProvenance = {};     // im Formular übernommene Vorschläge: 'work.title' -> { source, at, value }
let pendingCover = null;     // neues Cover im Formular: { blob, source, at } oder 'remove'
let enrichedInDialog = false; // wurde im offenen Formular schon gesucht?
let enrichRun = 0;           // Zähler, damit veraltete Suchergebnisse ignoriert werden
let enrichResult = null;     // letztes Suchergebnis (Ausgaben, Fehler …)
let enrichRows = [];         // Feldzeilen der gewählten Ausgabe
let enrichEdition = null;    // gewählte Ausgabe
const coverBlobs = new Map(); // Cover-URL der Quelle -> heruntergeladenes Bild (Promise)       // ID des Eintrags im Fortschritt-Dialog
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
  startDate: $('fStartDate'),
  endDate: $('fEndDate'),
  progressDialog: $('progressDialog'),
  progressForm: $('progressForm'),
  progressBook: $('progressBook'),
  pUnit: $('pUnit'),
  pValue: $('pValue'),
  pValueLabel: $('pValueLabel'),
  pChapterCountField: $('pChapterCountField'),
  pChapterCount: $('pChapterCount'),
  pDate: $('pDate'),
  pPreview: $('pPreview'),
  progressLog: $('progressLog'),
  progressError: $('progressError'),
  formNote: $('formNote'),
  coverPreview: $('coverPreview'),
  coverFile: $('coverFile'),
  coverRemoveBtn: $('coverRemoveBtn'),
  coverHint: $('coverHint'),
  enrichDialog: $('enrichDialog'),
  enrichStatus: $('enrichStatus'),
  enrichErrors: $('enrichErrors'),
  enrichSpecial: $('enrichSpecial'),
  editionList: $('editionList'),
  fieldView: $('fieldView'),
  editionSummary: $('editionSummary'),
  fieldTable: $('fieldTable'),
  enrichAllBtn: $('enrichAllBtn'),
  enrichApplyBtn: $('enrichApplyBtn'),
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
 * Übernimmt Werte in eine Entität. Nur tatsächlich geänderte Felder werden gesetzt und
 * mit ihrer Herkunft vermerkt: 'manual', oder die Quelle eines im Formular übernommenen
 * Vorschlags, solange der Wert danach nicht von Hand geändert wurde.
 */
function assignManual(entity, values, at, scope) {
  for (const [key, value] of Object.entries(values)) {
    if (JSON.stringify(entity[key]) === JSON.stringify(value)) continue;
    entity[key] = value;
    const prov = scope && formProvenance[`${scope}.${key}`];
    if (prov && Enrich.sameValue(prov.value, value)) Model.setSource(entity, key, prov.source, prov.at);
    else Model.setSource(entity, key, 'manual', at);
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

/** Format, in dem gerade gelesen wird: bei "beides" die Angabe, sonst das Besitzformat. */
function readingFormat(entry) {
  if (entry.ownership === 'both') return entry.currentFormat || 'print';
  return entry.ownership === 'ebook' ? 'ebook' : 'print';
}

/** Seitenzahl der Ausgabe, in der gerade gelesen wird (sonst irgendeiner bekannten Ausgabe). */
function totalPagesOf(entry) {
  const ed = editionFor(entry, readingFormat(entry));
  if (ed && ed.pages) return ed.pages;
  const any = entry.editionIds.map((id) => state.editions.find((e) => e.id === id)).find((e) => e && e.pages);
  return any ? any.pages : null;
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
    startDate: els.startDate.value || null,
    endDate: els.endDate.value || null,
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

  assignManual(work, Object.assign({ title: data.title, authors: data.authors }, data.work), at, 'work');
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
  entry.progress.startDate = data.startDate;
  entry.progress.endDate = data.endDate;

  // Ausgaben: je gezeigtem Format anlegen/aktualisieren, sobald etwas eingetragen ist
  const primary = primaryFormat(data.ownership);
  const editionIds = [];
  for (const format of formatsFor(data.ownership)) {
    const parsed = format === primary ? data.isbn : data.ebookIsbn;
    const values = Object.assign({}, data[format], { isbn10: parsed.isbn10, isbn13: parsed.isbn13 });
    const hasSpecial = format === primary && hasContent(data.special);
    const hasCover = format === primary && pendingCover && pendingCover !== 'remove';
    let edition = editionFor(entry, format);
    if (!edition && !hasContent(values) && !hasSpecial && !hasCover) continue;
    if (format === primary) values.special = data.special;
    if (!edition) {
      edition = Model.createEdition({ workId: work.id, format });
      state.editions.push(edition);
    }
    if (values.special) values.special = Object.assign({}, edition.special, values.special);
    assignManual(edition, values, at, format === primary ? 'edition' : null);
    if (format === primary) applyCover(work, edition, at);
    editionIds.push(edition.id);
  }
  // Ausgaben eines nicht mehr gewählten Formats bleiben beim Werk gespeichert,
  // gehören aber nicht mehr zu "meinen" Ausgaben.
  entry.editionIds = editionIds;

  // Gelesen: Fortschritt auf 100 %, Enddatum vorbelegt (das Datum im Formular hat Vorrang)
  if (data.status === 'read') Progress.markRead(entry.progress, totalPagesOf(entry), data.endDate);
}

/**
 * Neues oder entferntes Cover aus dem Formular übernehmen: Bild in IndexedDB,
 * Verweis an der Ausgabe (und am Werk, falls dieses noch keins hat).
 */
function applyCover(work, edition, at) {
  if (!pendingCover) return;
  if (pendingCover === 'remove') {
    if (work.coverId === edition.coverId) work.coverId = null;
    edition.coverId = null;
    Model.setSource(edition, 'coverId', 'manual', at);
    return;
  }
  const id = Model.newId();
  const { blob, source } = pendingCover;
  edition.coverId = id;
  Model.setSource(edition, 'coverId', source, pendingCover.at || at);
  if (!work.coverId) work.coverId = id;
  Covers.put(id, blob).then(render).catch((err) => {
    console.error('Cover konnte nicht gespeichert werden:', err);
    showToast('Das Cover konnte nicht gespeichert werden.');
  });
}

/** Cover-ID eines Buchs: die der Hauptausgabe, sonst die des Werks. */
function coverIdOf(entry) {
  const ed = editionFor(entry, primaryFormat(entry.ownership));
  return (ed && ed.coverId) || Model.resolve(state, entry).work.coverId || null;
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
  showToast(`„${work.title}" gelöscht`, true);
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
  const inFolder = activeFolder ? list.filter((b) => activeFolder.ids.includes(b.id)) : list;
  return List.sortBooks(inFolder, state.settings.sort, { scoreOf });
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

/** Wie viele Filter (Status, Format, Genre, Mindestscore) sind gesetzt? */
function filterActiveCount() {
  return [activeFilter !== 'all', activeFormat !== 'all', Boolean(activeGenre), minScore != null].filter(Boolean).length;
}

/** Baut Ansicht-Tabs, Status- und Format-Chips inkl. Anzahl. */
function renderFilters() {
  const books = allBooks();

  // Pillen-Umschalter (Porto): die Markierung <i> bleibt erhalten, damit sie zur neuen Ansicht gleitet
  let marker = els.views.querySelector('i');
  if (!marker) marker = el('i');
  els.views.replaceChildren(marker);
  const viewKeys = Object.keys(List.VIEWS);
  els.views.style.setProperty('--n', viewKeys.length);
  els.views.style.setProperty('--i', Math.max(0, viewKeys.indexOf(activeView)));
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

  // Zahl der aktiven Filter am Filter-Knopf
  const active = filterActiveCount();
  $('filterCount').textContent = active;
  $('filterCount').hidden = active === 0;

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

/** Datum 'YYYY-MM-DD' als deutsches Datum. */
function formatDate(day) {
  return day ? new Date(day + 'T00:00:00').toLocaleDateString('de-DE') : '';
}

/**
 * Fortschrittsbalken mit Stand, "zuletzt gelesen" und Restdauer.
 * Nur bei "Lese gerade" oder wenn bei offenen/abgebrochenen Büchern schon ein Stand existiert.
 */
function progressElement(entry) {
  const p = entry.progress;
  const pages = totalPagesOf(entry);
  const pct = Progress.percentOf(p, pages);
  const hasStand = pct != null || p.page != null || p.chapter != null;
  if (entry.status === 'read') {
    if (!p.endDate) return null;
    return el('p', 'progress-text', `Gelesen ${p.startDate && p.startDate !== p.endDate ? `${formatDate(p.startDate)} – ` : 'am '}${formatDate(p.endDate)}`);
  }
  if (entry.status !== 'reading' && !hasStand) return null;

  const box = el('div', 'progress');
  const bar = el('div', 'progress-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  if (pct != null) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  const fill = el('span');
  fill.style.width = `${pct || 0}%`;
  bar.appendChild(fill);
  box.appendChild(bar);

  const text = el('div', 'progress-text');
  text.appendChild(el('span', null, Progress.describe(p, pages) || 'noch kein Stand eingetragen'));
  const last = Progress.lastReadAt(p);
  if (last) text.appendChild(el('span', null, `zuletzt ${formatDate(last)}`));
  const days = entry.status === 'reading' ? Progress.estimateDaysLeft(p, pages) : null;
  if (days) text.appendChild(el('span', null, `noch ca. ${days} ${days === 1 ? 'Tag' : 'Tage'}`));
  box.appendChild(text);
  return box;
}

/* ---------- Cover als Briefmarke (Stil Porto) ---------- */

// Zuletzt gezeichneter Status je Buch und Ansicht: wechselt ein Buch auf Gelesen/Abgebrochen,
// schlägt der Poststempel beim nächsten Zeichnen dieser Ansicht einmal sichtbar auf.
const lastStatus = { regal: new Map(), detail: new Map(), album: new Map() };

/** Festes Motiv je Werk (aus der Id berechnet), damit es beim Neuzeichnen nicht wechselt. */
function motifFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Porto.motifs[h % Porto.motifs.length];
}

/** Ist das Buch abgeschlossen (bekommt einen Poststempel)? */
function isDone(status) {
  return status === 'read' || status === 'dropped';
}

/**
 * Briefmarke mit Zähnung: Cover der Ausgabe (aus IndexedDB) oder ein Porto-Motiv.
 * Gelesene und abgebrochene Bücher bekommen einen Poststempel mit dem Enddatum.
 * opts.tag: 'span' (Standard) oder 'button'; opts.big: großer Stempel mit Wellen;
 * opts.scope: 'regal' oder 'detail' (für das einmalige Aufschlagen des Stempels).
 */
function coverStamp(book, { tag = 'span', big = false, scope = 'regal', className = '', plain = false } = {}) {
  const { entry, work } = book;
  const stamp = el(tag, `stamp ${className}`.trim());
  if (tag === 'span') stamp.setAttribute('aria-hidden', 'true');
  // Motiv sofort zeigen, ein gespeichertes Cover ersetzt es, sobald es geladen ist
  stamp.innerHTML = Porto.motif(motifFor(work.id));
  const coverId = coverIdOf(entry);
  if (coverId) {
    Covers.url(coverId).then((u) => {
      if (!u) return;
      const img = el('img', 'stamp-img');
      img.alt = '';
      img.src = u;
      stamp.querySelector('.stamp-img').replaceWith(img);
    });
  }
  if (plain) return stamp;
  if (isDone(book.status)) {
    const end = entry.progress.endDate;
    const d = end ? new Date(end + 'T00:00:00') : null;
    stamp.insertAdjacentHTML('beforeend', Porto.postmark({
      top: book.status === 'read' ? 'GELESEN' : 'ABGEBROCHEN',
      bottom: big ? 'BÜCHERREGAL' : '',
      date: d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '',
      year: d ? String(d.getFullYear()) : '',
      waves: big,
    }));
    const before = lastStatus[scope].get(book.id);
    if (before && !isDone(before)) {
      // gerade abgeschlossen: Stempel erst nach dem Einfügen setzen, damit er aufschlägt
      requestAnimationFrame(() => requestAnimationFrame(() => stamp.classList.add('is-stamped')));
    } else {
      stamp.classList.add('is-stamped');
    }
  }
  lastStatus[scope].set(book.id, book.status);
  return stamp;
}

/** Zusatzangabe rechts unter der Marke: Platz und Score in der Leseliste, sonst die Seitenzahl. */
function stampInfo(book, inQueue) {
  const pages = totalPagesOf(book.entry);
  if (isDone(book.status)) return pages ? `${pages} S.` : '';
  const score = scoreOf(book);
  const parts = [];
  if (inQueue && book.entry.queuePos) parts.push(`Nº ${book.entry.queuePos}`);
  if (score != null) parts.push(formatScore(score));
  else if (pages) parts.push(`${pages} S.`);
  return parts.join(' · ');
}

/** Eine Marke im Regal: Knopf, der die Detailseite öffnet. */
function shelfItem(book, inQueue = false) {
  const li = el('li', 'shelf-item');
  li.dataset.id = book.id;
  const stamp = coverStamp(book, { tag: 'button', big: true, className: 'lift' });
  stamp.type = 'button';
  stamp.dataset.open = book.id;
  stamp.setAttribute('aria-label', `${book.title}${book.author ? ' von ' + book.author : ''}, ${STATUSES[book.status] || ''}. Details öffnen`);
  const cap = el('span', 'stamp-cap');
  cap.appendChild(el('span', 'stamp-title', book.title));
  const sub = el('span', 'stamp-sub');
  sub.appendChild(el('span', null, book.author));
  const info = stampInfo(book, inQueue);
  if (info) sub.appendChild(el('b', null, info));
  cap.appendChild(sub);
  // Bildunterschrift vor den Stempel, damit der Stempel oben liegt
  stamp.insertBefore(cap, stamp.querySelector('.postmark'));
  li.appendChild(stamp);
  return li;
}

/** "Lese gerade" als Abrisskarte: kleine Marke, Titel, Stand und Fortschritt-Knopf. */
function nowTicket(book) {
  const { entry } = book;
  const li = el('li', 'wide ticket now');
  li.dataset.id = book.id;
  li.dataset.open = book.id;
  const pct = Progress.percentOf(entry.progress, totalPagesOf(entry));
  const body = el('div', 'ticket-body');
  const content = el('div', 'ticket-content');
  content.appendChild(coverStamp(book));
  const text = el('div', 'now-text');
  text.appendChild(el('h3', 'book-title', book.title));
  if (book.author) text.appendChild(el('p', 'book-author', book.author));
  content.appendChild(text);
  const foot = el('div', 'now-foot');
  const progressBox = progressElement(entry);
  if (progressBox) foot.appendChild(progressBox);
  const pBtn = el('button', 'btn btn-primary', 'Fortschritt');
  pBtn.type = 'button';
  pBtn.dataset.action = 'progress';
  pBtn.dataset.id = book.id;
  foot.appendChild(pBtn);
  content.appendChild(foot);
  const stub = el('div', 'ticket-stub', pct != null ? `${Math.round(pct)} % gelesen` : 'Lese gerade');
  stub.setAttribute('aria-hidden', 'true');
  body.append(content, stub);
  li.appendChild(body);
  return li;
}

/** Wie viele Bücher wurden im laufenden Jahr gelesen (Enddatum in diesem Jahr)? */
function readThisYear() {
  const year = String(new Date().getFullYear());
  return state.entries.filter((e) => e.status === 'read' && (e.progress.endDate || '').startsWith(year)).length;
}

/** Zeichnet das Regal: Filter, Zähler, Gruppen, Abrisskarte und Marken. */
function renderRegal() {
  renderFilters();
  const year = new Date().getFullYear();
  $('yearLabel').textContent = `Lesejahr ${year}`;
  $('readYearHint').textContent = `gelesen ${year}`;
  const count = readThisYear();
  const counter = $('readCount');
  if (counter.textContent !== String(count)) {
    if (counter.dataset.ready) Porto.countTo(counter, count, 400);
    else counter.textContent = count;
  }
  counter.dataset.ready = '1';

  if (activeFolder) {
    // Mappe ist weg (z. B. Buch gelöscht): Auswahl aufheben
    const ids = new Set(state.entries.map((e) => e.id));
    activeFolder.ids = activeFolder.ids.filter((id) => ids.has(id));
    if (!activeFolder.ids.length) activeFolder = null;
  }
  $('folderChip').hidden = !activeFolder;
  if (activeFolder) $('folderName').textContent = activeFolder.title;

  const list = visibleBooks();
  els.list.innerHTML = '';
  for (const group of groupedBooks(list)) {
    if (group.title) {
      const head = el('li', 'wide group-head');
      head.appendChild(el('h2', null, `${group.title} · ${group.books.length}`));
      els.list.appendChild(head);
    }
    for (const book of group.books) {
      els.list.appendChild(book.status === 'reading' && activeView !== 'archive' ? nowTicket(book) : shelfItem(book, Boolean(group.queue)));
    }
  }

  // Suche/Filter offen halten, solange etwas gesucht oder gefiltert wird
  if (searchTerm || filterActiveCount()) setToolbarOpen(true);

  // Hinweis anzeigen, wenn nichts zu sehen ist
  const total = state.entries.length;
  if (list.length === 0) {
    els.empty.hidden = false;
    if (total === 0) {
      els.empty.innerHTML =
        '<h2>Dein Regal ist noch leer</h2>' +
        '<p>Tippe auf <strong>+</strong>, um dein erstes Buch hinzuzufügen.</p>';
    } else if (activeView === 'open' && activeFilter === 'all' && activeFormat === 'all' &&
               !searchTerm && !activeGenre && minScore == null && !activeFolder) {
      els.empty.innerHTML = '<p>Keine offenen Bücher. Gelesene findest du im <strong>Archiv</strong>.</p>';
    } else {
      els.empty.innerHTML = '<p>Keine Bücher gefunden.</p>';
    }
  } else {
    els.empty.hidden = true;
  }
}

/* ---------- Detailseite ---------- */

/** Tage seit Beginn (bis Ende oder heute), null ohne Beginn. */
function readingDays(p) {
  if (!p.startDate) return null;
  const end = p.endDate ? new Date(p.endDate + 'T00:00:00') : new Date(Progress.today() + 'T00:00:00');
  const days = Math.round((end - new Date(p.startDate + 'T00:00:00')) / 86400000) + 1;
  return days > 0 ? days : null;
}

function fact(value, label) {
  const d = el('div');
  d.appendChild(el('b', null, value == null || value === '' ? '–' : String(value)));
  d.appendChild(el('span', null, label));
  return d;
}

function actionBtn(label, action, cls = '', extra = {}) {
  const b = el('button', 'btn ' + cls, label);
  b.type = 'button';
  b.dataset.action = action;
  Object.assign(b.dataset, extra);
  return b;
}

/** Zeichnet die Detailseite eines Buchs (#buch/<id>). */
function renderDetail(id) {
  const view = $('viewDetail');
  const book = allBooks().find((b) => b.id === id);
  view.innerHTML = '';
  if (!book) return false;
  const { entry, work } = book;
  const p = entry.progress;
  const pages = totalPagesOf(entry);
  const pct = Progress.percentOf(p, pages);
  view.dataset.id = id;

  // Kopf: zurück, Status als Eyebrow, rechts Bearbeiten
  const head = el('div', 'p-head');
  const back = el('button', 'iconbtn');
  back.type = 'button';
  back.dataset.action = 'back';
  back.setAttribute('aria-label', 'Zurück zum Regal');
  back.innerHTML = Porto.icon('zurueck');
  head.appendChild(back);
  head.appendChild(el('span', 'eyebrow', STATUSES[book.status] || ''));
  const edit = el('button', 'iconbtn');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  edit.setAttribute('aria-label', 'Bearbeiten');
  edit.innerHTML = Porto.icon('buch');
  head.appendChild(edit);
  view.appendChild(head);

  // Große Marke, neigt sich zum Finger (Porto.tilt)
  const hero = el('div', 'detail-hero');
  const stamp = coverStamp(book, { big: true, scope: 'detail' });
  stamp.dataset.tilt = '';
  hero.appendChild(stamp);
  view.appendChild(hero);
  Porto.tilt(stamp, 12);

  view.appendChild(el('h1', 'detail-title', book.title));
  const meta = [book.author, work.year].filter(Boolean).join(' · ');
  if (meta) view.appendChild(el('p', 'detail-meta', meta));
  if (work.subtitle) view.appendChild(el('p', 'detail-meta', work.subtitle));
  if (work.series) view.appendChild(el('p', 'detail-meta', work.series + (work.seriesNumber ? `, Band ${work.seriesNumber}` : '')));

  // Drei Fakten: Seiten, gelesen bzw. Score, Tage bzw. Platz
  const facts = el('div', 'facts');
  const started = book.status === 'reading' || isDone(book.status) || pct != null;
  facts.appendChild(fact(pages, 'Seiten'));
  if (started) {
    facts.appendChild(fact(pct != null ? `${Math.round(pct)} %` : null, 'gelesen'));
    facts.appendChild(fact(readingDays(p), 'Tage'));
  } else {
    const score = scoreOf(book);
    facts.appendChild(fact(score != null ? formatScore(score) : null, 'Score'));
    facts.appendChild(fact(book.status === 'next' ? `Nº ${entry.queuePos}` : null, book.status === 'next' ? 'Warteschlange' : 'Platz'));
  }
  view.appendChild(facts);

  // Stand als Abrisskarte (beim aktuellen Buch oder wenn schon ein Stand da ist)
  if (book.status === 'reading' || (!isDone(book.status) && pct != null)) {
    const t = el('div', 'ticket');
    const body = el('div', 'ticket-body');
    const main = el('div', 'ticket-main');
    main.appendChild(el('small', null, 'Fortschritt'));
    main.appendChild(el('b', null, p.page != null ? `Seite ${p.page}` : (pct != null ? `${Math.round(pct)} %` : 'noch kein Stand')));
    const bar = el('div', 'bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${Math.round(pct || 0)} Prozent`);
    const fill = el('span');
    fill.style.width = `${pct || 0}%`;
    bar.appendChild(fill);
    main.appendChild(bar);
    const last = Progress.lastReadAt(p);
    const days = Progress.estimateDaysLeft(p, pages);
    const line = [last ? `zuletzt ${formatDate(last)}` : '', days ? `noch ca. ${days} ${days === 1 ? 'Tag' : 'Tage'}` : ''].filter(Boolean).join(' · ');
    if (line) main.appendChild(el('span', null, line));
    body.appendChild(main);
    const left = pages && p.page != null ? Math.max(0, pages - p.page) : null;
    body.appendChild(el('div', 'ticket-stub', left != null ? `noch ${left}` : 'Lese ich'));
    t.appendChild(body);
    view.appendChild(t);
  } else if (isDone(book.status)) {
    const done = progressElement(entry);
    if (done) { done.classList.add('detail-added'); view.appendChild(done); }
  }

  // Aktionen
  const actions = el('div', 'p-actions');
  if (book.status === 'reading') actions.appendChild(actionBtn('Fortschritt eintragen', 'progress', 'btn-primary'));
  if (!isDone(book.status)) actions.appendChild(actionBtn('Als gelesen stempeln', 'stamp', book.status === 'reading' ? '' : 'btn-primary'));
  if (book.status === 'next') {
    const last = state.entries.filter((x) => x.status === 'next').length;
    const row = el('div', 'row2');
    const up = actionBtn('Nach oben', 'move', '', { delta: '-1' });
    const down = actionBtn('Nach unten', 'move', '', { delta: '1' });
    up.disabled = entry.queuePos <= 1;
    down.disabled = entry.queuePos >= last;
    row.append(up, down);
    actions.appendChild(row);
  }
  const row = el('div', 'row2');
  row.append(actionBtn('Bearbeiten', 'edit'), actionBtn('Löschen', 'delete', 'btn-danger'));
  actions.appendChild(row);
  view.appendChild(actions);

  // Weitere Angaben: Status, Format, Score, Sterne, Tags, Notizen
  const info = el('div', 'detail-info');
  const badges = el('div', 'book-meta');
  badges.appendChild(el('span', 'badge', STATUSES[book.status] || book.status));
  badges.appendChild(el('span', 'badge badge-format', formatLabel(entry)));
  const score = isRatingAfterReading(book.status) ? null : scoreOf(book);
  if (score != null) badges.appendChild(el('span', 'badge badge-score', 'Score ' + formatScore(score)));
  if (book.rating > 0) badges.appendChild(starsElement(book.rating, isRatingAfterReading(book.status) ? 'Bewertung' : 'Priorität'));
  info.appendChild(badges);
  const tags = List.genresOf(book);
  if (tags.length) {
    const box = el('div', 'tags');
    for (const t of tags) box.appendChild(el('span', 'tag', t));
    info.appendChild(box);
  }
  if (entry.notes) info.appendChild(el('p', 'detail-notes', entry.notes));
  info.appendChild(el('p', 'detail-added', 'Hinzugefügt am ' + new Date(entry.addedAt).toLocaleDateString('de-DE')));
  view.appendChild(info);
  return true;
}

/* ---------- Album: Mappen (Zuordnung in js/stats.js) ---------- */

/** Bücher in der Form, die js/stats.js erwartet. */
function statBooks() {
  return allBooks().map((b) => ({
    id: b.id,
    title: b.title,
    pages: totalPagesOf(b.entry),
    status: b.status,
    progress: b.entry.progress,
    genres: List.genresOf(b),
  }));
}

// Mappenfarben: Hintergrund und Schrift darauf
const FOLDER_INK = {
  accent: ['var(--accent)', 'var(--accent-ink)'],
  himmel: ['var(--himmel)', '#1C1A16'],
  senf: ['var(--senf)', '#1C1A16'],
  rose: ['var(--rose)', '#1C1A16'],
};

function markenText(n) {
  return n === 1 ? '1 Marke' : `${n} Marken`;
}

function renderAlbum() {
  const books = allBooks();
  const byId = new Map(books.map((b) => [b.id, b]));
  const list = Stats.folders(statBooks());

  // Bogen im Hintergrund: die sechs Motive, nur Schmuck
  const bg = $('albumBg');
  if (!bg.childElementCount) bg.innerHTML = Porto.motifs.map((m) => `<span class="stamp">${Porto.motif(m)}</span>`).join('');

  $('albumHint').textContent = list.length ? `${list.length} ${list.length === 1 ? 'Mappe' : 'Mappen'} · ${markenText(books.length)}` : '';
  $('albumEmpty').hidden = list.length > 0;
  const box = $('folders');
  box.innerHTML = '';
  for (const f of list) {
    const fig = el('figure');
    const btn = el('button', 'folder');
    btn.type = 'button';
    btn.dataset.folder = f.key;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `Mappe ${f.title}, ${markenText(f.ids.length)}. Antippen öffnet, nochmal Antippen zeigt sie im Regal.`);
    // Tannengrün ist die Grundfarbe der Mappe, die anderen Farben setzen --tanne um
    const colors = FOLDER_INK[f.color];
    if (colors) {
      btn.style.setProperty('--tanne', colors[0]);
      btn.style.setProperty('--tanne-ink', colors[1]);
    }
    btn.appendChild(el('span', 'folder-back'));
    for (const id of f.ids.slice(0, 3)) {
      const item = el('span', 'folder-item');
      item.appendChild(coverStamp(byId.get(id), { scope: 'album', plain: true }));
      btn.appendChild(item);
    }
    const front = el('span', 'folder-front');
    front.appendChild(el('b', null, f.title));
    const kind = f.kind === 'year' ? 'Lesejahr' : f.kind === 'genre' ? 'Tag/Genre' : 'Noch zu lesen';
    const sub = el('span');
    sub.append(kind, el('br'), markenText(f.ids.length));
    front.appendChild(sub);
    btn.appendChild(front);
    fig.appendChild(btn);
    box.appendChild(fig);
  }
  albumFolders = list;
}
let albumFolders = [];

/** Mappe im Regal zeigen: alle Ansichten, nur die Bücher der Mappe. */
function showFolderInRegal(folder) {
  activeFolder = { key: folder.key, title: folder.title, ids: folder.ids.slice() };
  activeView = 'all';
  activeFilter = 'all';
  render();
  go('#regal');
}

/* ---------- Statistik ---------- */


function sparkPath(values) {
  // Linie über das ganze Jahr: x je Monat, y nach Seiten je Tag (oben = viel)
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [Math.round((i / 11) * 300 * 10) / 10, Math.round((58 - (v / max) * 50) * 10) / 10]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
  }
  return { d, avgY: 58 - ((values.reduce((a, b) => a + b, 0) / values.length) / max) * 50 };
}

function statTicket(label, value, line, stub) {
  const t = el('div', 'ticket');
  const body = el('div', 'ticket-body');
  const main = el('div', 'ticket-main');
  main.appendChild(el('small', null, label));
  main.appendChild(el('b', null, value));
  if (line) main.appendChild(el('span', null, line));
  body.appendChild(main);
  body.appendChild(el('div', 'ticket-stub', stub));
  t.appendChild(body);
  return t;
}

function shortDate(day) {
  return new Date(day + 'T00:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
}

let statBarsData = [];
function renderStats() {
  const today = Progress.today();
  const year = Number(today.slice(0, 4));
  const books = statBooks();
  const byDay = Stats.pagesByDay(books);
  const p = Stats.period(byDay, statPeriod, today);

  // Umschalter
  const seg = $('periodSeg');
  const keys = [...seg.querySelectorAll('button')].map((b) => b.dataset.period);
  seg.style.setProperty('--i', keys.indexOf(statPeriod));
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === statPeriod)));
  const month = Stats.MONTHS_LONG[Number(today.slice(5, 7)) - 1];
  $('periodLabel').textContent = `gelesene Seiten · ${statPeriod === 'week' ? 'diese Woche' : statPeriod === 'month' ? month : year}`;
  const total = $('pagesTotal');
  if (total.dataset.ready) Porto.countTo(total, p.total, 600);
  else total.textContent = p.total.toLocaleString('de-DE');
  total.dataset.ready = '1';

  // Striche: neu anlegen, dann wachsen lassen
  const max = Math.max(1, ...p.bars.map((b) => b.value));
  const bars = $('bars');
  bars.innerHTML = '';
  bars.setAttribute('aria-label', `Gelesene Seiten je ${statPeriod === 'year' ? 'Monat' : 'Tag'}, zusammen ${p.total}`);
  statBarsData = p.bars;
  const nowKey = statPeriod === 'year' ? today.slice(0, 7) : today;
  // Hinweis zeigt den letzten Strich mit Seiten bis heute, sonst heute
  const todayIdx = p.bars.findIndex((b) => b.key === nowKey);
  let current = todayIdx < 0 ? p.bars.length - 1 : todayIdx;
  for (let i = current; i >= 0; i--) if (p.bars[i].value) { current = i; break; }
  p.bars.forEach((b, i) => {
    const node = el('i');
    node.dataset.k = i;
    node.style.setProperty('--v', 0);
    if (i === current) node.classList.add('on');
    bars.appendChild(node);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bars.querySelectorAll('i').forEach((node, i) => {
      const v = p.bars[i].value;
      node.style.setProperty('--v', v ? Math.max(4, Math.round((v / max) * 100)) : 2);
    });
  }));
  showBarTip(current);
  $('barAxis').replaceChildren(...p.axis.map((a) => el('span', null, a)));

  // Lesetempo übers Jahr
  const t = Stats.tempo(byDay, today);
  const spark = $('spark');
  $('tempoHint').textContent = `Lesetempo ${year}, Seiten je Tag`;
  if (t.some((v) => v > 0) && t.length >= 2) {
    const s = sparkPath(t);
    spark.innerHTML = `<path d="${s.d}" style="--len:4000"/><path class="a" d="M0 ${s.avgY.toFixed(1)} H300" style="stroke-dasharray:3 5;animation:none"/>`;
    Porto.replay(spark, 'm-draw');
  } else {
    spark.innerHTML = '';
  }

  // Kennzahlen als Abrisskarten
  const tickets = $('statTickets');
  tickets.innerHTML = '';
  const streak = Stats.longestStreak(byDay);
  tickets.appendChild(statTicket('Längste Serie',
    streak.days ? (streak.days === 1 ? '1 Tag' : `${streak.days} Tage`) : 'noch keine',
    streak.days > 1 ? `${shortDate(streak.start)} bis ${shortDate(streak.end)}` : streak.days ? shortDate(streak.end) : 'Trag deinen Fortschritt ein, dann zählt die Serie.',
    'Rekord'));
  const thick = Stats.thickest(books, year);
  tickets.appendChild(statTicket('Dickstes Buch',
    thick ? thick.title : 'noch keins',
    thick ? `${thick.pages.toLocaleString('de-DE')} Seiten` : `Noch kein Buch mit Seitenzahl in ${year} gelesen.`,
    String(year)));
  const read = Stats.readIn(books, year);
  const pagesRead = Object.entries(byDay).filter(([d]) => d.startsWith(String(year))).reduce((sum, [, n]) => sum + n, 0);
  tickets.appendChild(statTicket('Gelesen',
    read.length === 1 ? '1 Buch' : `${read.length} Bücher`,
    `${pagesRead.toLocaleString('de-DE')} Seiten im Jahr`,
    String(year)));
}

function showBarTip(i) {
  const b = statBarsData[i];
  if (!b) return;
  $('bars').querySelectorAll('i').forEach((n, k) => n.classList.toggle('on', k === i));
  $('barTip').textContent = `${b.label} · ${b.value.toLocaleString('de-DE')} S.`;
}

/* ---------- Ansichten und Adressen (#regal, #buch/<id>) ---------- */

let currentRoute = { view: 'regal', id: null };
let navigatedInApp = false;   // true, sobald innerhalb der App navigiert wurde (dann führt "Zurück" per history.back())

function parseRoute() {
  const m = location.hash.match(/^#buch\/(.+)$/);
  if (m) return { view: 'detail', id: decodeURIComponent(m[1]) };
  if (location.hash === '#album') return { view: 'album', id: null };
  if (location.hash === '#zahlen') return { view: 'zahlen', id: null };
  return { view: 'regal', id: null };
}

function go(hash) {
  navigatedInApp = true;
  if (location.hash === hash) showRoute();
  else location.hash = hash;
}

function goBack() {
  if (navigatedInApp && history.length > 1) history.back();
  else location.hash = '#regal';
}

/** Zeigt die Ansicht zur aktuellen Adresse. */
function showRoute() {
  const route = parseRoute();
  const changed = route.view !== currentRoute.view || route.id !== currentRoute.id;
  currentRoute = route;
  if (route.view === 'detail' && !renderDetail(route.id)) {
    // Buch gibt es nicht (mehr): zurück ins Regal
    history.replaceState(null, '', '#regal');
    currentRoute = { view: 'regal', id: null };
  }
  if (route.view === 'album' && changed) renderAlbum();
  if (route.view === 'zahlen' && changed) renderStats();
  const views = { regal: $('viewRegal'), detail: $('viewDetail'), album: $('viewAlbum'), zahlen: $('viewStats') };
  for (const [key, node] of Object.entries(views)) {
    const show = key === currentRoute.view;
    if (show && changed) Porto.replay(node, 'enter');
    node.hidden = !show;
  }
  // Detailseite hat ihren eigenen Kopf (zurück, Status, Bearbeiten)
  document.querySelector('.app-head').hidden = currentRoute.view === 'detail';
  $('searchBtn').hidden = currentRoute.view !== 'regal';
  // In der Leiste trägt nur der aktive Bereich seine Beschriftung (Porto .pillbar)
  const area = currentRoute.view === 'detail' ? 'regal' : currentRoute.view;
  document.querySelectorAll('#pillbar [data-go]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.go === area));
    b.querySelector('.lbl').classList.toggle('vh', b.dataset.go !== area);
  });
  if (changed) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', showRoute);

/** Zeichnet alle Ansichten neu. Wird nach jeder Änderung aufgerufen.
 *  Die Detailseite zuerst, damit ihr Stempel nach "Als gelesen stempeln" aufschlägt. */
function render() {
  if (currentRoute.view === 'detail' && !renderDetail(currentRoute.id)) {
    showRoute();
  }
  renderRegal();
  if (currentRoute.view === 'album') renderAlbum();
  if (currentRoute.view === 'zahlen') renderStats();
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

/* ---------- Status als Chips (das versteckte select #fStatus bleibt die Quelle) ---------- */

const STATUS_CHIP_LABELS = { backlog: 'Wunschliste' }; // kurze Beschriftung, passt auf das Handy
const statusChips = $('statusChips');
for (const [key, label] of Object.entries(STATUSES)) {
  const btn = el('button', 'chip', STATUS_CHIP_LABELS[key] || label);
  btn.type = 'button';
  btn.dataset.status = key;
  statusChips.appendChild(btn);
}
statusChips.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || els.status.value === btn.dataset.status) return;
  els.status.value = btn.dataset.status;
  els.status.dispatchEvent(new Event('change'));
});

function paintStatusChips() {
  statusChips.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.status === els.status.value));
  });
}

/** Datumsfelder nur, wenn sie zum Status passen (oder schon etwas eingetragen ist). */
function paintDates() {
  const status = els.status.value;
  const showStart = ['reading', 'read', 'dropped'].includes(status) || Boolean(els.startDate.value);
  const showEnd = ['read', 'dropped'].includes(status) || Boolean(els.endDate.value);
  $('startDateField').hidden = !showStart;
  $('endDateField').hidden = !showEnd;
  $('datesRow').hidden = !showStart && !showEnd;
}

/* ---------- Oberstes Feld: ISBN oder Titel ---------- */

/** Sieht der Text wie eine ISBN aus (nur Ziffern, X, Bindestriche, Leerzeichen)? Leer zählt als ISBN. */
function looksLikeIsbn(text) {
  return /^[\d\s\-xX]*$/.test(text.trim());
}

/** Ein Titel im oberen Feld wandert ins Titelfeld, solange das leer ist. Gibt den Text zurück. */
function takeTitleFromSearch() {
  const text = els.isbn.value.trim();
  if (!text || looksLikeIsbn(text)) return '';
  if (!els.title.value.trim()) {
    els.title.value = text;
    els.isbn.value = '';
    els.isbnHint.textContent = '';
  }
  return text;
}

/** Öffnet einen Abschnitt im Formular samt "Mehr Angaben" drumherum. */
function openSection(id) {
  $(id).open = true;
  $('secMore').open = true;
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
  els.startDate.value = entry && entry.progress.startDate ? entry.progress.startDate : '';
  els.endDate.value = entry && entry.progress.endDate ? entry.progress.endDate : '';
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
  // "Mehr Angaben" offen, wenn darin beim Bearbeiten etwas ausgefüllt ist
  $('secMore').open = Boolean(entry && (entry.notes || entry.tags.length)) ||
    ['secCriteria', 'secWork', 'secPrint', 'secEbook', 'secSpecial'].some((id) => $(id).open);

  formRating = book ? book.rating : 0;
  formProvenance = {};
  pendingCover = null;
  enrichedInDialog = false;
  els.formNote.textContent = '';
  els.coverHint.textContent = '';
  paintCover(entry ? coverIdOf(entry) : null);
  paintProvenance(entry, work, primary);
  els.error.textContent = '';
  paintStars();
  paintRatingLabel();
  paintScorePreview();
  paintOwnership();
  paintStatusChips();
  paintDates();
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
  if (takeTitleFromSearch() && els.isbn.value.trim()) {
    // Oben steht ein Text, der keine ISBN ist, und der Titel ist schon ausgefüllt
    els.error.textContent = 'Oben steht keine gültige ISBN. Zum Suchen nach Titel „Suchen“ tippen, sonst das Feld leeren.';
    els.isbn.focus();
    return;
  }
  const data = readForm();

  if (!data.isbn.valid) {
    els.error.textContent = data.isbn.error;
    els.isbn.focus();
    return;
  }
  if (data.ownership === 'both' && !data.ebookIsbn.valid) {
    els.error.textContent = 'E-Book: ' + data.ebookIsbn.error;
    openSection('secEbook');
    $('e-isbn').focus();
    return;
  }
  // Nur eine ISBN eingetragen: erst die fehlenden Angaben suchen
  const hasIsbn = Boolean(data.isbn.isbn13 || data.isbn.isbn10);
  if (!data.title && hasIsbn && !enrichedInDialog) {
    startEnrichment();
    return;
  }
  if (!data.title) {
    els.error.textContent = hasIsbn
      ? 'Bitte einen Titel eintragen (die Suche hat keinen übernommen).'
      : 'Bitte einen Titel oder eine ISBN eintragen.';
    els.title.focus();
    return;
  }
  // Optional: bei einer neuen ISBN vor dem Speichern automatisch suchen
  // (offline nicht: dann wird einfach gespeichert, gesucht werden kann später)
  if (state.settings.autoEnrichOnIsbn && hasIsbn && !enrichedInDialog && isNewIsbn(data.isbn) && !isOffline()) {
    startEnrichment();
    return;
  }

  if (editingId) updateBook(editingId, data);
  else addBook(data);

  closeDialog();
  render();
}

/** Liste "Herkunft der Angaben": je Feld manuell oder Quelle mit Abrufdatum. */
function paintProvenance(entry, work, edition) {
  const list = $('provenanceList');
  list.innerHTML = '';
  const labels = Object.assign({}, Enrich.WORK_FIELDS, Enrich.EDITION_FIELDS, {
    coverId: 'Cover', status: 'Status', notes: 'Notizen', ownership: 'Besitzformat', tags: 'Tags',
    special: 'Besondere Ausgabe', binding: 'Einband', ebookFormat: 'Dateiformat', ebookPlatform: 'Plattform',
    currentFormat: 'Lese gerade als',
  });
  const rows = [];
  for (const [entity, prefix] of [[work, 'Werk'], [edition, 'Ausgabe']]) {
    if (!entity || !entity.sources) continue;
    for (const [field, info] of Object.entries(entity.sources)) {
      const label = (field === 'year' ? `${labels.year} (${prefix})` : labels[field] || field);
      const who = info.source === 'manual' ? 'manuell' : (Sources.LABELS[info.source] || info.source);
      const when = info.at ? new Date(info.at).toLocaleDateString('de-DE') : '';
      rows.push(`${label}: ${who}${when ? `, ${when}` : ''}`);
    }
  }
  for (const r of rows.sort((a, b) => a.localeCompare(b, 'de'))) list.appendChild(el('li', null, r));
  $('secSources').hidden = !rows.length;
  $('secSources').open = false;
}

/** Ist die ISBN im Formular neu (neues Buch oder geänderte ISBN)? */
function isNewIsbn(parsed) {
  if (!editingId) return true;
  const entry = state.entries.find((e) => e.id === editingId);
  const ed = entry && editionFor(entry, primaryFormat(entry.ownership));
  return !ed || (ed.isbn13 || '') !== (parsed.isbn13 || '') || (ed.isbn10 || '') !== (parsed.isbn10 || '');
}

/* ====================================================================
   Cover im Formular
   ==================================================================== */

/** Zeigt das Cover im Formular: neues (noch nicht gespeichertes) oder gespeichertes. */
function paintCover(coverId) {
  els.coverPreview.hidden = true;
  els.coverRemoveBtn.hidden = true;
  if (pendingCover && pendingCover !== 'remove') {
    els.coverPreview.src = URL.createObjectURL(pendingCover.blob);
    els.coverPreview.hidden = false;
    els.coverRemoveBtn.hidden = false;
    return;
  }
  if (pendingCover === 'remove' || !coverId) return;
  Covers.url(coverId).then((u) => {
    if (!u) return;
    els.coverPreview.src = u;
    els.coverPreview.hidden = false;
    els.coverRemoveBtn.hidden = false;
  });
}

/** Cover-ID des Buchs im offenen Formular (gespeicherter Stand). */
function editingCoverId() {
  const entry = editingId && state.entries.find((e) => e.id === editingId);
  return entry ? coverIdOf(entry) : null;
}

els.coverFile.addEventListener('change', async () => {
  const file = els.coverFile.files[0];
  els.coverFile.value = '';
  if (!file) return;
  try {
    pendingCover = { blob: await Covers.shrink(file), source: 'manual', at: new Date().toISOString() };
    els.coverHint.textContent = 'Neues Cover wird beim Speichern übernommen.';
  } catch (err) {
    els.coverHint.textContent = 'Das Bild konnte nicht gelesen werden.';
  }
  paintCover(editingCoverId());
});

els.coverRemoveBtn.addEventListener('click', () => {
  pendingCover = editingCoverId() ? 'remove' : null;
  els.coverHint.textContent = pendingCover ? 'Cover wird beim Speichern entfernt.' : '';
  paintCover(editingCoverId());
});

/* ====================================================================
   Metadaten-Anreicherung (Vorschläge aus DNB, Google Books, Open Library)
   ==================================================================== */

/** Zwischenspeicher der Suchergebnisse im localStorage (älteste fliegen zuerst raus). */
const lookupCache = {
  key: 'buecher-tracker.cache',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch (err) { return {}; }
  },
  get(k) { return this.read()[k]; },
  set(k, v) {
    const data = this.read();
    data[k] = v;
    const keys = Object.keys(data);
    if (keys.length > 150) {
      keys.sort((a, b) => data[a].at - data[b].at).slice(0, keys.length - 150).forEach((x) => delete data[x]);
    }
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (err) {
      // Speicher voll: Zwischenspeicher opfern, nie die Bücher
      try { localStorage.removeItem(this.key); } catch (e) { /* egal */ }
    }
  },
  clear() {
    try { localStorage.removeItem(this.key); } catch (err) { /* egal */ }
  },
};

/** Präfix der Formularfelder der Hauptausgabe ('p' = Print, 'e' = E-Book). */
function primaryPrefix() {
  return primaryFormat(els.ownership.value) === 'ebook' ? 'e' : 'p';
}

/** Aktuelle Formularwerte als { work, edition } für den Vergleich mit Vorschlägen. */
function formCurrent() {
  const prefix = primaryPrefix();
  const edition = readFields(prefix, prefix === 'e' ? EBOOK_FIELDS : PRINT_FIELDS);
  const isbn = Isbn.parse(els.isbn.value);
  edition.isbn13 = isbn.valid ? isbn.isbn13 : '';
  edition.isbn10 = isbn.valid ? isbn.isbn10 : '';
  return {
    work: Object.assign({
      title: els.title.value.trim(),
      authors: els.author.value.split(';').map((a) => a.trim()).filter(Boolean),
    }, readFields('w', WORK_FIELDS)),
    edition,
  };
}

/** Schreibt einen übernommenen Wert ins Formular. Gibt den Abschnitt zurück, der ihn enthält. */
function setFormValue(scope, field, value) {
  const list = (v, sep) => (Array.isArray(v) ? v.join(sep) : v == null ? '' : String(v));
  if (scope === 'work') {
    if (field === 'title') { els.title.value = value; return null; }
    if (field === 'authors') { els.author.value = list(value, '; '); return null; }
    const spec = WORK_FIELDS.find((f) => f[0] === field);
    if (!spec) return null;
    $(`w-${field}`).value = list(value, spec[3] === ';' ? '; ' : ', ');
    return 'secWork';
  }
  if (field === 'isbn13' || field === 'isbn10') {
    // Die ISBN-13 hat Vorrang; die ISBN-10 nur, wenn noch gar keine ISBN eingetragen ist
    if (field === 'isbn13' || !els.isbn.value.trim()) els.isbn.value = value;
    showIsbnHint(els.isbn, els.isbnHint);
    return null;
  }
  const prefix = primaryPrefix();
  const specs = prefix === 'e' ? EBOOK_FIELDS : PRINT_FIELDS;
  const spec = specs.find((f) => f[0] === field);
  if (!spec) return null; // z. B. Einband bei E-Books
  $(`${prefix}-${field}`).value = list(value, spec[3] === ';' ? '; ' : ', ');
  return prefix === 'e' ? 'secEbook' : 'secPrint';
}

/** Startet die Suche mit den Angaben aus dem Formular und öffnet den Vorschlags-Dialog. */
async function startEnrichment() {
  const query = takeTitleFromSearch(); // Titel oben: danach suchen
  const cur = formCurrent();
  if (query) cur.work.title = query;
  const isbn = Isbn.parse(query ? '' : els.isbn.value);
  if (!isbn.valid) {
    els.error.textContent = isbn.error;
    els.isbn.focus();
    return;
  }
  const special = readFields('s', SPECIAL_FIELDS);
  const input = {
    isbn: isbn.isbn13 || isbn.isbn10,
    title: cur.work.title,
    author: cur.work.authors[0] || '',
    publisher: cur.edition.publisher,
    year: cur.edition.year,
    binding: cur.edition.binding,
    language: cur.edition.language,
    printing: cur.edition.printing,
    publisherSeries: special.publisherSeries,
    notes: special.notes,
    kinds: special.kinds,
  };
  if (!input.isbn && !input.title && !input.author) {
    els.error.textContent = 'Für die Suche bitte oben eine ISBN oder einen Titel eintragen.';
    els.isbn.focus();
    return;
  }
  const sources = Object.keys(Sources.LABELS).filter((s) => state.settings.sources[s] !== false);
  if (!sources.length) {
    els.error.textContent = 'Alle Quellen sind in den Einstellungen ausgeschaltet.';
    return;
  }
  els.error.textContent = '';
  enrichedInDialog = true;
  const run = ++enrichRun;

  els.enrichStatus.textContent = `Suche ${input.isbn ? 'nach ISBN' : 'nach Titel/Autor:in'} bei ${sources.map((s) => Sources.LABELS[s]).join(', ')} …`;
  els.enrichErrors.innerHTML = '';
  els.enrichSpecial.hidden = true;
  els.editionList.innerHTML = '';
  els.fieldView.hidden = true;
  els.enrichAllBtn.hidden = true;
  els.enrichApplyBtn.hidden = true;
  els.enrichDialog.showModal();

  let result;
  const offline = isOffline();
  try {
    result = await Enrich.lookup(input, {
      // Offline gar nicht erst versuchen (sonst wartet jede Quelle auf die Zeitüberschreitung);
      // bereits gesuchte Bücher kommen trotzdem aus dem Zwischenspeicher
      fetch: (url, opts) => (isOffline() ? Promise.reject(new TypeError('offline')) : window.fetch(url, opts)),
      cache: lookupCache,
      sources,
      apiKey: state.settings.googleApiKey,
    });
  } catch (err) {
    console.error('Suche fehlgeschlagen:', err);
    result = { editions: [], errors: [{ source: '', message: 'Die Suche ist fehlgeschlagen.' }], special: { special: false } };
  }
  if (run !== enrichRun || !els.enrichDialog.open) return; // inzwischen abgebrochen
  enrichResult = result;

  if (offline && result.errors.length) {
    els.enrichErrors.appendChild(el('li', null, 'Du bist offline. Die Suche braucht eine Internetverbindung; ' +
      'nur früher gesuchte Bücher können aus dem Zwischenspeicher kommen.'));
  } else {
    for (const e of result.errors) els.enrichErrors.appendChild(el('li', null, e.message));
  }
  if (result.special.special) {
    els.enrichSpecial.hidden = false;
    els.enrichSpecial.textContent = 'Das sieht nach einer besonderen oder älteren Ausgabe aus (' +
      result.special.reasons.join(', ') + '). Es wurde zusätzlich gezielt nach Ausgabe-Details gesucht; ' +
      'die Vorschläge sind weniger sicher und sollten mit dem Buch verglichen werden.';
  }
  if (!result.editions.length) {
    els.enrichStatus.textContent = offline
      ? 'Offline keine Treffer. Du kannst das Buch trotzdem speichern und später mit Internet erneut suchen.'
      : result.errors.length && result.errors.length >= sources.length
      ? 'Keine Quelle war erreichbar. Du kannst das Buch trotzdem speichern und später erneut suchen.'
      : 'Keine Treffer. Prüfe die Angaben oder versuche es mit Titel und Autor:in.';
    return;
  }
  // Eindeutiger ISBN-Treffer: direkt die Felder zeigen; sonst Auswahlliste
  const top = result.editions[0];
  if (result.editions.length === 1 && top.match.reasons.includes('ISBN')) showEditionFields(0);
  else showEditionList();
}

/** Meldet der Browser, dass keine Internetverbindung besteht? */
function isOffline() {
  return navigator.onLine === false;
}

/** Text einer Ausgabe für Liste und Zusammenfassung. */
function editionLines(ed) {
  const v = (scope, field) => (ed[scope][field] ? ed[scope][field].value : null);
  const authors = v('work', 'authors');
  return {
    title: [v('work', 'title'), v('work', 'subtitle')].filter(Boolean).join(': ') || '(ohne Titel)',
    author: Array.isArray(authors) ? authors.join(', ') : '',
    details: [
      v('edition', 'publisher'), v('edition', 'year'), v('edition', 'binding'),
      v('edition', 'printing'), v('edition', 'pages') && `${v('edition', 'pages')} S.`, v('edition', 'language'),
    ].filter(Boolean).join(' · '),
    isbn: v('edition', 'isbn13') || v('edition', 'isbn10') || 'ohne ISBN',
    sources: ed.sources.map((s) => Sources.LABELS[s] || s).join(', '),
  };
}

/** Lädt ein Quell-Cover einmalig herunter (für Vorschau und Übernahme). */
function coverBlob(url) {
  if (!coverBlobs.has(url)) coverBlobs.set(url, Covers.download(url));
  return coverBlobs.get(url);
}

/** Erstes ladbares Cover einer Ausgabe als { blob, source } (oder null). */
async function firstCover(ed) {
  for (const c of ed.covers) {
    try {
      return { blob: await coverBlob(c.url), source: c.source };
    } catch (err) {
      // nächstes versuchen
    }
  }
  return null;
}

/** Cover-Vorschau in ein <img> laden (ohne Hotlinking: das Bild wird heruntergeladen). */
function loadCoverInto(img, ed) {
  firstCover(ed).then((c) => {
    if (c) { img.src = URL.createObjectURL(c.blob); img.hidden = false; }
  });
}

/** Auswahlliste mehrerer möglicher Ausgaben (beste Passung zuerst). */
function showEditionList() {
  const eds = enrichResult.editions.slice(0, 15);
  els.enrichStatus.textContent = eds.length === 1
    ? 'Ein möglicher Treffer. Bitte prüfen, ob es deine Ausgabe ist.'
    : `${enrichResult.editions.length} mögliche Ausgaben. Wähle die, die du besitzt (beste Übereinstimmung oben).`;
  els.fieldView.hidden = true;
  els.enrichAllBtn.hidden = true;
  els.enrichApplyBtn.hidden = true;
  els.editionList.hidden = false;
  els.editionList.innerHTML = '';
  eds.forEach((ed, i) => {
    const li = el('li');
    const btn = el('button', 'edition-option');
    btn.type = 'button';
    btn.dataset.index = i;
    const img = el('img');
    img.alt = '';
    img.hidden = true;
    const placeholder = el('span', 'no-cover');
    if (ed.covers.length) loadCoverInto(img, ed);
    img.addEventListener('load', () => placeholder.remove());
    const t = editionLines(ed);
    const box = el('span', 'eo-text');
    box.appendChild(el('strong', null, t.title));
    if (t.author) box.appendChild(el('span', null, t.author));
    if (t.details) box.appendChild(el('span', null, t.details));
    box.appendChild(el('span', 'source-note', `ISBN ${t.isbn} · Quelle: ${t.sources}`));
    if (ed.match.reasons.length) box.appendChild(el('span', 'eo-match', 'passt zu deinen Angaben: ' + ed.match.reasons.join(', ')));
    if (ed.uncertain) box.appendChild(el('span', 'badge-uncertain', 'weniger sicher'));
    btn.append(img, placeholder, box);
    li.appendChild(btn);
    els.editionList.appendChild(li);
  });
}

/** Zeigt die Felder einer Ausgabe mit Vergleich und Auswahl. */
function showEditionFields(index) {
  enrichEdition = enrichResult.editions[index];
  enrichRows = Enrich.compare(enrichEdition, formCurrent());
  els.editionList.hidden = true;
  els.fieldView.hidden = false;
  $('backToEditions').hidden = enrichResult.editions.length < 2;
  els.enrichAllBtn.hidden = false;
  els.enrichApplyBtn.hidden = false;

  const t = editionLines(enrichEdition);
  els.editionSummary.innerHTML = '';
  const img = el('img');
  img.alt = '';
  img.hidden = true;
  if (enrichEdition.covers.length) loadCoverInto(img, enrichEdition);
  const box = el('div');
  box.appendChild(el('strong', null, t.title));
  box.appendChild(el('div', null, [t.author, t.details].filter(Boolean).join(' · ')));
  box.appendChild(el('div', 'source-note', `ISBN ${t.isbn} · Quelle: ${t.sources}`));
  if (enrichEdition.uncertain) box.appendChild(el('span', 'badge-uncertain', 'weniger sicher'));
  els.editionSummary.append(img, box);

  const newCount = enrichRows.filter((r) => r.status === 'neu').length;
  els.enrichStatus.textContent = newCount
    ? `${newCount} neue Angabe${newCount === 1 ? '' : 'n'} gefunden.`
    : 'Keine neuen Angaben; unten siehst du Abweichungen zu deinen Werten.';

  els.fieldTable.innerHTML = '';
  enrichRows.forEach((row, i) => els.fieldTable.appendChild(fieldRowElement(row, i)));

  // Cover als eigene Zeile: vorausgewählt, wenn das Buch noch keins hat
  if (enrichEdition.covers.length) {
    const hasCover = Boolean(editingCoverId() || (pendingCover && pendingCover !== 'remove'));
    const wrap = el('label', 'field-row-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = 'enrichCover';
    cb.checked = !hasCover;
    const label = el('span', 'frc-label');
    label.append(el('strong', null, 'Cover'), el('span', `status-tag status-${hasCover ? 'abweichend' : 'neu'}`, hasCover ? 'ersetzt dein Cover' : 'neu'),
      el('span', 'source-note', Sources.LABELS[enrichEdition.covers[0].source]));
    wrap.append(cb, label, el('span'), el('span', 'frc-current', 'wird heruntergeladen und lokal gespeichert'));
    els.fieldTable.appendChild(wrap);
  }
}

/** Eine Zeile der Feldauswahl. */
function fieldRowElement(row, i) {
  const show = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
  const wrap = el('label', 'field-row-check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.dataset.row = i;
  cb.checked = row.selected;
  cb.disabled = row.status === 'identisch';
  const label = el('span', 'frc-label');
  label.append(
    el('strong', null, row.label),
    el('span', `status-tag status-${row.status}`, row.status),
    el('span', 'source-note', Sources.LABELS[row.source] || row.source),
  );
  const value = el('span', 'frc-value' + (row.field === 'description' ? ' long' : ''), show(row.value));
  const details = el('span');
  details.appendChild(value);
  if (row.status === 'abweichend') details.appendChild(el('span', 'frc-current', ' · bisher: ' + show(row.current)));
  if (row.alternatives.length) {
    details.appendChild(el('span', 'frc-current', ' · andere Quellen: ' +
      row.alternatives.map((a) => `${show(a.value).slice(0, 60)} (${Sources.LABELS[a.source] || a.source})`).join('; ')));
  }
  wrap.append(cb, label, el('span'), details);
  cb.addEventListener('change', () => { enrichRows[i].selected = cb.checked; });
  return wrap;
}

/** Übernimmt die ausgewählten Vorschläge ins Formular (gespeichert wird erst mit "Speichern"). */
async function applyEnrichment(all) {
  if (all) enrichRows.forEach((r) => { if (r.status !== 'identisch') r.selected = true; });
  const at = new Date().toISOString();
  const sections = new Set();
  let count = 0;
  for (const row of enrichRows) {
    if (!row.selected) continue;
    const section = setFormValue(row.scope, row.field, row.value);
    if (section) sections.add(section);
    formProvenance[`${row.scope}.${row.field}`] = { source: row.source, at, value: row.value };
    count++;
  }
  // Die ISBN-10 wird aus der ISBN-13 abgeleitet; ihre Herkunft folgt der übernommenen ISBN
  if (formProvenance['edition.isbn13'] && !formProvenance['edition.isbn10']) {
    formProvenance['edition.isbn10'] = Object.assign({}, formProvenance['edition.isbn13'], { value: Isbn.parse(els.isbn.value).isbn10 });
  }
  const coverCb = $('enrichCover');
  const wantCover = coverCb && (coverCb.checked || all);
  const edition = enrichEdition;
  els.enrichDialog.close();
  for (const id of sections) openSection(id);
  els.formNote.textContent = count
    ? `${count} Angabe${count === 1 ? '' : 'n'} übernommen. Bitte prüfen und speichern.`
    : 'Keine Angaben übernommen.';

  if (wantCover) {
    els.coverHint.textContent = 'Cover wird geladen …';
    const c = await firstCover(edition);
    if (c) {
      pendingCover = { blob: c.blob, source: c.source, at };
      els.coverHint.textContent = `Cover von ${Sources.LABELS[c.source]}; wird beim Speichern übernommen.`;
      paintCover(editingCoverId());
    } else {
      els.coverHint.textContent = 'Das Cover konnte nicht geladen werden (Quelle erlaubt kein Herunterladen). ' +
        'Du kannst ein eigenes Bild wählen.';
    }
  }
}

$('enrichBtn').addEventListener('click', startEnrichment);
$('enrichCancelBtn').addEventListener('click', () => { enrichRun++; els.enrichDialog.close(); });
$('backToEditions').addEventListener('click', showEditionList);
els.enrichAllBtn.addEventListener('click', () => applyEnrichment(true));
els.enrichApplyBtn.addEventListener('click', () => applyEnrichment(false));
els.editionList.addEventListener('click', (e) => {
  const btn = e.target.closest('.edition-option');
  if (btn) showEditionFields(Number(btn.dataset.index));
});
els.enrichDialog.addEventListener('close', () => { enrichRun++; });

/* ====================================================================
   Kurze Meldung (Toast)
   ==================================================================== */

function showToast(text, withUndo = false) {
  els.toastText.textContent = text;
  els.toastUndo.hidden = !withUndo;
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
els.status.addEventListener('change', () => {
  paintRatingLabel();
  paintScorePreview();
  // Datum vorbelegen (überschreibbar): Beginn bei "Lese gerade", Ende bei "Gelesen"
  if (els.status.value === 'reading' && !els.startDate.value) els.startDate.value = Progress.today();
  if (els.status.value === 'read' && !els.endDate.value) els.endDate.value = Progress.today();
  paintStatusChips();
  paintDates();
});
els.ownership.addEventListener('change', paintOwnership);
els.isbn.addEventListener('blur', () => {
  if (looksLikeIsbn(els.isbn.value)) showIsbnHint(els.isbn, els.isbnHint);
  else els.isbnHint.textContent = '';
});
// Eingabetaste im oberen Feld sucht, statt das Formular abzuschicken
els.isbn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); startEnrichment(); }
});
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
  staggerList();
});

/** Bücher heben sich nach einem Ansichtswechsel nacheinander an (Porto .m-stagger), danach ist Ruhe. */
let staggerTimer = null;
function staggerList() {
  clearTimeout(staggerTimer);
  Porto.replay(els.list, 'm-stagger');
  staggerTimer = setTimeout(() => els.list.classList.remove('m-stagger'), 1200);
}

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

// Beim Drehen oder Ändern der Fensterbreite zwischen Zeilen und Karten wechseln
/** Führt eine Aktion für ein Buch aus (Regal oder Detailseite). */
function runBookAction(action, id, delta) {
  if (action === 'back') { goBack(); return; }
  const book = allBooks().find((b) => b.id === id);
  if (!book) return;
  if (action === 'open') go(`#buch/${encodeURIComponent(id)}`);
  if (action === 'edit') openDialog(book);
  if (action === 'progress') openProgress(book);
  if (action === 'stamp') stampAsRead(book);
  if (action === 'move') {
    if (List.moveInQueue(state.entries, id, Number(delta))) {
      saveState();
      render();
      // Fokus auf dem Knopf am neuen Platz halten (bequem für mehrfaches Verschieben)
      const btn = $('viewDetail').querySelector(`[data-delta="${delta}"]:not([disabled])`);
      if (btn) btn.focus();
    }
  }
  if (action === 'delete') {
    if (confirm(`„${book.title}" wirklich löschen?`)) deleteBook(id);
  }
}

/** "Als gelesen stempeln": Status Gelesen, 100 %, Enddatum heute; der Stempel schlägt auf. */
function stampAsRead(book) {
  const entry = book.entry;
  entry.status = 'read';
  Model.setSource(entry, 'status', 'manual');
  Progress.markRead(entry.progress, totalPagesOf(entry), Progress.today());
  saveState();
  render();
  showToast(`„${book.title}" gestempelt`);
}

// Regal: Antippen einer Marke oder der Abrisskarte öffnet die Detailseite, Knöpfe führen ihre Aktion aus
els.list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) { runBookAction(btn.dataset.action, btn.dataset.id); return; }
  const target = e.target.closest('[data-open]');
  if (target) runBookAction('open', target.dataset.open);
});

// Detailseite: alle Knöpfe über data-action
$('viewDetail').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn && !btn.disabled) runBookAction(btn.dataset.action, $('viewDetail').dataset.id, btn.dataset.delta);
});

// Leiste unten: Bereiche
$('pillbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(`#${b.dataset.go}`);
});

// Album: erstes Antippen klappt die Mappe auf, das zweite zeigt ihre Bücher im Regal
$('folders').addEventListener('click', (e) => {
  const btn = e.target.closest('.folder');
  if (!btn) return;
  if (btn.classList.contains('open')) {
    const f = albumFolders.find((x) => x.key === btn.dataset.folder);
    if (f) showFolderInRegal(f);
    return;
  }
  $('folders').querySelectorAll('.folder.open').forEach((o) => { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); });
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
});
$('folderClear').addEventListener('click', () => {
  activeFolder = null;
  render();
});

// Statistik: Zeitraum umschalten, Striche berühren zeigt ihren Wert
$('periodSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-period]');
  if (!b || b.dataset.period === statPeriod) return;
  statPeriod = b.dataset.period;
  renderStats();
});
function barAt(e) {
  const node = document.elementFromPoint(e.clientX, e.clientY);
  return node && node.closest && node.closest('#bars i');
}
$('bars').addEventListener('pointerdown', (e) => { const n = barAt(e); if (n) showBarTip(Number(n.dataset.k)); });
$('bars').addEventListener('pointermove', (e) => { const n = barAt(e); if (n) showBarTip(Number(n.dataset.k)); });

/* ---------- Suche und Filter (Lupe im Kopf) ---------- */
function setToolbarOpen(open) {
  $('toolbar').hidden = !open;
  $('searchBtn').setAttribute('aria-expanded', String(open));
}
$('searchBtn').addEventListener('click', () => {
  const open = $('toolbar').hidden;
  // Zuklappen nur, wenn nichts gesucht oder gefiltert wird (sonst wären Bücher "verschwunden")
  if (!open && (searchTerm || filterActiveCount())) { els.search.focus(); return; }
  setToolbarOpen(open);
  if (open) els.search.focus();
});

/* ---------- Filter ein-/ausklappen ---------- */
$('filterToggle').addEventListener('click', () => {
  const toolbar = $('filterToggle').closest('.toolbar');
  const open = toolbar.classList.toggle('filters-open');
  $('filterToggle').setAttribute('aria-expanded', String(open));
});

// Änderungen aus einem anderen Tab übernehmen (gleicher Browser)
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    state = loadState();
    render();
  }
});

/* ====================================================================
   Fortschritt-Dialog
   ==================================================================== */

/** Öffnet den Dialog zum Eintragen des aktuellen Stands. */
function openProgress(book) {
  const { entry, work } = book;
  const p = entry.progress;
  progressId = entry.id;
  const pages = totalPagesOf(entry);
  const format = readingFormat(entry);
  els.progressBook.textContent = work.title + (entry.ownership === 'both' ? ` · liest als ${format === 'ebook' ? 'E-Book' : 'Print'}` : '') +
    (pages ? ` · ${pages} Seiten` : '');
  // Führende Einheit: die zuletzt genutzte; bei E-Books ohne Seitenzahl Prozent
  els.pUnit.value = p.log.length || p.page != null || p.percent != null || p.chapter != null
    ? p.unit : (format === 'ebook' && !pages ? 'percent' : 'page');
  const current = { page: p.page, percent: p.percent, chapter: p.chapter }[els.pUnit.value];
  els.pValue.value = current == null ? '' : current;
  els.pChapterCount.value = p.chapterCount || '';
  els.pDate.value = Progress.today();
  els.progressError.textContent = '';
  els.progressLog.innerHTML = '';
  for (const item of p.log.slice(-10).reverse()) {
    els.progressLog.appendChild(el('li', null, `${formatDate(item.date)}: ${Progress.describe(Object.assign({}, p, item, { unit: p.unit }), pages) || '–'}`));
  }
  paintProgressForm();
  els.progressDialog.showModal();
  els.pValue.focus();
  els.pValue.select();
}

/** Beschriftung und Vorschau im Fortschritt-Dialog. */
function paintProgressForm() {
  const entry = state.entries.find((e) => e.id === progressId);
  if (!entry) return;
  const unit = els.pUnit.value;
  els.pValueLabel.textContent = { page: 'Seite', percent: 'Prozent', chapter: 'Kapitel' }[unit];
  els.pValue.max = unit === 'percent' ? '100' : '';
  els.pChapterCountField.hidden = unit !== 'chapter';
  const d = Progress.derive({ unit, value: els.pValue.value, chapterCount: els.pChapterCount.value }, totalPagesOf(entry));
  els.pPreview.textContent = Progress.describe(Object.assign({ unit, chapterCount: Number(els.pChapterCount.value) || null }, d), totalPagesOf(entry));
}

els.pUnit.addEventListener('change', paintProgressForm);
els.pValue.addEventListener('input', paintProgressForm);
els.pChapterCount.addEventListener('input', paintProgressForm);
$('progressCancelBtn').addEventListener('click', () => els.progressDialog.close());
els.progressDialog.addEventListener('click', (e) => {
  if (e.target === els.progressDialog) els.progressDialog.close();
});

els.progressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const entry = state.entries.find((x) => x.id === progressId);
  if (!entry) return;
  const value = els.pValue.value;
  if (value === '' || !(Number(value) >= 0)) {
    els.progressError.textContent = 'Bitte einen Stand eintragen.';
    els.pValue.focus();
    return;
  }
  Progress.record(entry.progress, {
    unit: els.pUnit.value,
    value: Number(value),
    chapterCount: els.pChapterCount.value ? Number(els.pChapterCount.value) : null,
    date: els.pDate.value || Progress.today(),
  }, totalPagesOf(entry));
  saveState();
  els.progressDialog.close();
  render();
});

// "Fertig gelesen": Status Gelesen, 100 %, Enddatum = gewähltes Datum
$('progressDoneBtn').addEventListener('click', () => {
  const entry = state.entries.find((x) => x.id === progressId);
  if (!entry) return;
  entry.status = 'read';
  Model.setSource(entry, 'status', 'manual');
  Progress.markRead(entry.progress, totalPagesOf(entry), els.pDate.value || Progress.today());
  saveState();
  els.progressDialog.close();
  render();
  showToast(`„${Model.resolve(state, entry).work.title}" ist jetzt im Archiv`);
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

/* ---------- Design-Schalter (System / Hell / Dunkel), Logik in js/theme.js ---------- */
let themeMode = Theme.load(localStorage);

function updateThemeButton() {
  const nextMode = Theme.next(themeMode);
  $('themeLabel').textContent = Theme.LABELS[themeMode];
  $('themeBtn').title = `Design: ${Theme.LABELS[themeMode]}. Tippen wechselt zu ${Theme.LABELS[nextMode]}.`;
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
}

$('themeBtn').addEventListener('click', () => {
  themeMode = Theme.save(localStorage, Theme.next(themeMode));
  Theme.apply(document, themeMode);
  updateThemeButton();
});
// Wahl aus einem anderen Tab übernehmen
window.addEventListener('storage', (e) => {
  if (e.key !== Theme.STORAGE_KEY) return;
  themeMode = Theme.normalize(e.newValue);
  Theme.apply(document, themeMode);
  updateThemeButton();
});
updateThemeButton();

$('settingsBtn').addEventListener('click', () => {
  fillWeights(state.settings.weights);
  $('sourceChecks').querySelectorAll('input').forEach((cb) => { cb.checked = state.settings.sources[cb.value] !== false; });
  $('googleKey').value = state.settings.googleApiKey || '';
  $('autoEnrich').checked = Boolean(state.settings.autoEnrichOnIsbn);
  showAppVersion();
  showBackupStatus();
  els.settingsDialog.showModal();
});
$('clearCacheBtn').addEventListener('click', () => {
  lookupCache.clear();
  showToast('Zwischenspeicher der Suche geleert');
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
  $('sourceChecks').querySelectorAll('input').forEach((cb) => { state.settings.sources[cb.value] = cb.checked; });
  state.settings.googleApiKey = $('googleKey').value.trim();
  state.settings.autoEnrichOnIsbn = $('autoEnrich').checked;
  saveState();
  els.settingsDialog.close();
  render();
});

/* ====================================================================
   Import und Export
   ==================================================================== */

/** Bietet einen Text als Datei zum Speichern an. */
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const fileDate = () => Progress.today();

$('exportJsonBtn').addEventListener('click', async () => {
  let covers = {};
  try {
    const blobs = await Covers.all();
    for (const [id, blob] of Object.entries(blobs)) covers[id] = await blobToDataUrl(blob);
  } catch (err) {
    console.error('Cover konnten nicht exportiert werden:', err);
    covers = {};
  }
  const data = Transfer.exportJson(state, covers);
  download(`buecher-${fileDate()}.json`, JSON.stringify(data, null, 1), 'application/json');
  try { localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString()); } catch (err) { /* egal */ }
  showBackupStatus();
});

$('exportCsvBtn').addEventListener('click', () => {
  download(`buecher-${fileDate()}.csv`, Transfer.exportCsv(state), 'text/csv;charset=utf-8');
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { state: imported, covers } = Transfer.parseImport(await file.text());
    const result = Transfer.mergeStates(state, imported);
    if (!confirm(`${result.added} Bücher hinzufügen?` +
      (result.skipped ? ` (${result.skipped} sind schon vorhanden und bleiben unverändert.)` : ''))) return;
    for (const [id, url] of Object.entries(covers)) {
      try {
        if (!(await Covers.get(id))) await Covers.put(id, await (await fetch(url)).blob());
      } catch (err) {
        console.error('Cover konnte nicht importiert werden:', err);
      }
    }
    state = result.state;
    saveState();
    els.settingsDialog.close();
    render();
    showToast(`${result.added} Bücher importiert`);
  } catch (err) {
    alert(err.message || 'Die Datei konnte nicht importiert werden.');
  }
});

/**
 * Backup wiederherstellen: ersetzt alle Bücher durch die aus der Datei.
 * Vorher wird der bisherige Stand unverändert unter BEFORE_RESTORE_KEY abgelegt.
 */
$('restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { state: imported, covers } = Transfer.parseImport(await file.text());
    const books = (n) => (n === 1 ? '1 Buch' : `${n} Bücher`);
    const now = loadFailed ? 'die nicht lesbaren Daten' : `den Bestand (${books(state.entries.length)})`;
    if (!confirm(`Backup wiederherstellen?\n\nDas ersetzt ${now} auf diesem Gerät durch ` +
      `${books(imported.entries.length)} aus der Datei.`)) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(BEFORE_RESTORE_KEY, raw);
    } catch (err) {
      if (!confirm('Der bisherige Stand konnte nicht als Sicherheitskopie abgelegt werden (Speicher voll?). Trotzdem ersetzen?')) return;
    }
    for (const [id, url] of Object.entries(covers)) {
      try {
        await Covers.put(id, await (await fetch(url)).blob());
      } catch (err) {
        console.error('Cover konnte nicht importiert werden:', err);
      }
    }
    state = Transfer.replaceState(state, imported);
    loadFailed = false; // bewusst ersetzt; die alten Rohdaten liegen in der Sicherheitskopie
    saveState();
    els.settingsDialog.close();
    render();
    showToast(`Backup wiederhergestellt: ${state.entries.length} Bücher`);
  } catch (err) {
    alert(err.message || 'Die Datei konnte nicht gelesen werden.');
  }
});

/** Datum des letzten Exports und ob der Speicher dauerhaft ist. */
async function showBackupStatus() {
  let last = null;
  try { last = localStorage.getItem(LAST_EXPORT_KEY); } catch (err) { /* egal */ }
  const parts = [last ? `Letzter Export auf diesem Gerät: ${new Date(last).toLocaleDateString('de-DE')}.`
    : 'Von diesem Gerät wurde noch nicht exportiert.'];
  try {
    if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) {
      parts.push('Der Browser hat zugesagt, die Daten nicht von sich aus zu löschen.');
    }
  } catch (err) { /* egal */ }
  $('backupStatus').textContent = parts.join(' ');
}

// Den Browser bitten, die Daten nicht bei Speichermangel zu räumen (wird evtl. abgelehnt)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ====================================================================
   Offline-App (Service Worker, siehe sw.js)
   Nur über http(s), z. B. GitHub Pages; beim Öffnen per Doppelklick (file://) gibt es keinen.
   ==================================================================== */

const canUseServiceWorker = 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);
let updateRequested = false; // erst nach Klick auf "Neu laden" neu laden (nicht beim ersten Besuch)

/** Zeigt "Neue Version verfügbar", sobald eine neue Version fertig geladen ist und wartet. */
function watchForUpdate(reg) {
  const offer = (worker) => {
    $('updateToast').hidden = false;
    $('updateBtn').onclick = () => {
      updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  };
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker.addEventListener('statechange', () => {
      // Beim allerersten Besuch gibt es noch keinen controller: dann nichts anbieten
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
}

if (canUseServiceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Neue Version ist aktiv: einmal neu laden, damit alle Dateien aus ihr kommen
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    watchForUpdate(reg);
    // Beim Zurückkehren in die App nach Updates sehen (iOS hält Home-Bildschirm-Apps lange offen)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.error('Service Worker nicht registriert:', err));
}

/** Versionszeile in den Einstellungen. */
function showAppVersion() {
  const el = $('appVersion');
  const ctrl = canUseServiceWorker && navigator.serviceWorker.controller;
  if (!ctrl) {
    el.textContent = 'Offline-Modus nicht aktiv (nur über die Web-Adresse, nicht per Doppelklick).';
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = (e) => { el.textContent = `App-Version ${e.data.version} · startet auch offline`; };
  ctrl.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
}

// Los geht's
render();
showRoute();
