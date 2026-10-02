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
