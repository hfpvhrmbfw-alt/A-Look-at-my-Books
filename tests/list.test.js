'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const List = require('../js/list.js');
const Model = require('../js/model.js');

function book(title, status, ownership, extra = {}) {
  const work = Model.createWork({ title, authors: extra.authors || ['X'], genres: extra.genres || [] });
  const entry = Model.createEntry({ workId: work.id, status, ownership, tags: extra.tags || [] });
  const editions = extra.isbn13 ? [Model.createEdition({ workId: work.id, isbn13: extra.isbn13 })] : [];
  return { entry, work, editions, score: extra.score ?? null };
}

const books = [
  book('Ebook offen', 'backlog', 'ebook', { genres: ['Krimi'] }),
  book('Print gerade', 'reading', 'print', { genres: ['Roman'] }),
  book('Beides als nächstes', 'next', 'both', { tags: ['krimi'], score: 4 }),
  book('Wunsch', 'backlog', 'none', { score: 2 }),
  book('Gelesen print', 'read', 'print', { isbn13: '9780306406157' }),
  book('Abgebrochen ebook', 'dropped', 'ebook'),
  book('Alt ohne Format', 'backlog', null),
];
const titles = (list) => list.map((b) => b.work.title);

test('Leseliste zeigt standardmäßig nur offene Bücher', () => {
  assert.deepEqual(titles(List.filterBooks(books)),
    ['Ebook offen', 'Print gerade', 'Beides als nächstes', 'Wunsch', 'Alt ohne Format']);
});

test('Gelesene Bücher bleiben im Archiv und unter "Alle" auffindbar', () => {
  assert.deepEqual(titles(List.filterBooks(books, { view: 'archive' })), ['Gelesen print', 'Abgebrochen ebook']);
  assert.equal(List.filterBooks(books, { view: 'all' }).length, books.length);
  assert.deepEqual(titles(List.filterBooks(books, { view: 'all', search: '9780306' })), ['Gelesen print']);
});

test('nur E-Books bzw. nur Print (beides zählt zu beiden)', () => {
  assert.deepEqual(titles(List.filterBooks(books, { format: 'ebook' })), ['Ebook offen', 'Beides als nächstes']);
  assert.deepEqual(titles(List.filterBooks(books, { format: 'print' })), ['Print gerade', 'Beides als nächstes']);
  assert.deepEqual(titles(List.filterBooks(books, { format: 'none' })), ['Wunsch']);
});

test('Format lässt sich mit Status und Genre kombinieren', () => {
  assert.deepEqual(titles(List.filterBooks(books, { format: 'ebook', status: 'next' })), ['Beides als nächstes']);
  assert.deepEqual(titles(List.filterBooks(books, { format: 'ebook', genre: 'Krimi' })), ['Ebook offen', 'Beides als nächstes']);
  assert.deepEqual(titles(List.filterBooks(books, { view: 'all', format: 'print', status: 'read' })), ['Gelesen print']);
});

test('Mindestscore filtert Bücher ohne oder mit zu kleinem Score heraus', () => {
  const r = List.filterBooks(books, { minScore: 3, scoreOf: (b) => b.score });
  assert.deepEqual(titles(r), ['Beides als nächstes']);
});

test('Suche ignoriert Groß-/Kleinschreibung und Akzente', () => {
  assert.deepEqual(titles(List.filterBooks(books, { search: 'NACHSTES' })), ['Beides als nächstes']);
});

/* ---------- Sortieren ---------- */

function sb(title, author, extra = {}) {
  const work = Model.createWork({ title, authors: [author] });
  const entry = Model.createEntry({ workId: work.id, ownership: extra.ownership || 'print', addedAt: extra.addedAt || '2026-01-01' });
  const editions = extra.pages ? [Model.createEdition({ workId: work.id, pages: extra.pages })] : [];
  return { entry, work, editions, score: extra.score ?? null };
}
const sortable = [
  sb('Zebra', 'Anna Seghers', { score: 3, pages: 300, addedAt: '2026-03-01', ownership: 'ebook' }),
  sb('Äpfel', 'Thomas Mann', { score: 4.5, pages: 120, addedAt: '2026-01-01' }),
  sb('Mitte', 'Ilse Aichinger', { score: null, addedAt: '2026-02-01', ownership: 'both' }),
];
const scoreOf = (b) => b.score;

test('Sortierung nach Score absteigend, ohne Score am Ende', () => {
  assert.deepEqual(titles(List.sortBooks(sortable, 'score', { scoreOf })), ['Äpfel', 'Zebra', 'Mitte']);
  assert.deepEqual(titles(List.sortBooks(sortable, 'score', { scoreOf, reverse: true })), ['Zebra', 'Äpfel', 'Mitte']);
});

test('Sortierung nach Titel (deutsch), Autor:in (Nachname), Seiten, Datum, Format', () => {
  assert.deepEqual(titles(List.sortBooks(sortable, 'title')), ['Äpfel', 'Mitte', 'Zebra']);
  assert.deepEqual(titles(List.sortBooks(sortable, 'author')), ['Mitte', 'Äpfel', 'Zebra']);
  assert.deepEqual(titles(List.sortBooks(sortable, 'pages')), ['Äpfel', 'Zebra', 'Mitte']);
  assert.deepEqual(titles(List.sortBooks(sortable, 'added')), ['Zebra', 'Mitte', 'Äpfel']);
  assert.deepEqual(titles(List.sortBooks(sortable, 'format')), ['Äpfel', 'Mitte', 'Zebra']);
});

/* ---------- Warteschlange ---------- */

test('Warteschlange wird lückenlos nummeriert, neue Einträge ans Ende', () => {
  const es = [
    { id: 'a', status: 'next', queuePos: 5, addedAt: '1' },
    { id: 'b', status: 'next', queuePos: null, addedAt: '2' },
    { id: 'c', status: 'backlog', queuePos: 1, addedAt: '3' },
    { id: 'd', status: 'next', queuePos: 2, addedAt: '4' },
  ];
  const q = List.normalizeQueue(es);
  assert.deepEqual(q.map((e) => e.id), ['d', 'a', 'b']);
  assert.deepEqual(es.map((e) => e.queuePos), [2, 3, null, 1]);
});

test('Hoch/Runter tauscht mit dem Nachbarn und bleibt an den Rändern stehen', () => {
  const es = [
    { id: 'a', status: 'next', queuePos: 1 },
    { id: 'b', status: 'next', queuePos: 2 },
    { id: 'c', status: 'next', queuePos: 3 },
  ];
  assert.equal(List.moveInQueue(es, 'c', -1), true);
  assert.deepEqual(List.normalizeQueue(es).map((e) => e.id), ['a', 'c', 'b']);
  assert.equal(List.moveInQueue(es, 'a', -1), false);
  assert.equal(List.moveInQueue(es, 'b', 1), false);
  List.moveInQueue(es, 'a', 1);
  assert.deepEqual(List.normalizeQueue(es).map((e) => e.id), ['c', 'a', 'b']);
});
