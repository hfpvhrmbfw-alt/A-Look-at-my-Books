/* ====================================================================
   3. LOGIK
   ==================================================================== */
'use strict';

// Datenmodell, Status und Migration stehen in js/model.js, die ISBN-Logik in js/isbn.js.
const STORAGE_KEY = Model.KEYS.v2;
const STATUSES = Model.STATUSES;

/* ---------- Zustand der App ---------- */
let loadFailed = false;      // true, wenn gespeicherte Daten unlesbar waren
let state = loadState();     // { works, editions, entries, settings }, siehe model.js
let activeFilter = 'all';    // 'all' oder ein Status-Schlüssel
let searchTerm = '';
let editingId = null;        // ID des Buchs im Bearbeiten-Dialog (null = neues Buch)
let formRating = 0;          // Sterne im Formular (0 = keine): Priorität bzw. Bewertung nach dem Lesen
let lastDeleted = null;      // für "Rückgängig" nach dem Löschen
let toastTimer = null;

/* ---------- Elemente aus dem HTML ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  list: $('bookList'),
  empty: $('emptyState'),
  search: $('search'),
  filters: $('filters'),
  total: $('totalCount'),
  dialog: $('bookDialog'),
  form: $('bookForm'),
  dialogTitle: $('dialogTitle'),
  title: $('fTitle'),
  author: $('fAuthor'),
  status: $('fStatus'),
  notes: $('fNotes'),
  stars: $('starInput'),
  ratingLabel: $('ratingLabel'),
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
   Daten ändern: hinzufügen, bearbeiten, löschen
   Ein "Buch" in der Liste ist ein Eintrag (entry) mit seinem Werk (work)
   und den Ausgaben (editions), die ich besitze – siehe js/model.js.
   ==================================================================== */

/** Eintrag mit Werk und Ausgaben als flaches Objekt für Anzeige, Filter und Suche. */
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
    notes: entry.notes,
    addedAt: entry.addedAt,
  };
}

function allBooks() {
  return state.entries.map(bookView);
}

/** Sind die Sterne für diesen Status eine Bewertung nach dem Lesen (statt Priorität)? */
function isRatingAfterReading(status) {
  return status === 'read' || status === 'dropped';
}

/** Schreibt die Formularwerte in Werk und Eintrag und vermerkt sie als manuelle Angaben. */
function applyForm(work, entry, { title, author, status, rating, notes }) {
  const at = new Date().toISOString();
  // Mehrere Autor:innen werden mit ";" getrennt (ein Komma kann Teil des Namens sein)
  const authors = author.split(';').map((a) => a.trim()).filter(Boolean);
  if (work.title !== title) { work.title = title; Model.setSource(work, 'title', 'manual', at); }
  if (work.authors.join('; ') !== authors.join('; ')) {
    work.authors = authors;
    Model.setSource(work, 'authors', 'manual', at);
  }
  if (entry.status !== status) { entry.status = status; Model.setSource(entry, 'status', 'manual', at); }
  if (entry.notes !== notes) { entry.notes = notes; Model.setSource(entry, 'notes', 'manual', at); }
  const value = rating || null;
  if (isRatingAfterReading(status)) entry.finalRating = value;
  else entry.priority = value;
}

/** Legt ein neues Buch (Werk + Eintrag) an. */
function addBook(data) {
  const work = Model.createWork();
  const entry = Model.createEntry({ workId: work.id });
  applyForm(work, entry, data);
  state.works.push(work);
  state.entries.unshift(entry);
  saveState();
}

/** Übernimmt geänderte Formularwerte in ein bestehendes Buch. */
function updateBook(id, data) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  applyForm(Model.resolve(state, entry).work, entry, data);
  saveState();
}

/** Löscht ein Buch (Eintrag, Werk, Ausgaben) und merkt es sich kurz für "Rückgängig". */
function deleteBook(id) {
  const index = state.entries.findIndex((e) => e.id === id);
  if (index === -1) return;
  const entry = state.entries[index];
  const { work, editions } = Model.resolve(state, entry);
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

/** Text für Vergleiche vereinfachen: Kleinbuchstaben, Akzente entfernen. */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // "é" -> "e", "ü" -> "u"
}

/** Liefert die Bücher, die zu Filter und Suche passen. */
function visibleBooks() {
  const term = normalize(searchTerm.trim());
  return allBooks().filter((b) => {
    if (activeFilter !== 'all' && b.status !== activeFilter) return false;
    if (!term) return true;
    return normalize(b.title).includes(term) || normalize(b.author).includes(term);
  });
}

/** Baut die Filter-Chips inkl. Anzahl der Bücher je Status. */
function renderFilters() {
  const books = allBooks();
  const counts = { all: books.length };
  for (const key of Object.keys(STATUSES)) counts[key] = 0;
  for (const b of books) counts[b.status] = (counts[b.status] || 0) + 1;

  const options = [['all', 'Alle'], ...Object.entries(STATUSES)];
  els.filters.innerHTML = '';
  for (const [key, label] of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.filter = key;
    chip.setAttribute('aria-pressed', String(key === activeFilter));
    chip.textContent = label;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = counts[key];
    chip.appendChild(n);
    els.filters.appendChild(chip);
  }
}

/** Sterne als Text, z. B. ★★★☆☆ (leere Sterne heller). */
function starsElement(rating) {
  const span = document.createElement('span');
  span.className = 'stars-display';
  span.setAttribute('aria-label', `${rating} von 5 Sternen`);
  span.textContent = '★'.repeat(rating);
  const off = document.createElement('span');
  off.className = 'off';
  off.textContent = '★'.repeat(5 - rating);
  span.appendChild(off);
  return span;
}

/** Erzeugt die Karte für ein einzelnes Buch. */
function bookCard(book) {
  // Hinweis: Alle Texte werden per textContent gesetzt, nie per innerHTML.
  // So kann ein Titel wie "<b>" die Seite nicht durcheinanderbringen.
  const li = document.createElement('li');
  li.className = 'book';
  li.dataset.status = book.status;
  li.dataset.id = book.id;

  const title = document.createElement('h3');
  title.className = 'book-title';
  title.textContent = book.title;

  const author = document.createElement('p');
  author.className = 'book-author';
  author.textContent = book.author;

  const meta = document.createElement('div');
  meta.className = 'book-meta';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = STATUSES[book.status] || book.status;
  meta.appendChild(badge);
  if (book.rating > 0) meta.appendChild(starsElement(book.rating));

  li.append(title, author, meta);

  if (book.notes) {
    const notes = document.createElement('p');
    notes.className = 'book-notes';
    notes.textContent = book.notes;
    li.appendChild(notes);
  }

  const actions = document.createElement('div');
  actions.className = 'book-actions';
  const added = document.createElement('span');
  added.className = 'added';
  added.textContent = 'Hinzugefügt am ' +
    new Date(book.addedAt).toLocaleDateString('de-DE');
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn';
  editBtn.dataset.action = 'edit';
  editBtn.textContent = 'Bearbeiten';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-danger';
  delBtn.dataset.action = 'delete';
  delBtn.textContent = 'Löschen';
  actions.append(added, editBtn, delBtn);
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
  for (const book of list) els.list.appendChild(bookCard(book));

  // Hinweis anzeigen, wenn nichts zu sehen ist
  if (list.length === 0) {
    els.empty.hidden = false;
    if (count === 0) {
      els.empty.innerHTML =
        '<h2>Dein Regal ist noch leer</h2>' +
        '<p>Tippe auf <strong>+</strong>, um dein erstes Buch hinzuzufügen.</p>';
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

// Status-Auswahl im Formular einmalig befüllen
for (const [key, label] of Object.entries(STATUSES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = label;
  els.status.appendChild(opt);
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

/** Öffnet den Dialog – leer für ein neues Buch oder befüllt zum Bearbeiten. */
function openDialog(book = null) {
  editingId = book ? book.id : null;
  els.dialogTitle.textContent = book ? 'Buch bearbeiten' : 'Buch hinzufügen';
  els.title.value = book ? book.title : '';
  els.author.value = book ? book.work.authors.join('; ') : '';
  // Neues Buch: Status vom aktiven Filter übernehmen, sonst "Wunschliste/Backlog"
  els.status.value = book ? book.status
    : (activeFilter !== 'all' ? activeFilter : 'backlog');
  els.notes.value = book ? book.notes : '';
  formRating = book ? book.rating : 0;
  els.error.textContent = '';
  paintStars();
  paintRatingLabel();
  els.dialog.showModal();
  // Auf dem Handy nur bei neuen Büchern direkt die Tastatur öffnen
  if (!book) els.title.focus();
}

function closeDialog() {
  els.dialog.close();
  editingId = null;
}

/** Prüft das Formular und speichert das Buch. */
function submitForm(event) {
  event.preventDefault();
  const data = {
    title: els.title.value.trim(),
    author: els.author.value.trim(),
    status: els.status.value,
    rating: formRating,
    notes: els.notes.value.trim(),
  };

  if (!data.title || !data.author) {
    els.error.textContent = 'Bitte Titel und Autor ausfüllen.';
    (data.title ? els.author : els.title).focus();
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
els.status.addEventListener('change', paintRatingLabel);
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
});

// Suche: Liste bei jeder Eingabe aktualisieren
els.search.addEventListener('input', () => {
  searchTerm = els.search.value;
  render();
});

// Filter-Chips (ein Listener für alle Chips)
els.filters.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  activeFilter = chip.dataset.filter;
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

// Los geht's
render();
